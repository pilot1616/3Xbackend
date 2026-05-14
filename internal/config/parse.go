package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

const defaultServerPort = "8080"

type Config struct {
	Server   Server   `mapstructure:"server"`
	Auth     Auth     `mapstructure:"auth"`
	Storage  Storage  `mapstructure:"storage"`
	Database Database `mapstructure:"database"`
	Sync     Sync     `mapstructure:"sync"`
}

type Server struct {
	Port string `mapstructure:"port"`
}

type Auth struct {
	Secret           string `mapstructure:"secret"`
	TokenExpireHours int    `mapstructure:"token_expire_hours"`
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
	PreciousMetals PreciousMetalsSync `mapstructure:"precious_metals"`
	AITech         AITechSync         `mapstructure:"ai_tech"`
}

type PreciousMetalsSync struct {
	Enabled             bool   `mapstructure:"enabled"`
	IntervalMinutes     int    `mapstructure:"interval_minutes"`
	RequestTimeoutSec   int    `mapstructure:"request_timeout_sec"`
	UserAgent           string `mapstructure:"user_agent"`
	SourceBaseURL       string `mapstructure:"source_base_url"`
	InitialRunOnStartup bool   `mapstructure:"initial_run_on_startup"`
}

type AITechSync struct {
	Enabled             bool   `mapstructure:"enabled"`
	IntervalMinutes     int    `mapstructure:"interval_minutes"`
	RequestTimeoutSec   int    `mapstructure:"request_timeout_sec"`
	UserAgent           string `mapstructure:"user_agent"`
	SourceBaseURL       string `mapstructure:"source_base_url"`
	InitialRunOnStartup bool   `mapstructure:"initial_run_on_startup"`
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

	return &cfg, nil
}

func bindEnv(v *viper.Viper) {
	keys := []string{
		"server.port",
		"auth.secret",
		"auth.token_expire_hours",
		"storage.public_dir",
		"storage.image_dir",
		"storage.upload_dir",
		"database.mysql.user",
		"database.mysql.password",
		"database.mysql.address",
		"database.mysql.port",
		"database.mysql.schema",
		"sync.precious_metals.enabled",
		"sync.precious_metals.interval_minutes",
		"sync.precious_metals.request_timeout_sec",
		"sync.precious_metals.user_agent",
		"sync.precious_metals.source_base_url",
		"sync.precious_metals.initial_run_on_startup",
		"sync.ai_tech.enabled",
		"sync.ai_tech.interval_minutes",
		"sync.ai_tech.request_timeout_sec",
		"sync.ai_tech.user_agent",
		"sync.ai_tech.source_base_url",
		"sync.ai_tech.initial_run_on_startup",
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
	secret := strings.TrimSpace(a.Secret)
	if secret == "" {
		secret = "3Xbackend-dev-secret"
	}
	return []byte(secret)
}

func (a Auth) TokenTTL() time.Duration {
	hours := a.TokenExpireHours
	if hours <= 0 {
		hours = 24
	}
	return time.Duration(hours) * time.Hour
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

func (s PreciousMetalsSync) IsEnabled() bool {
	return s.Enabled
}

func (s PreciousMetalsSync) Interval() time.Duration {
	minutes := s.IntervalMinutes
	if minutes <= 0 {
		minutes = 60
	}
	return time.Duration(minutes) * time.Minute
}

func (s PreciousMetalsSync) RequestTimeout() time.Duration {
	seconds := s.RequestTimeoutSec
	if seconds <= 0 {
		seconds = 20
	}
	return time.Duration(seconds) * time.Second
}

func (s PreciousMetalsSync) EffectiveUserAgent() string {
	value := strings.TrimSpace(s.UserAgent)
	if value == "" {
		return "Mozilla/5.0 (compatible; 3Xbackend-metal-sync/1.0; +https://github.com/pilot1616/3Xbackend)"
	}
	return value
}

func (s PreciousMetalsSync) EffectiveSourceBaseURL() string {
	value := strings.TrimSpace(s.SourceBaseURL)
	if value == "" {
		return "https://www.investing.com"
	}
	return strings.TrimRight(value, "/")
}

func (s AITechSync) IsEnabled() bool {
	return s.Enabled
}

func (s AITechSync) Interval() time.Duration {
	minutes := s.IntervalMinutes
	if minutes <= 0 {
		minutes = 120
	}
	return time.Duration(minutes) * time.Minute
}

func (s AITechSync) RequestTimeout() time.Duration {
	seconds := s.RequestTimeoutSec
	if seconds <= 0 {
		seconds = 20
	}
	return time.Duration(seconds) * time.Second
}

func (s AITechSync) EffectiveUserAgent() string {
	value := strings.TrimSpace(s.UserAgent)
	if value == "" {
		return "Mozilla/5.0 (compatible; 3Xbackend-ai-tech-sync/1.0; +https://github.com/pilot1616/3Xbackend)"
	}
	return value
}

func (s AITechSync) EffectiveSourceBaseURL() string {
	value := strings.TrimSpace(s.SourceBaseURL)
	if value == "" {
		return "https://www.investing.com"
	}
	return strings.TrimRight(value, "/")
}
