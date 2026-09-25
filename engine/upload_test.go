package engine

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var fixedNow = func() time.Time { return time.Date(2026, 9, 4, 13, 5, 0, 0, time.UTC) }

func writeFile(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func enqueue(t *testing.T, h *host, params map[string]any) uploadResult {
	t.Helper()
	var got uploadResult
	if err := json.Unmarshal(h.call("upload.enqueue", params), &got); err != nil {
		t.Fatal(err)
	}
	return got
}

func r2Upload(path string, link map[string]any) map[string]any {
	return map[string]any{
		"id": "u1", "path": path,
		"destination": map[string]any{
			"provider": "r2", "name": "personal", "bucket": "public-assets",
			"accountId": "0123456789abcdef0123456789abcdef", "account": "account.1", "link": link,
		},
	}
}

func TestUploadWithAPresignedLinkGivesASignedGetURLThatExpiresAfterTheTTL(t *testing.T) {
	s3 := &fakeS3{}
	h := startEngineWith(t, s3, Options{Now: fixedNow})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	path := writeFile(t, "report.pdf", "")

	got := enqueue(t, h, r2Upload(path, map[string]any{"type": "presigned", "ttlSeconds": 86400}))

	link, err := url.Parse(got.Link)
	if err != nil {
		t.Fatal(err)
	}
	q := link.Query()
	if link.Host != "0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com" || link.Path != "/public-assets/2026/09/report-af1349b9.pdf" {
		t.Errorf("link = %s, want the object on the R2 endpoint", got.Link)
	}
	if q.Get("X-Amz-Expires") != "86400" || q.Get("X-Amz-Signature") == "" || !strings.HasPrefix(q.Get("X-Amz-Credential"), "AKIDEXAMPLE/") {
		t.Errorf("link = %s, want a signed URL that expires in 86400 s", got.Link)
	}
	if len(s3.requests) != 1 {
		t.Errorf("want only the PUT on the network, got %v", methods(s3.requests))
	}
}

func TestUploadWithAPublicLinkPutsTheFileUnderTheTemplateKey(t *testing.T) {
	s3 := &fakeS3{}
	h := startEngineWith(t, s3, Options{Now: fixedNow})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	// BLAKE3 of empty input starts with af1349b9 (BLAKE3 spec test vector).
	path := writeFile(t, "Screen Shot.png", "")

	got := enqueue(t, h, r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"}))

	if got.Key != "2026/09/Screen Shot-af1349b9.png" {
		t.Errorf("key = %q", got.Key)
	}
	if got.Link != "https://cdn.example.com/2026/09/Screen%20Shot-af1349b9.png" {
		t.Errorf("link = %q", got.Link)
	}
	if len(s3.requests) != 1 || s3.requests[0].Method != http.MethodPut ||
		s3.requests[0].URL.Path != "/public-assets/2026/09/Screen Shot-af1349b9.png" {
		t.Errorf("want one PUT of the key, got %v %v", methods(s3.requests), s3.requests)
	}
}

func TestUploadSendsTheFileBytesAndRecordsETagAndChecksum(t *testing.T) {
	s3 := &fakeS3{respond: func(r *http.Request) *http.Response {
		return &http.Response{StatusCode: http.StatusOK, Body: http.NoBody, Request: r, Header: http.Header{
			"Etag": {`"9b2cf535f27731c974343645a3985328"`}, "X-Amz-Checksum-Crc64nvme": {"W8SAu7iSyXM="},
		}}
	}}
	h := startEngineWith(t, s3, Options{Now: fixedNow})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	path := writeFile(t, "notes.txt", "hello from droplift\n")

	got := enqueue(t, h, r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"}))

	if !strings.Contains(s3.bodies[0], "hello from droplift\n") {
		t.Errorf("PUT body = %q, want the file bytes", s3.bodies[0])
	}
	if got.ETag != "9b2cf535f27731c974343645a3985328" || got.Checksum != "W8SAu7iSyXM=" {
		t.Errorf("etag = %q, checksum = %q", got.ETag, got.Checksum)
	}
}

func TestUploadResultHasTheFileSize(t *testing.T) {
	h := startEngineWith(t, &fakeS3{}, Options{Now: fixedNow})
	h.keys["account.1"] = map[string]string{"accessKeyId": "AKIDEXAMPLE", "secretAccessKey": "wJalrXUtnFEMI/K7MDENG"}
	path := writeFile(t, "notes.txt", "hello from droplift\n") // 20 bytes

	var got struct {
		Size int64 `json:"size"`
	}
	json.Unmarshal(h.call("upload.enqueue", r2Upload(path, map[string]any{"type": "public", "baseUrl": "https://cdn.example.com"})), &got)

	if got.Size != 20 {
		t.Errorf("size = %d, want 20", got.Size)
	}
}
