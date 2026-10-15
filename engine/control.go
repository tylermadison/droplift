package engine

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Pause and cancel of a running Upload (PRD U7, ticket 12).
// A pause keeps the multipart upload, like a kill (ticket 11): upload.resume continues it.
// A cancel aborts every multipart upload of the key, so no Parts stay on the Destination.

var (
	errPaused    = errors.New("the upload was paused")
	errCancelled = errors.New("the upload was cancelled")
)

// runningUpload is one upload.enqueue or upload.resume call in flight.
type runningUpload struct {
	stop context.CancelCauseFunc
	done chan struct{}
	key  string // Set when the key is known; guarded by session.runMu.
}

type controlParams struct {
	ID          string         `json:"id"`
	Destination destTestParams `json:"destination"`
	// Key is the saved key of an Upload that does not run (paused, or stopped by a kill).
	Key string `json:"key"`
}

// runUpload runs one Upload so that upload.pause and upload.cancel can stop it.
func (s *session) runUpload(ctx context.Context, p uploadParams) (uploadResult, error) {
	ctx, stop := context.WithCancelCause(ctx)
	defer stop(nil)
	r := &runningUpload{stop: stop, done: make(chan struct{})}
	s.runMu.Lock()
	s.running[p.ID] = r
	s.runMu.Unlock()
	defer func() {
		s.runMu.Lock()
		if s.running[p.ID] == r {
			delete(s.running, p.ID)
		}
		s.runMu.Unlock()
		close(r.done)
	}()
	return s.upload(ctx, p, func(key string) {
		s.runMu.Lock()
		r.key = key
		s.runMu.Unlock()
	})
}

// stopUpload stops the running call of one Upload with a cause, waits until it ended, and gives its key.
func (s *session) stopUpload(id string, cause error) string {
	s.runMu.Lock()
	r := s.running[id]
	s.runMu.Unlock()
	if r == nil {
		return ""
	}
	r.stop(cause)
	<-r.done
	return r.key
}

func (s *session) pauseUpload(p controlParams) struct{} {
	s.stopUpload(p.ID, errPaused)
	return struct{}{}
}

func (s *session) cancelUpload(ctx context.Context, p controlParams) (struct{}, error) {
	key := s.stopUpload(p.ID, errCancelled)
	if key == "" {
		key = p.Key
	}
	if key == "" {
		return struct{}{}, nil
	}
	client, err := s.s3Client(ctx, p.Destination)
	if err != nil {
		return struct{}{}, err
	}
	return struct{}{}, s.abortAll(ctx, client, p.Destination.Bucket, key)
}

// abortAll aborts every multipart upload of one key, also one whose upload ID the Host never got.
func (s *session) abortAll(ctx context.Context, client *s3.Client, bucket, key string) error {
	pages := s3.NewListMultipartUploadsPaginator(client, &s3.ListMultipartUploadsInput{Bucket: &bucket, Prefix: &key})
	for pages.HasMorePages() {
		var page *s3.ListMultipartUploadsOutput
		if _, err := s.retry(ctx, func() (err error) {
			page, err = pages.NextPage(ctx)
			return err
		}); err != nil {
			return err
		}
		for _, u := range page.Uploads {
			if aws.ToString(u.Key) != key {
				continue
			}
			uploadID := aws.ToString(u.UploadId)
			if _, err := s.retry(ctx, func() error {
				_, err := client.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{Bucket: &bucket, Key: &key, UploadId: &uploadID})
				return err
			}); err != nil && !noSuchUpload(err) {
				return err
			}
		}
	}
	return nil
}

func decode[T any](params json.RawMessage) (T, error) {
	var p T
	err := json.Unmarshal(params, &p)
	return p, err
}
