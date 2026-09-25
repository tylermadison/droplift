package engine

import (
	"testing"
	"time"
)

func TestRenderKey(t *testing.T) {
	in := KeyInput{
		FileName: "Screen Shot 2026-09-24.png",
		Time:     time.Date(2026, 9, 4, 13, 5, 0, 0, time.UTC),
		Hash:     "1a2b3c4d5e6f7a8b9c0d",
		UUID:     "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
	}
	cases := []struct {
		name     string
		template string
		file     string
		want     string
	}{
		{"default template", DefaultKeyTemplate, "", "2026/09/Screen Shot 2026-09-24-1a2b3c4d.png"},
		{"date tokens", "{yyyy}-{mm}-{dd}/{name}.{ext}", "", "2026-09-04/Screen Shot 2026-09-24.png"},
		{"uuid token", "u/{uuid}.{ext}", "", "u/6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f.png"},
		{"no extension drops the dot", DefaultKeyTemplate, "notes", "2026/09/notes-1a2b3c4d"},
		{"only the last dot starts the extension", "{name}|{ext}", "archive.tar.gz", "archive.tar|gz"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			input := in
			if c.file != "" {
				input.FileName = c.file
			}
			if got := RenderKey(c.template, input); got != c.want {
				t.Errorf("RenderKey(%q) = %q, want %q", c.template, got, c.want)
			}
		})
	}
}
