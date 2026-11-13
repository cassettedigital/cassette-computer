package main

import "testing"

func TestSniffImage(t *testing.T) {
	cases := []struct {
		head []byte
		want bool
	}{
		{[]byte{0xFF, 0xD8, 0xFF, 0xE0}, true},                       // JPEG
		{[]byte("\x89PNG\r\n\x1a\n\x00\x00"), true},                  // PNG
		{append([]byte("RIFF\x00\x00\x00\x00"), []byte("WEBP")...), true}, // WebP
		{[]byte("GIF89a\x00\x00"), true},                             // GIF
		{[]byte("GIF87a\x00\x00"), true},                             // GIF (older)
		{[]byte("fLaC\x00\x00\x00\x00"), false},                      // FLAC, not an image
		{[]byte("MZ\x90\x00"), false},                                // PE/exe
		{[]byte("not an image"), false},                              // text
		{[]byte(""), false},                                          // empty
	}
	for _, c := range cases {
		if got := sniffImage(c.head); got != c.want {
			t.Errorf("sniffImage(%q) = %v, want %v", c.head, got, c.want)
		}
	}
}
