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
	Database Database `mapstructure:"database"`
}

type Server struct {
	Port string `mapstructure:"port"`
}

type Auth struct {
	Secret           string `mapstructure:"secret"`
	TokenExpireHours int    `mapstructure:"token_expire_hours"`
}

type Database struct {
	Mysql Mysql `mapstructure:"mysql"`
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
	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("read config failed : %v", err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config failed: %v", err)
	}

	return &cfg, nil
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
