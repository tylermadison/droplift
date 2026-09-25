package engine

import (
	"context"
	"io"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go/middleware"
)

// multipartThreshold is the file size from which an Upload goes in Parts (PRD U1).
const multipartThreshold = 16 << 20

// abortTimeout limits the clean-up call after a failed multipart upload.
const abortTimeout = 10 * time.Second

// defaultPartsPerFile is the most Parts of one file in flight at the same time, if the Host does not set it (PRD U4).
const defaultPartsPerFile = 4

// partDoneEvent tells the Host that one Part is uploaded; the Host keeps it as a `parts` row (PRD §9.2, §9.6).
type partDoneEvent struct {
	ID         string    `json:"id"`
	N          int32     `json:"n"`
	Size       int64     `json:"size"`
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
func (s *session) uploadParts(ctx context.Context, client *s3.Client, f io.ReaderAt, p uploadParams, key string, total int64, progress *partsProgress) (etag, checksum string, err error) {
	id, bucket := p.ID, p.Destination.Bucket
	created, err := client.CreateMultipartUpload(ctx, &s3.CreateMultipartUploadInput{
		Bucket: &bucket, Key: &key, ChecksumAlgorithm: types.ChecksumAlgorithmCrc32,
	})
	if err != nil {
		return "", "", err
	}
	// A failed Upload aborts its multipart upload, so no Parts stay on the Destination (ticket 11 will resume instead).
	defer func() {
		if err != nil {
			abortCtx, stop := context.WithTimeout(context.WithoutCancel(ctx), abortTimeout)
			defer stop()
			client.AbortMultipartUpload(abortCtx, &s3.AbortMultipartUploadInput{Bucket: &bucket, Key: &key, UploadId: created.UploadId})
		}
	}()
	size := partSize(total)
	count := int((total + size - 1) / size)
	parts := make([]types.CompletedPart, count)
	partsCtx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	limit := p.PartsPerFile
	if limit <= 0 {
		limit = defaultPartsPerFile
	}
	slots := make(chan struct{}, limit)
	var wg sync.WaitGroup
	for i := range count {
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
			var attempts int
			out, err := client.UploadPart(partsCtx, &s3.UploadPartInput{
				Bucket: &bucket, Key: &key, UploadId: created.UploadId, PartNumber: aws.Int32(n), ChecksumAlgorithm: types.ChecksumAlgorithmCrc32,
				Body: &partReader{part: io.NewSectionReader(f, start, length), progress: progress}, ContentLength: aws.Int64(length),
			}, countAttempts(&attempts))
			if err != nil {
				cancel(err)
				return
			}
			parts[i] = types.CompletedPart{PartNumber: aws.Int32(n), ETag: out.ETag, ChecksumCRC32: out.ChecksumCRC32}
			finishedAt := s.now()
			s.notify("part.done", partDoneEvent{ID: id, N: n, Size: length, StartedAt: startedAt.UTC(), FinishedAt: finishedAt.UTC(),
				Retries: attempts - 1, BPS: bytesPerSecond(length, finishedAt.Sub(startedAt))})
		}()
	}
	wg.Wait()
	if err := context.Cause(partsCtx); err != nil {
		return "", "", err
	}
	done, err := client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket: &bucket, Key: &key, UploadId: created.UploadId,
		MultipartUpload: &types.CompletedMultipartUpload{Parts: parts},
	})
	if err != nil {
		return "", "", err
	}
	return aws.ToString(done.ETag), firstNonEmpty(done.ChecksumCRC64NVME, done.ChecksumCRC32, done.ChecksumCRC32C), nil
}

// countAttempts counts the tries of one call, including the SDK retries.
func countAttempts(n *int) func(*s3.Options) {
	return func(o *s3.Options) {
		o.APIOptions = append(o.APIOptions, func(stack *middleware.Stack) error {
			return stack.Finalize.Insert(middleware.FinalizeMiddlewareFunc("CountAttempts",
				func(ctx context.Context, in middleware.FinalizeInput, next middleware.FinalizeHandler) (middleware.FinalizeOutput, middleware.Metadata, error) {
					*n++
					return next.HandleFinalize(ctx, in)
				}), "Retry", middleware.After)
		})
	}
}
