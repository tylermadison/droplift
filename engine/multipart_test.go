package engine

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const mib = 1024 * 1024

// multipartS3 answers the three multipart requests like S3 and R2 do.
func multipartS3() *fakeS3 {
	return &fakeS3{respond: func(r *http.Request) *http.Response {
		q := r.URL.Query()
		switch {
		case r.Method == http.MethodPost && q.Has("uploads"):
			return xmlResponse(r, `<InitiateMultipartUploadResult><UploadId>up-1</UploadId></InitiateMultipartUploadResult>`)
		case r.Method == http.MethodPut && q.Has("partNumber"):
			return &http.Response{StatusCode: http.StatusOK, Body: http.NoBody, Request: r,
				Header: http.Header{"Etag": {`"part-` + q.Get("partNumber") + `"`}}}
		case r.Method == http.MethodPost && q.Has("uploadId"):
			return xmlResponse(r, `<CompleteMultipartUploadResult><ETag>"whole-3"</ETag><ChecksumCRC32>AAAAAA==-3</ChecksumCRC32></CompleteMultipartUploadResult>`)
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Etag": {`"abc"`}}, Body: http.NoBody, Request: r}
	}}
}

func xmlResponse(r *http.Request, body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Request: r, Header: http.Header{"Content-Type": {"application/xml"}},
		Body: io.NopCloser(strings.NewReader(body))}
}

// partSizes gives the byte count of each UploadPart request, by Part number.
func partSizes(s3 *fakeS3) map[int]int64 {
	sizes := map[int]int64{}
	for _, r := range s3.requests {
		if n, err := strconv.Atoi(r.URL.Query().Get("partNumber")); err == nil {
			size := r.ContentLength
			if d := r.Header.Get("X-Amz-Decoded-Content-Length"); d != "" {
				size, _ = strconv.ParseInt(d, 10, 64)
			}
			sizes[n] = size
		}
	}
	return sizes
}

func requestKinds(s3 *fakeS3) []string {
	var kinds []string
	for _, r := range s3.requests {
		q := r.URL.Query()
		switch {
		case q.Has("uploads"):
			kinds = append(kinds, "create")
		case q.Has("partNumber"):
			kinds = append(kinds, "part")
		case q.Has("uploadId"):
			kinds = append(kinds, "complete")
		default:
			kinds = append(kinds, r.Method)
		}
	}
	sort.Strings(kinds)
	return kinds
}

func TestAFileOf16MiBOrMoreUploadsAsMultipartWithEqualPartsExceptTheLast(t *testing.T) {
	s3 := multipartS3()
	h := startEngineWith(t, s3, Options{Now: fixedNow})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	path := writeFile(t, "video.mov", strings.Repeat("x", 20*mib))

	got := enqueue(t, h, r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"}))

	if kinds := fmt.Sprint(requestKinds(s3)); kinds != "[complete create part part part]" {
		t.Errorf("requests = %s, want create, 3 parts, complete", kinds)
	}
	if sizes := partSizes(s3); sizes[1] != 8*mib || sizes[2] != 8*mib || sizes[3] != 4*mib {
		t.Errorf("part sizes = %v, want 8 MiB, 8 MiB, 4 MiB", sizes)
	}
	if got.ETag != "whole-3" || got.Size != 20*mib {
		t.Errorf("result = %+v, want the ETag of the completed object and the full size", got)
	}
}

func TestTheMultipartLimitIsExactly16MiB(t *testing.T) {
	for _, c := range []struct {
		size  int
		kinds string
	}{
		{16*mib - 1, "[PUT]"},
		{16 * mib, "[complete create part part]"},
	} {
		s3 := multipartS3()
		h := startEngineWith(t, s3, Options{Now: fixedNow})
		h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
		path := writeFile(t, "video.mov", strings.Repeat("x", c.size))

		enqueue(t, h, r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"}))

		if kinds := fmt.Sprint(requestKinds(s3)); kinds != c.kinds {
			t.Errorf("%d bytes: requests = %s, want %s", c.size, kinds, c.kinds)
		}
	}
}

// partsInFlight wraps a fake S3: each UploadPart waits until `release` Parts are in flight (or 200 ms pass),
// and the highest number of Parts in flight is recorded.
type partsInFlight struct {
	next    *fakeS3
	release int
	mu      sync.Mutex
	now     int
	most    int
	full    chan struct{}
	closed  bool
}

func (p *partsInFlight) RoundTrip(r *http.Request) (*http.Response, error) {
	if !r.URL.Query().Has("partNumber") {
		return p.next.RoundTrip(r)
	}
	p.mu.Lock()
	p.now++
	p.most = max(p.most, p.now)
	if p.now == p.release && !p.closed {
		p.closed = true
		close(p.full)
	}
	full := p.full
	p.mu.Unlock()
	select {
	case <-full:
	case <-time.After(200 * time.Millisecond):
	}
	res, err := p.next.RoundTrip(r)
	p.mu.Lock()
	p.now--
	p.mu.Unlock()
	return res, err
}

func TestAFileSendsAtMost4PartsAtTheSameTime(t *testing.T) {
	flight := &partsInFlight{next: multipartS3(), release: 4, full: make(chan struct{})}
	h := startEngineWith(t, nil, Options{Now: fixedNow, HTTPClient: &http.Client{Transport: flight}})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	path := writeFile(t, "video.mov", strings.Repeat("x", 40*mib)) // 5 Parts

	enqueue(t, h, r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"}))

	if flight.most != 4 {
		t.Errorf("most Parts in flight = %d, want 4", flight.most)
	}
	if sizes := partSizes(flight.next); len(sizes) != 5 {
		t.Errorf("part sizes = %v, want 5 Parts", sizes)
	}
}

// slowParts reads each UploadPart body 1 MiB at a time, and each read takes 30 ms on the fake clock.
type slowParts struct {
	clock *fakeClock
	next  *fakeS3
}

func (s slowParts) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Query().Has("partNumber") {
		buf := make([]byte, mib)
		for {
			_, err := r.Body.Read(buf)
			s.clock.Advance(30 * time.Millisecond)
			if err != nil {
				break
			}
		}
	}
	return s.next.RoundTrip(r)
}

func TestMultipartProgressIsTheSumOverThePartsAndEndsAtTheFullSize(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 9, 4, 13, 5, 0, 0, time.UTC)}
	h := startEngineWith(t, nil, Options{Now: clock.Now, HTTPClient: &http.Client{Transport: slowParts{clock, multipartS3()}}})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	path := writeFile(t, "video.mov", strings.Repeat("x", 20*mib))

	type event struct{ Sent, Total int64 }
	var events []event
	h.onNotify = func(method string, params json.RawMessage) {
		if method == "progress" {
			var e event
			json.Unmarshal(params, &e)
			events = append(events, e)
		}
	}

	enqueue(t, h, r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"}))

	// About 20 reads x 30 ms on the fake clock: a steady stream, not one event at the end.
	if len(events) < 4 {
		t.Fatalf("got %d progress events, want a steady stream", len(events))
	}
	for _, e := range events {
		if e.Sent > e.Total {
			t.Errorf("event %+v: sent is more than the total", e)
		}
	}
	if last := events[len(events)-1]; last.Sent != 20*mib || last.Total != 20*mib {
		t.Errorf("last event = %+v, want 20 MiB of 20 MiB", last)
	}
}

type partDone struct {
	ID         string    `json:"id"`
	N          int       `json:"n"`
	Size       int64     `json:"size"`
	StartedAt  time.Time `json:"startedAt"`
	FinishedAt time.Time `json:"finishedAt"`
	Retries    int       `json:"retries"`
	BPS        float64   `json:"bps"`
}

func partsDone(h *host) map[int]partDone {
	var mu sync.Mutex
	done := map[int]partDone{}
	h.onNotify = func(method string, params json.RawMessage) {
		if method == "part.done" {
			var p partDone
			json.Unmarshal(params, &p)
			mu.Lock()
			done[p.N] = p
			mu.Unlock()
		}
	}
	return done
}

func TestEachPartSendsPartDoneWithItsSizeTimesAndSpeed(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 9, 4, 13, 5, 0, 0, time.UTC)}
	h := startEngineWith(t, nil, Options{Now: clock.Now, HTTPClient: &http.Client{Transport: slowParts{clock, multipartS3()}}})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	path := writeFile(t, "video.mov", strings.Repeat("x", 20*mib))
	done := partsDone(h)

	enqueue(t, h, r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"}))

	want := map[int]int64{1: 8 * mib, 2: 8 * mib, 3: 4 * mib}
	if len(done) != 3 {
		t.Fatalf("part.done events = %v, want 3", done)
	}
	for n, size := range want {
		p := done[n]
		if p.ID != "u1" || p.Size != size || p.Retries != 0 {
			t.Errorf("part %d = %+v, want u1, %d bytes, 0 retries", n, p, size)
		}
		if !p.FinishedAt.After(p.StartedAt) || p.BPS <= 0 {
			t.Errorf("part %d = %+v, want an end after the start and a speed", n, p)
		}
	}
}

// failOnce answers the first UploadPart of one Part number with a 500, then passes on.
type failOnce struct {
	part   string
	next   *fakeS3
	mu     sync.Mutex
	failed bool
}

func (f *failOnce) RoundTrip(r *http.Request) (*http.Response, error) {
	f.mu.Lock()
	fail := !f.failed && r.URL.Query().Get("partNumber") == f.part
	f.failed = f.failed || fail
	f.mu.Unlock()
	if fail {
		io.Copy(io.Discard, r.Body)
		return &http.Response{StatusCode: http.StatusInternalServerError, Body: http.NoBody, Request: r, Header: http.Header{}}, nil
	}
	return f.next.RoundTrip(r)
}

func TestPartDoneCountsTheRetriesOfThatPart(t *testing.T) {
	h := startEngineWith(t, nil, Options{Now: fixedNow, HTTPClient: &http.Client{Transport: &failOnce{part: "2", next: multipartS3()}}})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	path := writeFile(t, "video.mov", strings.Repeat("x", 20*mib))
	done := partsDone(h)

	enqueue(t, h, r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"}))

	if done[1].Retries != 0 || done[2].Retries != 1 || done[3].Retries != 0 {
		t.Errorf("retries = %d, %d, %d; want 0, 1, 0", done[1].Retries, done[2].Retries, done[3].Retries)
	}
}

func TestAMultipartUploadRecordsTheChecksumOfTheCompletedObject(t *testing.T) {
	h := startEngineWith(t, multipartS3(), Options{Now: fixedNow})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	path := writeFile(t, "video.mov", strings.Repeat("x", 20*mib))

	got := enqueue(t, h, r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"}))

	if got.Checksum != "AAAAAA==-3" {
		t.Errorf("checksum = %q, want the CRC32 of the completed object", got.Checksum)
	}
}

func TestTheHostCanSetThePartsPerFile(t *testing.T) {
	flight := &partsInFlight{next: multipartS3(), release: 2, full: make(chan struct{})}
	h := startEngineWith(t, nil, Options{Now: fixedNow, HTTPClient: &http.Client{Transport: flight}})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	path := writeFile(t, "video.mov", strings.Repeat("x", 40*mib)) // 5 Parts
	params := r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"})
	params["partsPerFile"] = 2

	enqueue(t, h, params)

	if flight.most != 2 {
		t.Errorf("most Parts in flight = %d, want 2", flight.most)
	}
}

func TestAFailedPartFailsTheUploadWithTheClearMessageAndStopsTheOtherParts(t *testing.T) {
	s3 := multipartS3()
	answer := s3.respond
	s3.respond = func(r *http.Request) *http.Response {
		if r.URL.Query().Get("partNumber") == "1" {
			body := "<Error><Code>AccessDenied</Code><Message>from the service</Message></Error>"
			return &http.Response{StatusCode: 403, Header: http.Header{"Content-Type": {"application/xml"}},
				Body: io.NopCloser(strings.NewReader(body)), Request: r}
		}
		return answer(r)
	}
	h := startEngineWith(t, s3, Options{Now: fixedNow, HTTPClient: &http.Client{Transport: s3}})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	path := writeFile(t, "video.mov", strings.Repeat("x", 80*mib)) // 10 Parts
	params := r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"})
	params["partsPerFile"] = 1

	message := h.callError("upload.enqueue", params)

	if message != "personal cannot write to public-assets." {
		t.Errorf("message = %q", message)
	}
	if kinds := fmt.Sprint(requestKinds(s3)); kinds != "[create part]" {
		t.Errorf("requests = %s, want no more Parts and no complete after the failed Part", kinds)
	}
}
