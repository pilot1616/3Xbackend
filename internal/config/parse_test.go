package config

import "testing"

func TestAuthIsAdminUsername(t *testing.T) {
	cfg := Auth{AdminUsernames: "13800138000, 13900139000 ,"}

	tests := []struct {
		name     string
		username string
		want     bool
	}{
		{name: "first admin", username: "13800138000", want: true},
		{name: "second admin trims spaces", username: "13900139000", want: true},
		{name: "unknown user", username: "13700137000", want: false},
		{name: "empty user", username: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := cfg.IsAdminUsername(tt.username); got != tt.want {
				t.Fatalf("expected %v, got %v", tt.want, got)
			}
		})
	}
}
