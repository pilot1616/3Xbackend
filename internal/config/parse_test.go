package config

import (
	"os"
	"path/filepath"
	"testing"
)

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

func TestLoadRejectsDefaultSigningSecret(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	payload := "server:\n  port: 3000\nauth:\n  secret: " + DefaultSigningSecret + "\n"
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatalf("write temp config: %v", err)
	}

	if _, err := Load(path); err == nil {
		t.Fatal("expected Load to reject the well-known default signing secret")
	}

	t.Setenv("AUTH_ALLOW_DEFAULT_SECRET", "1")
	if _, err := Load(path); err != nil {
		t.Fatalf("expected Load to allow default secret with override, got %v", err)
	}
}

func TestLoadAcceptsUniqueSecret(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	payload := "auth:\n  secret: some-unique-local-secret\n"
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatalf("write temp config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.Auth.Secret != "some-unique-local-secret" {
		t.Fatalf("unexpected secret: %q", cfg.Auth.Secret)
	}
}

func TestLoadMarketTargets(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "market_targets.json")
	payload := `{"precious_metals":[{"symbol":"XAU","name":"Gold","source_symbol":"GC"}],"tech_markets":[{"symbol":"NDX","name":"Nasdaq 100","source_symbol":".NDX","category":"index"}]}`
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatalf("write temp config: %v", err)
	}

	markets, err := LoadMarketTargets(path)
	if err != nil {
		t.Fatalf("load market targets: %v", err)
	}
	if len(markets.PreciousMetals) != 1 || markets.PreciousMetals[0].Symbol != "XAU" {
		t.Fatalf("unexpected precious metals: %#v", markets.PreciousMetals)
	}
	if len(markets.TechMarkets) != 1 || markets.TechMarkets[0].Symbol != "NDX" {
		t.Fatalf("unexpected tech markets: %#v", markets.TechMarkets)
	}
}
