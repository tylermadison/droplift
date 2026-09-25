package engine

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time         { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *fakeClock) Advance(d time.Duration) { c.mu.Lock(); c.now = c.now.Add(d); c.mu.Unlock() }

// slowS3 reads the PUT body 1 KiB at a time, and each read takes 30 ms on the fake clock.
type slowS3 struct{ clock *fakeClock }

func (s slowS3) RoundTrip(r *http.Request) (*http.Response, error) {
	buf := make([]byte, 1024)
	for r.Body != nil {
		_, err := r.Body.Read(buf)
		s.clock.Advance(30 * time.Millisecond)
		if err == io.EOF {
			break
		}
	}
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Etag": {`"e"`}}, Body: http.NoBody, Request: r}, nil
}

func TestUploadSendsProgressAtMostEvery100msAndEndsAtTheFullSize(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 9, 4, 13, 5, 0, 0, time.UTC)}
	h := startEngineWith(t, nil, Options{Now: clock.Now, HTTPClient: &http.Client{Transport: slowS3{clock}}})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	path := writeFile(t, "big.bin", strings.Repeat("x", 64*1024))

	type event struct {
		ID          string `json:"id"`
		Sent, Total int64
	}
	var events []event
	h.onNotify = func(method string, params json.RawMessage) {
		if method == "progress" {
			var e event
			json.Unmarshal(params, &e)
			events = append(events, e)
		}
	}

	enqueue(t, h, r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"}))

	// The upload takes 64 reads x 30 ms = 1.92 s on the fake clock: at most 19 throttled events + 1 last event.
	if len(events) < 5 || len(events) > 20 {
		t.Errorf("got %d progress events, want a steady stream of at most 20", len(events))
	}
	last := events[len(events)-1]
	if last.ID != "u1" || last.Sent != 64*1024 || last.Total != 64*1024 {
		t.Errorf("last event = %+v, want u1 at 65536 of 65536", last)
	}
}
