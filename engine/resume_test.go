package engine

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

// resumableS3 is multipartS3 that also answers ListParts with the `listed` Parts (number to ETag),
// and gives a CRC32 for each uploaded Part. A nil `listed` answers NoSuchUpload, as for an aborted or expired upload.
func resumableS3(listed map[int]string) *fakeS3 {
	s3 := multipartS3()
	answer := s3.respond
	s3.respond = func(r *http.Request) *http.Response {
		q := r.URL.Query()
		switch {
		case r.Method == http.MethodGet && q.Has("uploadId"):
			if listed == nil {
				body := "<Error><Code>NoSuchUpload</Code><Message>The specified upload does not exist.</Message></Error>"
				return &http.Response{StatusCode: 404, Header: http.Header{"Content-Type": {"application/xml"}},
					Body: io.NopCloser(strings.NewReader(body)), Request: r}
			}
			var parts strings.Builder
			for n, etag := range listed {
				fmt.Fprintf(&parts, `<Part><PartNumber>%d</PartNumber><ETag>"%s"</ETag><Size>%d</Size></Part>`, n, etag, 8*mib)
			}
			return xmlResponse(r, `<ListPartsResult><IsTruncated>false</IsTruncated>`+parts.String()+`</ListPartsResult>`)
		case r.Method == http.MethodPut && q.Has("partNumber"):
			res := answer(r)
			res.Header.Set("X-Amz-Checksum-Crc32", "crc-"+q.Get("partNumber"))
			return res
		}
		return answer(r)
	}
	return s3
}

func newHost(t *testing.T, s3 *fakeS3) *host {
	h := startEngineWith(t, s3, Options{Now: fixedNow})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	return h
}

// notifications records every notification of one method, in order.
func notifications(h *host, method string) *[]json.RawMessage {
	var mu sync.Mutex
	var got []json.RawMessage
	h.onNotify = func(m string, params json.RawMessage) {
		if m == method {
			mu.Lock()
			got = append(got, params)
			mu.Unlock()
		}
	}
	return &got
}

func fileHash(t *testing.T, path string) string {
	t.Helper()
	h := newHost(t, resumableS3(map[int]string{}))
	started := notifications(h, "upload.started")
	enqueue(t, h, r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"}))
	var s uploadStartedEvent
	json.Unmarshal((*started)[0], &s)
	return s.Hash
}

func resumeParams(path, hash string, parts ...map[string]any) map[string]any {
	params := r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"})
	params["resume"] = map[string]any{"key": "saved/video.mov", "uploadId": "up-old", "hash": hash, "parts": parts}
	return params
}

func resume(t *testing.T, h *host, params map[string]any) uploadResult {
	t.Helper()
	var got uploadResult
	if err := json.Unmarshal(h.call("upload.resume", params), &got); err != nil {
		t.Fatal(err)
	}
	return got
}

func TestAMultipartUploadSendsUploadStartedWithTheKeyTheUploadIDAndTheFileHash(t *testing.T) {
	h := newHost(t, resumableS3(map[int]string{}))
	started := notifications(h, "upload.started")
	path := writeFile(t, "video.mov", strings.Repeat("x", 20*mib))

	got := enqueue(t, h, r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"}))

	if len(*started) != 1 {
		t.Fatalf("upload.started events = %d, want 1", len(*started))
	}
	var s uploadStartedEvent
	json.Unmarshal((*started)[0], &s)
	if s.ID != "u1" || s.Key != got.Key || s.UploadID != "up-1" || len(s.Hash) != 64 {
		t.Errorf("upload.started = %+v, want u1, the key %q, up-1 and a blake3 hash", s, got.Key)
	}
}

func TestPartDoneCarriesTheETagAndTheChecksumOfThePart(t *testing.T) {
	h := newHost(t, resumableS3(map[int]string{}))
	done := partsDone(h)
	path := writeFile(t, "video.mov", strings.Repeat("x", 20*mib))

	enqueue(t, h, r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"}))

	if p := done[2]; p.ETag != "part-2" || p.Checksum != "crc-2" {
		t.Errorf("part 2 = %+v, want ETag part-2 and checksum crc-2", p)
	}
}

func TestResumeSendsOnlyTheMissingPartsAndCompletesWithAllParts(t *testing.T) {
	path := writeFile(t, "video.mov", strings.Repeat("x", 20*mib))
	hash := fileHash(t, path)
	s3 := resumableS3(map[int]string{1: "part-1"})
	h := newHost(t, s3)

	got := resume(t, h, resumeParams(path, hash, map[string]any{"n": 1, "etag": "part-1", "checksum": "crc-1"}))

	if kinds := fmt.Sprint(requestKinds(s3)); kinds != "[complete list part part]" {
		t.Errorf("requests = %s, want list, the 2 missing Parts, complete", kinds)
	}
	if sizes := partSizes(s3); sizes[1] != 0 || sizes[2] != 8*mib || sizes[3] != 4*mib {
		t.Errorf("part sizes = %v, want only Parts 2 and 3", sizes)
	}
	for i, r := range s3.requests {
		if r.URL.Query().Get("uploadId") != "" && r.URL.Query().Get("uploadId") != "up-old" {
			t.Errorf("request %d used upload ID %q, want up-old", i, r.URL.Query().Get("uploadId"))
		}
		if !strings.HasSuffix(r.URL.Path, "/saved/video.mov") {
			t.Errorf("request %d path = %s, want the saved key", i, r.URL.Path)
		}
	}
	complete := s3.bodies[len(s3.bodies)-1]
	for _, want := range []string{`<ETag>part-1</ETag>`, `<ChecksumCRC32>crc-1</ChecksumCRC32>`, `<PartNumber>1</PartNumber>`, `<ChecksumCRC32>crc-3</ChecksumCRC32>`} {
		if !strings.Contains(strings.ReplaceAll(complete, "&#34;", ""), want) {
			t.Errorf("complete body = %s, want %s", complete, want)
		}
	}
	if got.Key != "saved/video.mov" || got.Checksum != "AAAAAA==-3" || got.Size != 20*mib {
		t.Errorf("result = %+v, want the saved key, the object checksum and the full size", got)
	}
}

func TestResumeSendsAgainASavedPartThatTheDestinationDoesNotHave(t *testing.T) {
	path := writeFile(t, "video.mov", strings.Repeat("x", 20*mib))
	hash := fileHash(t, path)
	s3 := resumableS3(map[int]string{1: "part-1"})
	h := newHost(t, s3)

	resume(t, h, resumeParams(path, hash,
		map[string]any{"n": 1, "etag": "part-1", "checksum": "crc-1"},
		map[string]any{"n": 2, "etag": "part-2-old", "checksum": "crc-2"}))

	if sizes := partSizes(s3); sizes[1] != 0 || sizes[2] != 8*mib || sizes[3] != 4*mib {
		t.Errorf("part sizes = %v, want Parts 2 and 3: Part 2 is not on the Destination with that ETag", sizes)
	}
}

func TestResumeStartsTheProgressAtTheCommittedBytes(t *testing.T) {
	path := writeFile(t, "video.mov", strings.Repeat("x", 20*mib))
	hash := fileHash(t, path)
	h := newHost(t, resumableS3(map[int]string{1: "part-1"}))
	events := notifications(h, "progress")

	resume(t, h, resumeParams(path, hash, map[string]any{"n": 1, "etag": "part-1", "checksum": "crc-1"}))

	for i, raw := range *events {
		var e progressEvent
		json.Unmarshal(raw, &e)
		if e.Sent < 8*mib {
			t.Fatalf("progress event %d = %+v, want at least the 8 MiB of Part 1", i, e)
		}
	}
	if len(*events) == 0 {
		t.Fatal("no progress events")
	}
}

func TestResumeStartsANewMultipartUploadOnTheSameKeyIfTheOldOneIsGone(t *testing.T) {
	path := writeFile(t, "video.mov", strings.Repeat("x", 20*mib))
	hash := fileHash(t, path)
	s3 := resumableS3(nil)
	h := newHost(t, s3)
	started := notifications(h, "upload.started")

	got := resume(t, h, resumeParams(path, hash, map[string]any{"n": 1, "etag": "part-1", "checksum": "crc-1"}))

	if kinds := fmt.Sprint(requestKinds(s3)); kinds != "[complete create list part part part]" {
		t.Errorf("requests = %s, want list, then a new upload with all Parts", kinds)
	}
	if got.Key != "saved/video.mov" {
		t.Errorf("key = %q, want the saved key", got.Key)
	}
	if len(*started) != 1 {
		t.Errorf("upload.started events = %d, want 1 for the new upload ID", len(*started))
	}
}

func TestResumeOfAChangedFileAbortsTheOldUploadAndStartsAgain(t *testing.T) {
	path := writeFile(t, "video.mov", strings.Repeat("x", 20*mib))
	s3 := resumableS3(map[int]string{1: "part-1"})
	h := newHost(t, s3)

	got := resume(t, h, resumeParams(path, "hash-of-the-old-file", map[string]any{"n": 1, "etag": "part-1", "checksum": "crc-1"}))

	if kinds := fmt.Sprint(requestKinds(s3)); kinds != "[abort complete create part part part]" {
		t.Errorf("requests = %s, want an abort of the old upload, then a new upload with all Parts", kinds)
	}
	if got.Key == "saved/video.mov" {
		t.Error("key = the saved key, want a new key for the changed file")
	}
}

func TestACancelledMultipartUploadIsNotAbortedSoItCanResume(t *testing.T) {
	s3 := resumableS3(map[int]string{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	aborted := make(chan struct{}, 1)
	answer := s3.respond
	s3.respond = func(r *http.Request) *http.Response {
		if r.Method == http.MethodDelete {
			aborted <- struct{}{}
		}
		if r.URL.Query().Get("partNumber") == "2" {
			cancel() // The Engine stops (SIGTERM) while Part 2 is in flight.
		}
		return answer(r)
	}
	engineSide, hostSide := net.Pipe()
	defer hostSide.Close()
	go Serve(ctx, engineSide, Options{Now: fixedNow, HTTPClient: &http.Client{Transport: s3}})
	h := &host{t: t, enc: json.NewEncoder(hostSide), scan: bufio.NewScanner(hostSide), keys: map[string]map[string]string{
		"account.1": {"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}}}
	params := r2Upload(writeFile(t, "video.mov", strings.Repeat("x", 20*mib)), map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"})
	params["partsPerFile"] = 1

	go func() {
		h.enc.Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "upload.enqueue", "params": params})
		for h.scan.Scan() { // Answer secret.request; the connection closes on the cancel.
			var msg struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
			}
			json.Unmarshal(h.scan.Bytes(), &msg)
			if msg.Method == "secret.request" {
				h.enc.Encode(map[string]any{"jsonrpc": "2.0", "id": msg.ID, "result": h.keys["account.1"]})
			}
		}
	}()

	<-ctx.Done()
	select {
	case <-aborted:
		t.Error("the multipart upload was aborted, want it kept: the next start resumes it")
	case <-time.After(500 * time.Millisecond):
	}
}
