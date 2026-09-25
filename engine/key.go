package engine

import (
	"strings"
	"time"
)

// DefaultKeyTemplate is the path template a Destination gets when it sets none (PRD R5).
const DefaultKeyTemplate = "{yyyy}/{mm}/{name}-{hash8}.{ext}"

// KeyInput is what a path template can use.
type KeyInput struct {
	FileName string
	Time     time.Time
	Hash     string // hex content hash; {hash8} is its first 8 characters
	UUID     string
}

// RenderKey fills a path template: {yyyy} {mm} {dd} {name} {ext} {hash8} {uuid}.
// A file with no extension also loses the "." in front of {ext}.
func RenderKey(template string, in KeyInput) string {
	name, ext := in.FileName, ""
	if i := strings.LastIndex(in.FileName, "."); i > 0 {
		name, ext = in.FileName[:i], in.FileName[i+1:]
	}
	if ext == "" {
		template = strings.ReplaceAll(template, ".{ext}", "")
	}
	hash8 := in.Hash
	if len(hash8) > 8 {
		hash8 = hash8[:8]
	}
	return strings.NewReplacer(
		"{yyyy}", in.Time.Format("2006"),
		"{mm}", in.Time.Format("01"),
		"{dd}", in.Time.Format("02"),
		"{name}", name,
		"{ext}", ext,
		"{hash8}", hash8,
		"{uuid}", in.UUID,
	).Replace(template)
}
