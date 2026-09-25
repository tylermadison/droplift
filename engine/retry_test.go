package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

// failing answers the first `times` requests that match with the status and error code, then passes on.
type failing struct {
	match  func(*http.Request) bool
	times  int
	status int
	code   string
	next   http.RoundTripper
	mu     sync.Mutex
	failed int
}

func (f *failing) RoundTrip(r *http.Request) (*http.Response, error) {
	f.mu.Lock()
	fail := f.failed < f.times && f.match(r)
	if fail {
		f.failed++
	}
	f.mu.Unlock()
	if !fail {
		return f.next.RoundTrip(r)
	}
	if r.Body != nil {
		io.Copy(io.Discard, r.Body)
	}
	body := "<Error><Code>" + f.code + "</Code><Message>from the service</Message></Error>"
	return &http.Response{StatusCode: f.status, Header: http.Header{"Content-Type": {"application/xml"}},
		Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
}

func anyPut(r *http.Request) bool { return r.Method == http.MethodPut }

func partNumber(n string) func(*http.Request) bool {
	return func(r *http.Request) bool { return r.URL.Query().Get("partNumber") == n }
}

// fakeSleep records each backoff wait and returns at once.
type fakeSleep struct {
	mu    sync.Mutex
	waits []time.Duration
}

func (s *fakeSleep) Sleep(ctx context.Context, d time.Duration) error {
	s.mu.Lock()
	s.waits = append(s.waits, d)
	s.mu.Unlock()
	return ctx.Err()
}

// maxJitter makes full jitter wait the full backoff, so the waits are exact.
func maxJitter() float64 { return 1 }

func retryEngine(t *testing.T, transport http.RoundTripper, sleep *fakeSleep) *host {
	t.Helper()
	h := startEngineWith(t, nil, Options{Now: fixedNow, HTTPClient: &http.Client{Transport: transport}, Sleep: sleep.Sleep, Jitter: maxJitter})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	return h
}

func publicLink() map[string]any {
	return map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"}
}

func TestA503RetriesWithDoublingBackoffUpTo30sAndSucceedsOnThe8thTry(t *testing.T) {
	s3 := &fakeS3{}
	sleep := &fakeSleep{}
	h := retryEngine(t, &failing{match: anyPut, times: 7, status: 503, code: "ServiceUnavailable", next: s3}, sleep)
	path := writeFile(t, "notes.txt", "hello from droplift\n")

	enqueue(t, h, r2Upload(path, publicLink()))

	if fmt.Sprint(sleep.waits) != "[500ms 1s 2s 4s 8s 16s 30s]" {
		t.Errorf("waits = %v, want 0.5 s doubling up to the 30 s limit", sleep.waits)
	}
	if len(s3.requests) != 1 {
		t.Errorf("successful PUTs = %d, want 1", len(s3.requests))
	}
}

// dropsConnection fails the first PUT with a network error (no HTTP status), then passes on.
type dropsConnection struct {
	err     error // io.ErrUnexpectedEOF if nil
	next    http.RoundTripper
	mu      sync.Mutex
	dropped bool
}

func (d *dropsConnection) RoundTrip(r *http.Request) (*http.Response, error) {
	d.mu.Lock()
	drop := !d.dropped && r.Method == http.MethodPut
	d.dropped = d.dropped || drop
	d.mu.Unlock()
	if drop && d.err != nil {
		return nil, d.err
	}
	if drop {
		return nil, io.ErrUnexpectedEOF
	}
	return d.next.RoundTrip(r)
}

// countPuts counts every PUT that reaches the network.
type countPuts struct {
	next http.RoundTripper
	mu   sync.Mutex
	puts int
}

func (c *countPuts) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.Method == http.MethodPut {
		c.mu.Lock()
		c.puts++
		c.mu.Unlock()
	}
	return c.next.RoundTrip(r)
}

func TestTheRetryDecisionTable(t *testing.T) {
	cases := []struct {
		name   string
		status int
		code   string
		retry  bool
	}{
		{"500 internal error", 500, "InternalError", true},
		{"503 service unavailable", 503, "ServiceUnavailable", true},
		{"429 too many requests", 429, "TooManyRequests", true},
		{"400 RequestTimeout", 400, "RequestTimeout", true},
		{"400 SlowDown", 400, "SlowDown", true},
		{"403 AccessDenied", 403, "AccessDenied", false},
		{"404 NoSuchBucket", 404, "NoSuchBucket", false},
		{"400 InvalidArgument", 400, "InvalidArgument", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			count := &countPuts{next: &failing{match: anyPut, times: 1, status: c.status, code: c.code, next: &fakeS3{}}}
			h := retryEngine(t, count, &fakeSleep{})
			params := r2Upload(writeFile(t, "notes.txt", "hello\n"), publicLink())

			if c.retry {
				enqueue(t, h, params)
			} else {
				h.callError("upload.enqueue", params)
			}

			want := map[bool]int{true: 2, false: 1}[c.retry]
			if count.puts != want {
				t.Errorf("tries = %d, want %d", count.puts, want)
			}
		})
	}
	for name, err := range map[string]error{
		"network error": io.ErrUnexpectedEOF,
		// An HTTP client timeout also matches context.DeadlineExceeded, but the Upload's context is not done.
		"network timeout": fmt.Errorf("Client.Timeout exceeded: %w", context.DeadlineExceeded),
	} {
		t.Run(name, func(t *testing.T) {
			count := &countPuts{next: &dropsConnection{err: err, next: &fakeS3{}}}
			h := retryEngine(t, count, &fakeSleep{})

			enqueue(t, h, r2Upload(writeFile(t, "notes.txt", "hello\n"), publicLink()))

			if count.puts != 2 {
				t.Errorf("tries = %d, want 2", count.puts)
			}
		})
	}
}

func TestAnUploadFailsAfter8TriesOfARetryableError(t *testing.T) {
	sleep := &fakeSleep{}
	count := &countPuts{next: &failing{match: anyPut, times: 100, status: 503, code: "ServiceUnavailable", next: &fakeS3{}}}
	h := retryEngine(t, count, sleep)

	h.callError("upload.enqueue", r2Upload(writeFile(t, "notes.txt", "hello\n"), publicLink()))

	if count.puts != 8 || len(sleep.waits) != 7 {
		t.Errorf("tries = %d, waits = %d; want 8 tries and 7 waits", count.puts, len(sleep.waits))
	}
}

func TestFullJitterWaitsARandomPartOfTheBackoff(t *testing.T) {
	sleep := &fakeSleep{}
	h := startEngineWith(t, nil, Options{Now: fixedNow, Sleep: sleep.Sleep, Jitter: func() float64 { return 0.25 },
		HTTPClient: &http.Client{Transport: &failing{match: anyPut, times: 3, status: 503, code: "ServiceUnavailable", next: &fakeS3{}}}})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}

	enqueue(t, h, r2Upload(writeFile(t, "notes.txt", "hello\n"), publicLink()))

	// A quarter of 0.5 s, 1 s, 2 s.
	if fmt.Sprint(sleep.waits) != "[125ms 250ms 500ms]" {
		t.Errorf("waits = %v", sleep.waits)
	}
}

// partTries counts the UploadPart requests for each Part number that reach the network.
type partTries struct {
	next  http.RoundTripper
	mu    sync.Mutex
	tries map[string]int
}

func (p *partTries) RoundTrip(r *http.Request) (*http.Response, error) {
	if n := r.URL.Query().Get("partNumber"); n != "" {
		p.mu.Lock()
		p.tries[n]++
		p.mu.Unlock()
	}
	return p.next.RoundTrip(r)
}

func TestARetrySendsOnlyTheFailedPartAgain(t *testing.T) {
	tries := &partTries{tries: map[string]int{}, next: &failing{match: partNumber("2"), times: 2, status: 503, code: "ServiceUnavailable", next: multipartS3()}}
	h := retryEngine(t, tries, &fakeSleep{})
	done := partsDone(h)

	enqueue(t, h, r2Upload(writeFile(t, "video.mov", strings.Repeat("x", 20*mib)), publicLink()))

	if fmt.Sprint(tries.tries) != "map[1:1 2:3 3:1]" {
		t.Errorf("tries per Part = %v, want Part 2 three times and the others once", tries.tries)
	}
	if done[1].Retries != 0 || done[2].Retries != 2 || done[3].Retries != 0 {
		t.Errorf("retries = %d, %d, %d; want 0, 2, 0", done[1].Retries, done[2].Retries, done[3].Retries)
	}
}

func TestTheUploadResultHasTheRetriesOfAllItsCalls(t *testing.T) {
	var got struct {
		Retries int `json:"retries"`
	}

	h := retryEngine(t, &failing{match: anyPut, times: 2, status: 503, code: "ServiceUnavailable", next: &fakeS3{}}, &fakeSleep{})
	json.Unmarshal(h.call("upload.enqueue", r2Upload(writeFile(t, "notes.txt", "hello\n"), publicLink())), &got)
	if got.Retries != 2 {
		t.Errorf("single PUT: retries = %d, want 2", got.Retries)
	}

	transport := &failing{match: partNumber("2"), times: 2, status: 503, code: "ServiceUnavailable",
		next: &failing{match: partNumber("3"), times: 1, status: 500, code: "InternalError", next: multipartS3()}}
	h = retryEngine(t, transport, &fakeSleep{})
	json.Unmarshal(h.call("upload.enqueue", r2Upload(writeFile(t, "video.mov", strings.Repeat("x", 20*mib)), publicLink())), &got)
	if got.Retries != 3 {
		t.Errorf("multipart: retries = %d, want 3", got.Retries)
	}
}

func TestProgressNeverGoesBackDuringARetry(t *testing.T) {
	for _, c := range []struct {
		name  string
		size  int
		match func(*http.Request) bool
		next  *fakeS3
	}{
		{"single PUT", 64 * 1024, anyPut, &fakeS3{}},
		{"Part", 20 * mib, partNumber("2"), multipartS3()},
	} {
		t.Run(c.name, func(t *testing.T) {
			// Each clock read is 100 ms later, so every byte change gives a progress event.
			clock := &fakeClock{now: time.Date(2026, 9, 4, 13, 5, 0, 0, time.UTC)}
			tick := func() time.Time { clock.Advance(100 * time.Millisecond); return clock.Now() }
			h := startEngineWith(t, nil, Options{Now: tick, Sleep: (&fakeSleep{}).Sleep, Jitter: maxJitter,
				HTTPClient: &http.Client{Transport: &failing{match: c.match, times: 1, status: 503, code: "ServiceUnavailable", next: c.next}}})
			h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
			var sent []int64
			h.onNotify = func(method string, params json.RawMessage) {
				if method == "progress" {
					var e progressEvent
					json.Unmarshal(params, &e)
					sent = append(sent, e.Sent)
				}
			}

			enqueue(t, h, r2Upload(writeFile(t, "file.bin", strings.Repeat("x", c.size)), publicLink()))

			for i := 1; i < len(sent); i++ {
				if sent[i] < sent[i-1] {
					t.Fatalf("progress went back from %d to %d (event %d of %d)", sent[i-1], sent[i], i, len(sent))
				}
			}
			if len(sent) == 0 || sent[len(sent)-1] != int64(c.size) {
				t.Errorf("progress = %v, want it to end at %d", sent, c.size)
			}
		})
	}
}

func TestAFailedUploadGivesItsRetriesInTheErrorData(t *testing.T) {
	h := retryEngine(t, &failing{match: anyPut, times: 100, status: 503, code: "ServiceUnavailable", next: &fakeS3{}}, &fakeSleep{})

	_, raw := h.roundTrip("upload.enqueue", r2Upload(writeFile(t, "notes.txt", "hello\n"), publicLink()))

	var e struct {
		Data struct {
			Retries int `json:"retries"`
		} `json:"data"`
	}
	json.Unmarshal(raw, &e)
	if e.Data.Retries != 7 {
		t.Errorf("error = %s, want data.retries 7", raw)
	}
}

// brokenBody fails during the read, like a connection reset after the status line.
type brokenBody struct{}

func (brokenBody) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }
func (brokenBody) Close() error             { return nil }

// breaksCreateResponse answers the first CreateMultipartUpload with a 200 whose body breaks, then passes on.
type breaksCreateResponse struct {
	next    http.RoundTripper
	mu      sync.Mutex
	creates int
}

func (b *breaksCreateResponse) RoundTrip(r *http.Request) (*http.Response, error) {
	if !r.URL.Query().Has("uploads") {
		return b.next.RoundTrip(r)
	}
	b.mu.Lock()
	b.creates++
	first := b.creates == 1
	b.mu.Unlock()
	if first {
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/xml"}}, Body: brokenBody{}, Request: r}, nil
	}
	return b.next.RoundTrip(r)
}

func TestAConnectionResetWhileReadingTheResponseRetries(t *testing.T) {
	transport := &breaksCreateResponse{next: multipartS3()}
	h := retryEngine(t, transport, &fakeSleep{})

	enqueue(t, h, r2Upload(writeFile(t, "video.mov", strings.Repeat("x", 20*mib)), publicLink()))

	if transport.creates != 2 {
		t.Errorf("creates = %d, want 2", transport.creates)
	}
}
