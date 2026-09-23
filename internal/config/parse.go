package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/viper"
)

const defaultServerPort = "8080"

// DefaultSigningSecret is the well-known secret used by historical dev
// configurations. Tokens signed with it are forgeable, so production must
// never fall back to it; AUTH_ALLOW_DEFAULT_SECRET=1 keeps local dev usable.
const DefaultSigningSecret = "3Xbackend-dev-secret"

type Config struct {
	Server   Server   `mapstructure:"server"`
	Auth     Auth     `mapstructure:"auth"`
	Storage  Storage  `mapstructure:"storage"`
	Database Database `mapstructure:"database"`
	Sync     Sync     `mapstructure:"sync"`
	Markets  Markets  `mapstructure:"markets"`
	CORS     CORS     `mapstructure:"cors"`
}

type CORS struct {
	AllowedOrigins string `mapstructure:"allowed_origins"`
}

// OriginWhitelist splits the comma-separated whitelist. An empty list means
// "allow any origin" which is only appropriate for local development.
func (c CORS) OriginWhitelist() []string {
	raw := strings.TrimSpace(c.AllowedOrigins)
	if raw == "" {
		return nil
	}
	values := strings.Split(raw, ",")
	origins := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	return origins
}

type Server struct {
	Port string `mapstructure:"port"`
}

type Auth struct {
	Secret           string `mapstructure:"secret"`
	TokenExpireHours int    `mapstructure:"token_expire_hours"`
	AdminUsernames   string `mapstructure:"admin_usernames"`
}

type Storage struct {
	PublicDir string `mapstructure:"public_dir"`
	ImageDir  string `mapstructure:"image_dir"`
	UploadDir string `mapstructure:"upload_dir"`
}

type Database struct {
	Mysql Mysql `mapstructure:"mysql"`
}

type Sync struct {
	AIDaily AIDailySync `mapstructure:"ai_daily"`
}

type Markets struct {
	PreciousMetals []MarketTarget `mapstructure:"precious_metals" json:"precious_metals"`
	TechMarkets    []MarketTarget `mapstructure:"tech_markets" json:"tech_markets"`
}

type MarketTarget struct {
	Symbol       string `mapstructure:"symbol"`
	Name         string `mapstructure:"name"`
	SourceSymbol string `mapstructure:"source_symbol"`
	Category     string `mapstructure:"category"`
}

func LoadMarketTargets(path string) (Markets, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Markets{}, fmt.Errorf("read market targets failed: %w", err)
	}
	var payload Markets
	if err := json.Unmarshal(raw, &payload); err != nil {
		return Markets{}, fmt.Errorf("unmarshal market targets failed: %w", err)
	}
	return payload, nil
}

type AIDailySync struct {
	Enabled             bool   `mapstructure:"enabled"`
	IntervalMinutes     int    `mapstructure:"interval_minutes"`
	RequestTimeoutSec   int    `mapstructure:"request_timeout_sec"`
	UserAgent           string `mapstructure:"user_agent"`
	SourceBaseURL       string `mapstructure:"source_base_url"`
	IndexPath           string `mapstructure:"index_path"`
	InitialRunOnStartup bool   `mapstructure:"initial_run_on_startup"`
	MaxEntries          int    `mapstructure:"max_entries"`
}

type Mysql struct {
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	Address  string `mapstructure:"address"`
	Port     string `mapstructure:"port"`
	Schema   string `mapstructure:"schema"`
}

func Load(path string) (*Config, error) {
	v := viper.New()
	v.SetConfigFile(path)
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()
	bindEnv(v)
	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("read config failed : %v", err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config failed: %v", err)
	}

	if allowDefaultSecret, _ := strconv.ParseBool(os.Getenv("AUTH_ALLOW_DEFAULT_SECRET")); !allowDefaultSecret {
		secret := strings.TrimSpace(cfg.Auth.Secret)
		if secret == "" || secret == DefaultSigningSecret {
			return nil, fmt.Errorf(
				"auth.secret is empty or set to the well-known default; generate a unique secret (e.g. `openssl rand -hex 32`) and set auth.secret or AUTH_SECRET. Set AUTH_ALLOW_DEFAULT_SECRET=1 to bypass this check for local development",
			)
		}
	}

	return &cfg, nil
}

func bindEnv(v *viper.Viper) {
	keys := []string{
		"server.port",
		"auth.secret",
		"auth.token_expire_hours",
		"auth.admin_usernames",
		"cors.allowed_origins",
		"storage.public_dir",
		"storage.image_dir",
		"storage.upload_dir",
		"database.mysql.user",
		"database.mysql.password",
		"database.mysql.address",
		"database.mysql.port",
		"database.mysql.schema",
		"sync.ai_daily.enabled",
		"sync.ai_daily.interval_minutes",
		"sync.ai_daily.request_timeout_sec",
		"sync.ai_daily.user_agent",
		"sync.ai_daily.source_base_url",
		"sync.ai_daily.index_path",
		"sync.ai_daily.initial_run_on_startup",
		"sync.ai_daily.max_entries",
	}

	for _, key := range keys {
		_ = v.BindEnv(key)
	}
}

func (s Server) Address() string {
	port := strings.TrimSpace(s.Port)
	if port == "" {
		port = defaultServerPort
	}
	if strings.HasPrefix(port, ":") {
		return port
	}
	return ":" + port
}

func (a Auth) SigningKey() []byte {
	return []byte(strings.TrimSpace(a.Secret))
}

func (a Auth) TokenTTL() time.Duration {
	hours := a.TokenExpireHours
	if hours <= 0 {
		hours = 24
	}
	return time.Duration(hours) * time.Hour
}

func (a Auth) IsAdminUsername(username string) bool {
	username = strings.TrimSpace(username)
	if username == "" {
		return false
	}
	for _, value := range strings.Split(a.AdminUsernames, ",") {
		if strings.TrimSpace(value) == username {
			return true
		}
	}
	return false
}

func (s Storage) PublicRoot() string {
	if strings.TrimSpace(s.PublicDir) == "" {
		return "public"
	}
	return strings.TrimSpace(s.PublicDir)
}

func (s Storage) ImageRoot() string {
	if strings.TrimSpace(s.ImageDir) == "" {
		return "public/images"
	}
	return strings.TrimSpace(s.ImageDir)
}

func (s Storage) UploadRoot() string {
	if strings.TrimSpace(s.UploadDir) == "" {
		return "public/uploads"
	}
	return strings.TrimSpace(s.UploadDir)
}

func (s AIDailySync) IsEnabled() bool {
	return s.Enabled
}

func (s AIDailySync) Interval() time.Duration {
	minutes := s.IntervalMinutes
	if minutes <= 0 {
		minutes = 30
	}
	return time.Duration(minutes) * time.Minute
}

func (s AIDailySync) RequestTimeout() time.Duration {
	seconds := s.RequestTimeoutSec
	if seconds <= 0 {
		seconds = 20
	}
	return time.Duration(seconds) * time.Second
}

func (s AIDailySync) EffectiveUserAgent() string {
	value := strings.TrimSpace(s.UserAgent)
	if value == "" {
		return "Mozilla/5.0 (compatible; 3Xbackend-ai-daily-sync/1.0; +https://github.com/pilot1616/3Xbackend)"
	}
	return value
}

func (s AIDailySync) EffectiveSourceBaseURL() string {
	value := strings.TrimSpace(s.SourceBaseURL)
	if value == "" {
		return "https://hex2077.dev"
	}
	return strings.TrimRight(value, "/")
}

func (s AIDailySync) EffectiveIndexPath() string {
	value := strings.TrimSpace(s.IndexPath)
	if value == "" {
		return "/docs/"
	}
	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	return value
}
