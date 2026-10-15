package engine

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

// controlS3 is resumableS3 that also answers ListMultipartUploads with the uploads it did not see aborted or completed.
// Part 2 waits until its request is cancelled, so a test can stop the Upload while a Part is in flight.
func controlS3() (s3 *fakeS3, partInFlight <-chan struct{}) {
	s3 = resumableS3(map[int]string{})
	answer := s3.respond
	inFlight := make(chan struct{}, 1)
	var mu sync.Mutex
	open := map[string]string{} // upload ID → key
	s3.respond = func(r *http.Request) *http.Response {
		q := r.URL.Query()
		key := strings.TrimPrefix(r.URL.Path, "/")
		key = key[strings.Index(key, "/")+1:] // The path is /bucket/key.
		mu.Lock()
		defer mu.Unlock()
		switch {
		case r.Method == http.MethodPost && q.Has("uploads"):
			open["up-1"] = key
		case r.Method == http.MethodGet && q.Has("uploads"):
			var uploads strings.Builder
			for id, k := range open {
				fmt.Fprintf(&uploads, `<Upload><Key>%s</Key><UploadId>%s</UploadId></Upload>`, k, id)
			}
			return xmlResponse(r, `<ListMultipartUploadsResult><IsTruncated>false</IsTruncated>`+uploads.String()+`</ListMultipartUploadsResult>`)
		case r.Method == http.MethodDelete && q.Has("uploadId"):
			delete(open, q.Get("uploadId"))
			return &http.Response{StatusCode: http.StatusNoContent, Body: http.NoBody, Request: r}
		case r.Method == http.MethodPut && q.Get("partNumber") == "2":
			inFlight <- struct{}{}
			mu.Unlock()
			<-r.Context().Done()
			mu.Lock()
			return &http.Response{StatusCode: http.StatusInternalServerError, Body: http.NoBody, Request: r}
		}
		return answer(r)
	}
	return s3, inFlight
}

// session sends requests with their own IDs and gets the replies by ID, answering secret.request on the way.
type rpcSession struct {
	h       *host
	mu      sync.Mutex
	replies map[int]chan json.RawMessage
	nextID  int
}

func newRPCSession(h *host) *rpcSession {
	s := &rpcSession{h: h, replies: map[int]chan json.RawMessage{}}
	go func() {
		for h.scan.Scan() {
			var msg struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
				Params json.RawMessage `json:"params"`
			}
			json.Unmarshal(h.scan.Bytes(), &msg)
			switch {
			case msg.Method == "secret.request":
				h.enc.Encode(map[string]any{"jsonrpc": "2.0", "id": msg.ID, "result": h.keys["account.1"]})
			case msg.Method != "":
				if h.onNotify != nil {
					h.onNotify(msg.Method, msg.Params)
				}
			default:
				var id int
				json.Unmarshal(msg.ID, &id)
				s.mu.Lock()
				ch := s.replies[id]
				s.mu.Unlock()
				line := append([]byte(nil), h.scan.Bytes()...)
				ch <- line
			}
		}
	}()
	return s
}

// send sends one request and gives a channel with its whole reply message.
func (s *rpcSession) send(method string, params any) <-chan json.RawMessage {
	s.mu.Lock()
	s.nextID++
	id := s.nextID
	ch := make(chan json.RawMessage, 1)
	s.replies[id] = ch
	s.mu.Unlock()
	s.h.enc.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	return ch
}

func wait(t *testing.T, ch <-chan json.RawMessage, what string) (result, rpcErr json.RawMessage) {
	t.Helper()
	select {
	case line := <-ch:
		var msg struct {
			Result json.RawMessage `json:"result"`
			Error  json.RawMessage `json:"error"`
		}
		json.Unmarshal(line, &msg)
		return msg.Result, msg.Error
	case <-time.After(5 * time.Second):
		t.Fatalf("no reply to %s", what)
		return nil, nil
	}
}

func waitFor(t *testing.T, ch <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
	}
}

func bigUpload(t *testing.T) map[string]any {
	params := r2Upload(writeFile(t, "video.mov", strings.Repeat("x", 20*mib)), map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"})
	params["id"] = "7.1"
	params["partsPerFile"] = 1
	return params
}

func countKind(s3 *fakeS3, kind string) int {
	n := 0
	for _, k := range requestKinds(s3) {
		if k == kind {
			n++
		}
	}
	return n
}

func TestPauseStopsTheRunningUploadAndKeepsItsMultipartUpload(t *testing.T) {
	s3, partInFlight := controlS3()
	s := newRPCSession(newHost(t, s3))

	upload := s.send("upload.enqueue", bigUpload(t))
	waitFor(t, partInFlight, "Part 2")
	_, pauseErr := wait(t, s.send("upload.pause", map[string]any{"id": "7.1"}), "upload.pause")
	_, uploadErr := wait(t, upload, "upload.enqueue")

	if pauseErr != nil {
		t.Fatalf("upload.pause error = %s", pauseErr)
	}
	if uploadErr == nil {
		t.Error("upload.enqueue succeeded, want it stopped by the pause")
	}
	if n := countKind(s3, "abort"); n != 0 {
		t.Errorf("aborts = %d, want 0: a paused upload resumes from its saved Parts", n)
	}
}

func TestCancelStopsTheRunningUploadAndAbortsItsMultipartUpload(t *testing.T) {
	s3, partInFlight := controlS3()
	s := newRPCSession(newHost(t, s3))
	params := bigUpload(t)

	upload := s.send("upload.enqueue", params)
	waitFor(t, partInFlight, "Part 2")
	_, cancelErr := wait(t, s.send("upload.cancel", map[string]any{"id": "7.1", "destination": params["destination"]}), "upload.cancel")
	_, uploadErr := wait(t, upload, "upload.enqueue")

	if cancelErr != nil {
		t.Fatalf("upload.cancel error = %s", cancelErr)
	}
	if uploadErr == nil {
		t.Error("upload.enqueue succeeded, want it stopped by the cancel")
	}
	if n := countKind(s3, "abort"); n != 1 {
		t.Errorf("aborts = %d, want 1 (PRD U7: Cancel calls AbortMultipartUpload)", n)
	}
	if n := countKind(s3, "complete"); n != 0 {
		t.Errorf("completes = %d, want 0", n)
	}
}

func TestCancelOfAnUploadThatDoesNotRunAbortsTheMultipartUploadsOfItsKey(t *testing.T) {
	s3, partInFlight := controlS3()
	s := newRPCSession(newHost(t, s3))
	params := bigUpload(t)

	// Pause first: the multipart upload stays, and the Upload does not run.
	started := notifications(s.h, "upload.started")
	upload := s.send("upload.enqueue", params)
	waitFor(t, partInFlight, "Part 2")
	wait(t, s.send("upload.pause", map[string]any{"id": "7.1"}), "upload.pause")
	wait(t, upload, "upload.enqueue")
	var e uploadStartedEvent
	json.Unmarshal((*started)[0], &e)

	_, cancelErr := wait(t, s.send("upload.cancel", map[string]any{"id": "7.1", "destination": params["destination"], "key": e.Key}), "upload.cancel")

	if cancelErr != nil {
		t.Fatalf("upload.cancel error = %s", cancelErr)
	}
	if n := countKind(s3, "abort"); n != 1 {
		t.Errorf("aborts = %d, want 1 for the paused upload's key", n)
	}
}

func TestPauseOfAnUploadThatDoesNotRunDoesNothing(t *testing.T) {
	s3, _ := controlS3()
	s := newRPCSession(newHost(t, s3))

	_, err := wait(t, s.send("upload.pause", map[string]any{"id": "9.9"}), "upload.pause")

	if err != nil {
		t.Errorf("upload.pause error = %s, want no error", err)
	}
	if len(s3.requests) != 0 {
		t.Errorf("requests = %d, want none", len(s3.requests))
	}
}
