package engine

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/zeebo/blake3"
)

type linkConfig struct {
	Type       string `json:"type"` // "public" or "presigned"
	BaseURL    string `json:"baseUrl"`
	TTLSeconds int    `json:"ttlSeconds"`
}

type uploadParams struct {
	ID          string         `json:"id"`
	Path        string         `json:"path"`
	Destination destTestParams `json:"destination"`
	// PartsPerFile is the most Parts in flight for a multipart Upload; 0 means the default.
	PartsPerFile int `json:"partsPerFile"`
	// Resume is the saved state of a multipart Upload that a crash or a kill stopped (upload.resume, PRD U6).
	Resume *resumeState `json:"resume,omitempty"`
}

// resumeState is what the Host saved from upload.started and the part.done events.
type resumeState struct {
	Key      string      `json:"key"`
	UploadID string      `json:"uploadId"`
	Hash     string      `json:"hash"`
	Parts    []savedPart `json:"parts"`
}

type savedPart struct {
	N        int32  `json:"n"`
	ETag     string `json:"etag"`
	Checksum string `json:"checksum"`
}

type uploadResult struct {
	ID       string `json:"id"`
	Key      string `json:"key"`
	ETag     string `json:"etag"`
	Checksum string `json:"checksum"`
	Link     string `json:"link"`
	Size     int64  `json:"size"`
	// Retries is the number of retries over all calls of this Upload (ticket 10).
	Retries int `json:"retries"`
}

// upload sends one file to one Destination, streamed from disk: a single PUT below 16 MiB, multipart above (PRD U1, U10, R5, R6).
func (s *session) upload(ctx context.Context, p uploadParams) (uploadResult, error) {
	d := p.Destination
	f, err := os.Open(p.Path)
	if err != nil {
		return uploadResult{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return uploadResult{}, err
	}

	// Hash in one streaming pass, then rewind for the PUT.
	h := blake3.New()
	if _, err := io.Copy(h, f); err != nil {
		return uploadResult{}, err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return uploadResult{}, err
	}

	hash := hex.EncodeToString(h.Sum(nil))
	template := d.KeyTemplate
	if template == "" {
		template = DefaultKeyTemplate
	}
	key := RenderKey(template, KeyInput{
		FileName: filepath.Base(p.Path),
		Time:     s.now(),
		Hash:     hash,
		UUID:     newUUID(),
	})

	client, err := s.s3Client(ctx, d)
	if err != nil {
		return uploadResult{}, err
	}
	total := info.Size()
	if r := p.Resume; r != nil {
		if r.Hash == hash && total >= multipartThreshold {
			key = r.Key
		} else {
			// The file changed after the crash: the saved Parts are not its bytes (PRD §8: 0 corrupt objects).
			s.abort(ctx, client, d.Bucket, r.Key, r.UploadID)
			p.Resume = nil
		}
	}
	// A retry rewinds the body; the Host still sees the highest value, so progress never goes back (PRD P3).
	var shown int64
	report := func(sent int64) {
		shown = max(shown, min(sent, total))
		s.notify("progress", progressEvent{ID: p.ID, Sent: shown, Total: total})
	}
	var etag, checksum string
	var retries int
	if total >= multipartThreshold {
		etag, checksum, retries, err = s.uploadParts(ctx, client, f, p, key, hash, total, report)
	} else {
		body := &countingReader{file: f, total: total, report: report, now: s.now}
		var out *s3.PutObjectOutput
		retries, err = s.retry(ctx, func() (err error) {
			if _, err := body.Seek(0, io.SeekStart); err != nil {
				return err
			}
			out, err = client.PutObject(ctx, &s3.PutObjectInput{
				Bucket: &d.Bucket, Key: &key, Body: body, ContentLength: aws.Int64(total),
			})
			return err
		})
		if err == nil {
			etag, checksum = aws.ToString(out.ETag), firstNonEmpty(out.ChecksumCRC64NVME, out.ChecksumCRC32, out.ChecksumCRC32C)
		}
	}
	if err != nil {
		return uploadResult{}, &uploadError{message: clearMessage(err, d), retries: retries}
	}
	report(total)

	link, err := s.link(ctx, client, d, key)
	if err != nil {
		return uploadResult{}, err
	}
	return uploadResult{
		ID:       p.ID,
		Key:      key,
		ETag:     strings.Trim(etag, `"`),
		Checksum: checksum,
		Link:     link,
		Size:     total,
		Retries:  retries,
	}, nil
}

func (s *session) link(ctx context.Context, client *s3.Client, d destTestParams, key string) (string, error) {
	switch d.Link.Type {
	case "public":
		return strings.TrimRight(d.Link.BaseURL, "/") + "/" + escapeKey(key), nil
	case "presigned":
		req, err := s3.NewPresignClient(client).PresignGetObject(ctx, &s3.GetObjectInput{Bucket: &d.Bucket, Key: &key},
			s3.WithPresignExpires(time.Duration(d.Link.TTLSeconds)*time.Second))
		if err != nil {
			return "", err
		}
		return req.URL, nil
	}
	return "", fmt.Errorf("unknown link type %q", d.Link.Type)
}

// escapeKey encodes each path segment of an object key for a URL, and keeps the slashes.
func escapeKey(key string) string {
	parts := strings.Split(key, "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return strings.Join(parts, "/")
}

func firstNonEmpty(values ...*string) string {
	for _, v := range values {
		if aws.ToString(v) != "" {
			return aws.ToString(v)
		}
	}
	return ""
}

func newUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
