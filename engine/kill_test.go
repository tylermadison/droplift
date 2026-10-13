//go:build realr2

// The kill test (ticket 11) on the real R2 bucket droplift-test, with the AWS profile r2:
//
//	DROPLIFT_R2_ACCOUNT_ID=<account id> go test -tags realr2 -run TestKill -v -timeout 20m ./
//
// It builds the Engine, SIGKILLs it during a multipart Upload some times, resumes each time from the saved
// state, and then downloads the object and compares its SHA-256 with the file.
package engine

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const (
	killBucket   = "droplift-test"
	killFileSize = 160 * mib // 20 Parts of 8 MiB
	killAfter    = 4         // Parts per run before the SIGKILL
	killRuns     = 3         // SIGKILLs before the last run that finishes
)

// The R2 account ID is not in the repo: set DROPLIFT_R2_ACCOUNT_ID.
var killAccountID = os.Getenv("DROPLIFT_R2_ACCOUNT_ID")

// realEngine is one Engine process on a Unix socket, as the Host starts it.
type realEngine struct {
	cmd  *exec.Cmd
	enc  *json.Encoder
	scan *bufio.Scanner
}

func startRealEngine(t *testing.T, bin string) *realEngine {
	t.Helper()
	// A Unix socket path must be short on macOS (104 bytes), and t.TempDir() is too long.
	dir, err := os.MkdirTemp("/tmp", "dl-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	socket := filepath.Join(dir, "engine.sock")
	ln, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	cmd := exec.Command(bin, "--socket", socket)
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	conn, err := ln.Accept()
	if err != nil {
		t.Fatal(err)
	}
	scan := bufio.NewScanner(conn)
	scan.Buffer(make([]byte, 64*1024), 1<<20)
	return &realEngine{cmd: cmd, enc: json.NewEncoder(conn), scan: scan}
}

// run sends one upload request. It saves upload.started and part.done into state, and SIGKILLs the Engine
// after `killAfter` new Parts when kill is true. It gives the result, or nil after a kill.
func (e *realEngine) run(t *testing.T, method string, params map[string]any, state *resumeState, kill bool) *uploadResult {
	t.Helper()
	if err := e.enc.Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params}); err != nil {
		t.Fatal(err)
	}
	newParts := 0
	for e.scan.Scan() {
		var msg struct {
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
			Result json.RawMessage `json:"result"`
			Error  json.RawMessage `json:"error"`
		}
		json.Unmarshal(e.scan.Bytes(), &msg)
		switch msg.Method {
		case "upload.started":
			var s uploadStartedEvent
			json.Unmarshal(msg.Params, &s)
			*state = resumeState{Key: s.Key, UploadID: s.UploadID, Hash: s.Hash}
			t.Logf("upload.started %s", s.UploadID)
		case "part.done":
			var p partDoneEvent
			json.Unmarshal(msg.Params, &p)
			for _, saved := range state.Parts {
				if saved.N == p.N {
					t.Errorf("Part %d was sent again; it was completed before the kill", p.N)
				}
			}
			state.Parts = append(state.Parts, savedPart{N: p.N, ETag: p.ETag, Checksum: p.Checksum})
			newParts++
			if kill && newParts == killAfter {
				e.cmd.Process.Signal(syscall.SIGKILL)
				e.cmd.Wait()
				t.Logf("SIGKILL after %d Parts (%d saved)", newParts, len(state.Parts))
				return nil
			}
		case "":
			if msg.Error != nil {
				t.Fatalf("upload error: %s", msg.Error)
			}
			var r uploadResult
			json.Unmarshal(msg.Result, &r)
			e.cmd.Process.Kill()
			e.cmd.Wait()
			return &r
		}
	}
	t.Fatal("the Engine closed the socket with no result")
	return nil
}

func TestKillTheEngineDuringAMultipartUploadAndResume(t *testing.T) {
	if killAccountID == "" {
		t.Skip("set DROPLIFT_R2_ACCOUNT_ID to the R2 account ID")
	}
	bin := filepath.Join(t.TempDir(), "droplift-engine")
	if out, err := exec.Command("go", "build", "-o", bin, "./cmd/droplift-engine").CombinedOutput(); err != nil {
		t.Fatalf("build: %s", out)
	}
	path := filepath.Join(t.TempDir(), "kill-test.bin")
	data := make([]byte, killFileSize)
	rand.Read(data)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	want := sha256.Sum256(data)

	params := map[string]any{
		"id": "kill.1", "path": path, "partsPerFile": 2,
		"destination": map[string]any{
			"provider": "r2", "name": "Droplift-test", "bucket": killBucket, "accountId": killAccountID, "profile": "r2",
			"keyTemplate": "kill-test/{uuid}/{filename}", "link": map[string]any{"type": "presigned", "ttlSeconds": 60},
		},
	}
	var state resumeState
	start := time.Now()
	var result *uploadResult
	for run := 0; result == nil; run++ {
		method := "upload.enqueue"
		if run > 0 {
			method = "upload.resume"
			params["resume"] = state
		}
		result = startRealEngine(t, bin).run(t, method, params, &state, run < killRuns)
	}
	t.Logf("done in %s: key %s, checksum %s, %d Parts saved", time.Since(start).Round(time.Millisecond), result.Key, result.Checksum, len(state.Parts))
	if len(state.Parts) != killFileSize/(8*mib) {
		t.Errorf("Parts sent = %d, want each of the %d Parts once", len(state.Parts), killFileSize/(8*mib))
	}

	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithSharedConfigProfile("r2"))
	if err != nil {
		t.Fatal(err)
	}
	client := s3.NewFromConfig(cfg, (&session{}).providerOptions(destTestParams{Provider: "r2", AccountID: killAccountID}))
	defer client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(killBucket), Key: &result.Key})
	obj, err := client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(killBucket), Key: &result.Key})
	if err != nil {
		t.Fatal(err)
	}
	defer obj.Body.Close()
	h := sha256.New()
	n, err := io.Copy(h, obj.Body)
	if err != nil {
		t.Fatal(err)
	}
	if got := h.Sum(nil); n != killFileSize || hex.EncodeToString(got) != hex.EncodeToString(want[:]) {
		t.Errorf("object = %d bytes, sha256 %x; want %d bytes, sha256 %x", n, got, killFileSize, want)
	}
}
