package handler

import "testing"

func TestParsePositiveInt(t *testing.T) {
	tests := []struct {
		name     string
		raw      string
		fallback int
		want     int
	}{
		{name: "valid", raw: "42", fallback: 7, want: 42},
		{name: "trims spaces", raw: " 12 ", fallback: 7, want: 12},
		{name: "zero fallback", raw: "0", fallback: 7, want: 7},
		{name: "negative fallback", raw: "-1", fallback: 7, want: 7},
		{name: "invalid fallback", raw: "abc", fallback: 7, want: 7},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parsePositiveInt(tt.raw, tt.fallback); got != tt.want {
				t.Fatalf("expected %d, got %d", tt.want, got)
			}
		})
	}
}
