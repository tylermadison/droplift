//go:build realr2

// Pause, resume, and cancel (ticket 12) on the real R2 bucket droplift-test, with the AWS profile r2:
//
//	DROPLIFT_R2_ACCOUNT_ID=<account id> go test -tags realr2 -run TestPauseResumeCancel -v -timeout 10m ./
package engine

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// until reads messages until the reply to `id`; it saves upload.started and part.done into state,
// and calls onPart after each new Part.
func (e *realEngine) until(t *testing.T, id int, state *resumeState, onPart func(n int)) json.RawMessage {
	t.Helper()
	for e.scan.Scan() {
		var msg struct {
			ID     int             `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
			Error  json.RawMessage `json:"error"`
		}
		json.Unmarshal(e.scan.Bytes(), &msg)
		switch msg.Method {
		case "upload.started":
			var s uploadStartedEvent
			json.Unmarshal(msg.Params, &s)
			*state = resumeState{Key: s.Key, UploadID: s.UploadID, Hash: s.Hash}
		case "part.done":
			var p partDoneEvent
			json.Unmarshal(msg.Params, &p)
			for _, saved := range state.Parts {
				if saved.N == p.N {
					t.Errorf("Part %d was sent again after the resume", p.N)
				}
			}
			state.Parts = append(state.Parts, savedPart{N: p.N, ETag: p.ETag, Checksum: p.Checksum})
			if onPart != nil {
				onPart(len(state.Parts))
			}
		case "":
			if msg.ID == id {
				return msg.Error
			}
		}
	}
	t.Fatal("the Engine closed the socket")
	return nil
}

func (e *realEngine) send(id int, method string, params any) {
	e.enc.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
}

func TestPauseResumeCancelOnR2LeavesNoIncompleteMultipartUpload(t *testing.T) {
	if killAccountID == "" {
		t.Skip("set DROPLIFT_R2_ACCOUNT_ID to the R2 account ID")
	}
	bin := filepath.Join(t.TempDir(), "droplift-engine")
	if out, err := exec.Command("go", "build", "-o", bin, "./cmd/droplift-engine").CombinedOutput(); err != nil {
		t.Fatalf("build: %s", out)
	}
	path := filepath.Join(t.TempDir(), "control-test.bin")
	data := make([]byte, 80*mib) // 10 Parts of 8 MiB
	rand.Read(data)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	destination := map[string]any{
		"provider": "r2", "name": "Droplift-test", "bucket": killBucket, "accountId": killAccountID, "profile": "r2",
		"keyTemplate": "control-test/{uuid}/{name}.{ext}", "link": map[string]any{"type": "presigned", "ttlSeconds": 60},
	}
	params := map[string]any{"id": "c.1", "path": path, "partsPerFile": 2, "destination": destination}

	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithSharedConfigProfile("r2"))
	if err != nil {
		t.Fatal(err)
	}
	client := s3.NewFromConfig(cfg, (&session{}).providerOptions(destTestParams{Provider: "r2", AccountID: killAccountID}))
	incomplete := func(key string) int {
		out, err := client.ListMultipartUploads(ctx, &s3.ListMultipartUploadsInput{Bucket: aws.String(killBucket), Prefix: &key})
		if err != nil {
			t.Fatal(err)
		}
		return len(out.Uploads)
	}

	e := startRealEngine(t, bin)
	defer func() { e.cmd.Process.Kill(); e.cmd.Wait() }()
	var state resumeState

	// Pause after 2 Parts: the multipart upload stays on R2.
	e.send(1, "upload.enqueue", params)
	e.until(t, 1, &state, func(n int) {
		if n == 2 {
			e.send(2, "upload.pause", map[string]any{"id": "c.1"})
		}
	})
	paused := len(state.Parts)
	if n := incomplete(state.Key); n != 1 {
		t.Fatalf("incomplete multipart uploads after the pause = %d, want 1 (kept for the resume)", n)
	}
	t.Logf("paused with %d Parts on %s", paused, state.Key)

	// Resume from the saved Parts, then cancel after 2 more Parts: no incomplete upload and no object stay.
	params["resume"] = state
	e.send(3, "upload.resume", params)
	e.until(t, 3, &state, func(n int) {
		if n == paused+2 {
			e.send(4, "upload.cancel", map[string]any{"id": "c.1", "destination": destination})
		}
	})
	// The upload call ends when the cancel stops it; the abort ends before the cancel's own reply.
	if err := e.until(t, 4, &state, nil); err != nil {
		t.Fatalf("upload.cancel error: %s", err)
	}
	if n := incomplete(state.Key); n != 0 {
		t.Errorf("incomplete multipart uploads after the cancel = %d, want 0 (PRD U7)", n)
	}
	if _, err := client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(killBucket), Key: &state.Key}); err == nil {
		t.Errorf("the object %s exists after the cancel, want none", state.Key)
	}
	t.Logf("cancelled after %d Parts; no incomplete multipart upload", len(state.Parts))
}
