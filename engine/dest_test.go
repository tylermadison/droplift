package engine

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeS3 plays the storage service at the HTTP transport, so the real endpoint the engine calls is visible.
type fakeS3 struct {
	mu       sync.Mutex
	requests []*http.Request
	bodies   []string
	respond  func(*http.Request) *http.Response
}

func (f *fakeS3) RoundTrip(r *http.Request) (*http.Response, error) {
	var body []byte
	if r.Body != nil {
		body, _ = io.ReadAll(r.Body)
	}
	f.mu.Lock()
	f.requests = append(f.requests, r)
	f.bodies = append(f.bodies, string(body))
	f.mu.Unlock()
	if f.respond != nil {
		return f.respond(r), nil
	}
	status := http.StatusOK
	if r.Method == http.MethodDelete {
		status = http.StatusNoContent
	}
	return &http.Response{StatusCode: status, Header: http.Header{"Etag": {`"abc"`}}, Body: http.NoBody, Request: r}, nil
}

// host is the test side of the engine socket: it sends requests and answers secret.request.
type host struct {
	t    *testing.T
	enc  *json.Encoder
	scan *bufio.Scanner
	keys map[string]map[string]string
	// onNotify sees each notification (a message with a method and no id) from the engine.
	onNotify func(method string, params json.RawMessage)
}

func startEngine(t *testing.T, s3 *fakeS3) *host {
	return startEngineWith(t, s3, Options{})
}

func startEngineWith(t *testing.T, s3 *fakeS3, opts Options) *host {
	t.Helper()
	engineSide, hostSide := net.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() { cancel(); hostSide.Close() })
	if s3 != nil {
		opts.HTTPClient = &http.Client{Transport: s3}
	}
	go Serve(ctx, engineSide, opts)
	return &host{t: t, enc: json.NewEncoder(hostSide), scan: bufio.NewScanner(hostSide), keys: map[string]map[string]string{}}
}

// call sends one request and returns its result, answering any secret.request on the way.
func (h *host) call(method string, params any) json.RawMessage {
	h.t.Helper()
	result, err := h.roundTrip(method, params)
	if err != nil {
		h.t.Fatalf("engine error: %s", err)
	}
	return result
}

// callError sends one request that must fail, and returns the error message.
func (h *host) callError(method string, params any) string {
	h.t.Helper()
	result, err := h.roundTrip(method, params)
	if err == nil {
		h.t.Fatalf("result = %s, want an error", result)
	}
	var e struct {
		Message string `json:"message"`
	}
	json.Unmarshal(err, &e)
	return e.Message
}

func (h *host) roundTrip(method string, params any) (result, err json.RawMessage) {
	h.t.Helper()
	if err := h.enc.Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params}); err != nil {
		h.t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && h.scan.Scan() {
		var msg struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
			Result json.RawMessage `json:"result"`
			Error  json.RawMessage `json:"error"`
		}
		if err := json.Unmarshal(h.scan.Bytes(), &msg); err != nil {
			h.t.Fatal(err)
		}
		if msg.Method == "secret.request" {
			var p struct {
				Account string `json:"account"`
			}
			json.Unmarshal(msg.Params, &p)
			h.enc.Encode(map[string]any{"jsonrpc": "2.0", "id": msg.ID, "result": h.keys[p.Account]})
			continue
		}
		if msg.Method != "" {
			if h.onNotify != nil {
				h.onNotify(msg.Method, msg.Params)
			}
			continue
		}
		return msg.Result, msg.Error
	}
	h.t.Fatal("no reply from engine")
	return nil, nil
}

func TestR2DestTestPutsAndDeletesOnTheR2EndpointWithRegionAuto(t *testing.T) {
	s3 := &fakeS3{}
	h := startEngine(t, s3)
	h.keys["pending.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}

	result := h.call("dest.test", map[string]any{
		"provider": "r2", "name": "personal", "bucket": "public-assets",
		"accountId": "0123456789abcdef0123456789abcdef", "account": "pending.1",
	})

	if string(result) != `{"ok":true}` {
		t.Fatalf("result = %s, want {\"ok\":true}", result)
	}
	if len(s3.requests) != 2 || s3.requests[0].Method != http.MethodPut || s3.requests[1].Method != http.MethodDelete {
		t.Fatalf("want PUT then DELETE, got %v", methods(s3.requests))
	}
	put := s3.requests[0]
	if put.URL.Host != "0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com" {
		t.Errorf("host = %s", put.URL.Host)
	}
	if !strings.HasPrefix(put.URL.Path, "/public-assets/") {
		t.Errorf("path = %s, want the bucket first", put.URL.Path)
	}
	if s3.requests[1].URL.Path != put.URL.Path {
		t.Errorf("DELETE %s is not the PUT object %s", s3.requests[1].URL.Path, put.URL.Path)
	}
	auth := put.Header.Get("Authorization")
	if !strings.Contains(auth, "Credential=AKIDEXAMPLE/") || !strings.Contains(auth, "/auto/s3/aws4_request") {
		t.Errorf("Authorization = %s, want keys from secret.request and region auto", auth)
	}
}

func TestS3DestTestWithKeysUsesTheAWSEndpointForItsRegion(t *testing.T) {
	s3 := &fakeS3{}
	h := startEngine(t, s3)
	h.keys["pending.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}

	result := h.call("dest.test", map[string]any{
		"provider": "s3", "name": "work", "bucket": "build-artifacts", "region": "eu-west-1", "account": "pending.1",
	})

	if string(result) != `{"ok":true}` {
		t.Fatalf("result = %s, want {\"ok\":true}", result)
	}
	put := s3.requests[0]
	if put.URL.Host != "build-artifacts.s3.eu-west-1.amazonaws.com" {
		t.Errorf("host = %s", put.URL.Host)
	}
	if auth := put.Header.Get("Authorization"); !strings.Contains(auth, "/eu-west-1/s3/aws4_request") {
		t.Errorf("Authorization = %s, want region eu-west-1", auth)
	}
}

func TestDestTestGivesTheClearMessageForAStorageError(t *testing.T) {
	cases := []struct {
		status int
		code   string
		want   string
	}{
		{403, "AccessDenied", "personal cannot write to public-assets."},
		{404, "NoSuchBucket", "The bucket public-assets does not exist."},
		{403, "InvalidAccessKeyId", "The access keys for personal are not correct."},
		{403, "SignatureDoesNotMatch", "The access keys for personal are not correct."},
		{403, "RequestTimeTooSkewed", "Your Mac clock is not correct."},
		{400, "ExpiredToken", "Your AWS sign-in expired."},
	}
	for _, c := range cases {
		t.Run(c.code, func(t *testing.T) {
			s3 := &fakeS3{respond: func(r *http.Request) *http.Response {
				body := "<Error><Code>" + c.code + "</Code><Message>from the service</Message></Error>"
				return &http.Response{StatusCode: c.status, Header: http.Header{"Content-Type": {"application/xml"}},
					Body: io.NopCloser(strings.NewReader(body)), Request: r}
			}}
			h := startEngine(t, s3)
			h.keys["pending.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}

			result := h.call("dest.test", map[string]any{
				"provider": "r2", "name": "personal", "bucket": "public-assets",
				"accountId": "0123456789abcdef0123456789abcdef", "account": "pending.1",
			})

			var got struct {
				OK      bool   `json:"ok"`
				Message string `json:"message"`
			}
			json.Unmarshal(result, &got)
			if got.OK || got.Message != c.want {
				t.Errorf("result = %s, want message %q", result, c.want)
			}
		})
	}
}

func TestS3DestTestWithANamedProfileUsesTheProfileKeysAndRegion(t *testing.T) {
	dir := t.TempDir()
	config := dir + "/config"
	os.WriteFile(config, []byte("[profile work]\nregion = us-west-2\naws_access_key_id = AKIDPROFILE\naws_secret_access_key = profilesecret\n"), 0o600)
	t.Setenv("AWS_CONFIG_FILE", config)
	t.Setenv("AWS_SHARED_CREDENTIALS_FILE", dir+"/none")
	s3 := &fakeS3{}
	h := startEngine(t, s3)

	result := h.call("dest.test", map[string]any{"provider": "s3", "name": "work", "bucket": "build-artifacts", "profile": "work"})

	if string(result) != `{"ok":true}` {
		t.Fatalf("result = %s, want {\"ok\":true}", result)
	}
	put := s3.requests[0]
	if put.URL.Host != "build-artifacts.s3.us-west-2.amazonaws.com" {
		t.Errorf("host = %s, want the profile region", put.URL.Host)
	}
	if auth := put.Header.Get("Authorization"); !strings.Contains(auth, "Credential=AKIDPROFILE/") {
		t.Errorf("Authorization = %s, want the profile keys", auth)
	}
}

func TestAWSProfilesListsNamedProfilesAndMarksSSO(t *testing.T) {
	config := t.TempDir() + "/config"
	os.WriteFile(config, []byte(`[default]
region = us-east-1

[profile work]
region = us-west-2
aws_access_key_id = AKIDPROFILE

[profile sso-dev]
sso_session = corp
sso_account_id = 111122223333
sso_role_name = Developer
region = eu-west-1

[sso-session corp]
sso_start_url = https://corp.awsapps.com/start
`), 0o600)
	t.Setenv("AWS_CONFIG_FILE", config)
	h := startEngine(t, &fakeS3{})

	result := h.call("aws.profiles", nil)

	want := `[{"name":"default","region":"us-east-1","sso":false},` +
		`{"name":"work","region":"us-west-2","sso":false},` +
		`{"name":"sso-dev","region":"eu-west-1","sso":true}]`
	if string(result) != want {
		t.Errorf("result = %s\nwant     %s", result, want)
	}
}

func methods(rs []*http.Request) []string {
	var out []string
	for _, r := range rs {
		out = append(out, r.Method)
	}
	return out
}
