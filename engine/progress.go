package engine

import (
	"io"
	"time"
)

// progressInterval is the shortest time between two progress events for one Upload (PRD P4).
const progressInterval = 100 * time.Millisecond

type progressEvent struct {
	ID    string `json:"id"`
	Sent  int64  `json:"sent"`
	Total int64  `json:"total"`
}

// countingReader counts the bytes the HTTP client reads from the file and reports them, throttled.
// A Seek (a retry rewinds the body) moves the count back, so the Host gets in-flight bytes (PRD P3).
type countingReader struct {
	file   io.ReadSeeker
	sent   int64
	total  int64
	report func(sent int64)
	now    func() time.Time
	last   time.Time
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.file.Read(p)
	c.sent += int64(n)
	if t := c.now(); t.Sub(c.last) >= progressInterval {
		c.last = t
		c.report(c.sent)
	}
	return n, err
}

func (c *countingReader) Seek(offset int64, whence int) (int64, error) {
	pos, err := c.file.Seek(offset, whence)
	if err == nil {
		c.sent = pos
	}
	return pos, err
}
