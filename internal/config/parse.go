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
