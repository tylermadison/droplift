package engine

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

// multipartThreshold is the file size from which an Upload goes in Parts (PRD U1).
const multipartThreshold = 16 << 20

// abortTimeout limits the clean-up call after a failed multipart upload.
const abortTimeout = 10 * time.Second

// defaultPartsPerFile is the most Parts of one file in flight at the same time, if the Host does not set it (PRD U4).
const defaultPartsPerFile = 4

// uploadStartedEvent tells the Host the state it must save to resume a multipart Upload after a crash (PRD U6).
type uploadStartedEvent struct {
	ID       string `json:"id"`
	Key      string `json:"key"`
	UploadID string `json:"uploadId"`
	// Hash is the blake3 of the file; a resume of a changed file starts again.
	Hash string `json:"hash"`
}

// partDoneEvent tells the Host that one Part is uploaded; the Host keeps it as a `parts` row (PRD §9.2, §9.6).
// The ETag and the checksum go back in CompleteMultipartUpload when the Upload resumes.
type partDoneEvent struct {
	ID         string    `json:"id"`
	N          int32     `json:"n"`
	Size       int64     `json:"size"`
	ETag       string    `json:"etag"`
	Checksum   string    `json:"checksum"`
	StartedAt  time.Time `json:"startedAt"`
	FinishedAt time.Time `json:"finishedAt"`
	Retries    int       `json:"retries"`
	BPS        float64   `json:"bps"`
}

func bytesPerSecond(n int64, d time.Duration) float64 {
	if d <= 0 {
		return 0
	}
	return float64(n) / d.Seconds()
}

// partSize is max(8 MiB, ceil(size / 10000)): S3 allows at most 10,000 Parts (PRD U1).
func partSize(size int64) int64 {
	return max(8<<20, (size+9999)/10000)
}

// uploadParts sends the file as a multipart upload. Each Part reads its own section of the file,
// so no Part is held in memory, and all Parts except the last have the same size (PRD U2).
// With p.Resume, it continues the saved upload and sends only the Parts that the Destination does not have (PRD U6).
func (s *session) uploadParts(ctx context.Context, client *s3.Client, f io.ReaderAt, p uploadParams, key, hash string, total int64, report func(int64)) (etag, checksum string, retries int, err error) {
	id, bucket := p.ID, p.Destination.Bucket
	// The retries of all calls of this Upload; the Parts add to it in parallel.
	var allRetries atomic.Int64
	sum := func() int { return int(allRetries.Load()) }
	retry := func(ctx context.Context, op func() error) (int, error) {
		n, err := s.retry(ctx, op)
		allRetries.Add(int64(n))
		return n, err
	}

	size := partSize(total)
	count := int((total + size - 1) / size)
	parts := make([]types.CompletedPart, count)
	var committed int64
	var uploadID *string
	if r := p.Resume; r != nil {
		listed, err := s.listParts(ctx, client, bucket, key, r.UploadID, retry)
		if err != nil && !noSuchUpload(err) {
			return "", "", sum(), err
		}
		// A gone upload (aborted, or expired by a lifecycle rule) starts again on the same key.
		if err == nil {
			uploadID = &r.UploadID
			for _, saved := range r.Parts {
				i := int(saved.N) - 1
				// Keep only a Part that the Destination has with the same ETag; send the others again.
				if i < 0 || i >= count || listed[saved.N] != saved.ETag {
					continue
				}
				parts[i] = types.CompletedPart{PartNumber: aws.Int32(saved.N), ETag: aws.String(saved.ETag), ChecksumCRC32: aws.String(saved.Checksum)}
				committed += min(size, total-int64(i)*size)
			}
		}
	}
	if uploadID == nil {
		var created *s3.CreateMultipartUploadOutput
		_, err = retry(ctx, func() (err error) {
			created, err = client.CreateMultipartUpload(ctx, &s3.CreateMultipartUploadInput{
				Bucket: &bucket, Key: &key, ChecksumAlgorithm: types.ChecksumAlgorithmCrc32,
			})
			return err
		})
		if err != nil {
			return "", "", sum(), err
		}
		uploadID = created.UploadId
		s.notify("upload.started", uploadStartedEvent{ID: id, Key: key, UploadID: aws.ToString(uploadID), Hash: hash})
	}
	// A failed Upload aborts its multipart upload, so no Parts stay on the Destination.
	// A cancel (the Engine stops, or the Host closed the connection) keeps it: the next start resumes it (PRD U6).
	defer func() {
		if err != nil && ctx.Err() == nil {
			s.abort(ctx, client, bucket, key, aws.ToString(uploadID))
		}
	}()
	// Progress starts at the committed bytes, so the bar does not go back to 0 on a resume (PRD P3).
	progress := &partsProgress{report: report, now: s.now, sent: committed}
	report(committed)
	partsCtx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	limit := p.PartsPerFile
	if limit <= 0 {
		limit = defaultPartsPerFile
	}
	slots := make(chan struct{}, limit)
	var wg sync.WaitGroup
	for i := range count {
		if parts[i].ETag != nil {
			continue
		}
		slots <- struct{}{}
		if partsCtx.Err() != nil {
			break
		}
		wg.Add(1)
		go func() {
			defer func() { <-slots; wg.Done() }()
			n, start := int32(i+1), int64(i)*size
			length := min(size, total-start)
			startedAt := s.now()
			body := &partReader{part: io.NewSectionReader(f, start, length), progress: progress}
			var out *s3.UploadPartOutput
			partRetries, err := retry(partsCtx, func() (err error) {
				if _, err := body.Seek(0, io.SeekStart); err != nil {
					return err
				}
				out, err = client.UploadPart(partsCtx, &s3.UploadPartInput{
					Bucket: &bucket, Key: &key, UploadId: uploadID, PartNumber: aws.Int32(n), ChecksumAlgorithm: types.ChecksumAlgorithmCrc32,
					Body: body, ContentLength: aws.Int64(length),
				})
				return err
			})
			if err != nil {
				cancel(err)
				return
			}
			parts[i] = types.CompletedPart{PartNumber: aws.Int32(n), ETag: out.ETag, ChecksumCRC32: out.ChecksumCRC32}
			finishedAt := s.now()
			s.notify("part.done", partDoneEvent{ID: id, N: n, Size: length, ETag: strings.Trim(aws.ToString(out.ETag), `"`), Checksum: aws.ToString(out.ChecksumCRC32),
				StartedAt: startedAt.UTC(), FinishedAt: finishedAt.UTC(), Retries: partRetries, BPS: bytesPerSecond(length, finishedAt.Sub(startedAt))})
		}()
	}
	wg.Wait()
	if err := context.Cause(partsCtx); err != nil {
		return "", "", sum(), err
	}
	var done *s3.CompleteMultipartUploadOutput
	_, err = retry(ctx, func() (err error) {
		done, err = client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
			Bucket: &bucket, Key: &key, UploadId: uploadID,
			MultipartUpload: &types.CompletedMultipartUpload{Parts: parts},
		})
		return err
	})
	if err != nil {
		return "", "", sum(), err
	}
	return aws.ToString(done.ETag), firstNonEmpty(done.ChecksumCRC64NVME, done.ChecksumCRC32, done.ChecksumCRC32C), sum(), nil
}

// listParts gives the ETag (no quotes) of each Part that the Destination has for one multipart upload.
func (s *session) listParts(ctx context.Context, client *s3.Client, bucket, key, uploadID string, retry func(context.Context, func() error) (int, error)) (map[int32]string, error) {
	listed := map[int32]string{}
	pages := s3.NewListPartsPaginator(client, &s3.ListPartsInput{Bucket: &bucket, Key: &key, UploadId: &uploadID})
	for pages.HasMorePages() {
		var page *s3.ListPartsOutput
		if _, err := retry(ctx, func() (err error) {
			page, err = pages.NextPage(ctx)
			return err
		}); err != nil {
			return nil, err
		}
		for _, part := range page.Parts {
			listed[aws.ToInt32(part.PartNumber)] = strings.Trim(aws.ToString(part.ETag), `"`)
		}
	}
	return listed, nil
}

// abort removes a multipart upload and its Parts. It is clean-up: it runs also after a cancel, and an error is ignored.
func (s *session) abort(ctx context.Context, client *s3.Client, bucket, key, uploadID string) {
	abortCtx, stop := context.WithTimeout(context.WithoutCancel(ctx), abortTimeout)
	defer stop()
	client.AbortMultipartUpload(abortCtx, &s3.AbortMultipartUploadInput{Bucket: &bucket, Key: &key, UploadId: &uploadID})
}

func noSuchUpload(err error) bool {
	var apiErr smithy.APIError
	return errors.As(err, &apiErr) && apiErr.ErrorCode() == "NoSuchUpload"
}
