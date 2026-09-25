package engine

import (
	"context"
	"errors"
	"math/rand/v2"
	"time"

	"github.com/aws/smithy-go"
	smithyhttp "github.com/aws/smithy-go/transport/http"
)

// Backoff for retryable failures: exponential with full jitter (PRD U5).
const (
	retryBase = 500 * time.Millisecond
	retryMax  = 30 * time.Second
	maxTries  = 8
)

// retry runs op until it succeeds, fails with an error that does not retry, or has run maxTries times.
// It returns the number of retries (tries after the first).
func (s *session) retry(ctx context.Context, op func() error) (retries int, err error) {
	for try := 1; ; try++ {
		err = op()
		if err == nil || !retryable(err) || try == maxTries {
			return try - 1, err
		}
		wait := time.Duration(s.jitter() * float64(min(retryMax, retryBase<<(try-1))))
		if err := s.sleep(ctx, wait); err != nil {
			return try - 1, err
		}
	}
}

// retryable is the retry decision table (PRD U5): 5xx, 429, S3 SlowDown and RequestTimeout,
// and network errors with no HTTP status. Other 4xx errors do not retry.
func retryable(err error) bool {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "SlowDown", "RequestTimeout":
			return true
		}
	}
	var sendErr *smithyhttp.RequestSendError
	if errors.As(err, &sendErr) {
		return true
	}
	var resp *smithyhttp.ResponseError
	if errors.As(err, &resp) {
		status := resp.HTTPStatusCode()
		return status >= 500 || status == 429
	}
	return false
}

func (s *session) sleep(ctx context.Context, d time.Duration) error {
	if s.opts.Sleep != nil {
		return s.opts.Sleep(ctx, d)
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// jitter is a random fraction in [0, 1) for full jitter.
func (s *session) jitter() float64 {
	if s.opts.Jitter != nil {
		return s.opts.Jitter()
	}
	return rand.Float64()
}
