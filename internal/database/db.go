package database

import (
	"3Xbackend/internal/config"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type MysqlDb struct {
	User     string
	Password string
	Address  string
	Port     string
	Schema   string
	Connect  *gorm.DB
}

func (db *MysqlDb) Init(cfg config.Mysql) error {
	db.User = cfg.User
	db.Password = cfg.Password
	db.Address = cfg.Address
	db.Port = cfg.Port
	db.Schema = cfg.Schema
	return db.GetConnect()
}

func (db *MysqlDb) GetConnect() error {
	gormDb, err := gorm.Open(mysql.Open(db.GetConnectString()), &gorm.Config{
		// Warn 级别会记录慢查询和错误，同时保持普通查询静默。
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return fmt.Errorf("connect db failed: %v\nconnect path: %v", err, db.GetConnectString())
	}
	applyConnectionPool(gormDb)
	db.Connect = gormDb
	return nil
}

// applyConnectionPool caps idle connections and recycles them so long-running
// servers and MySQL's wait_timeout do not accumulate stale connections.
func applyConnectionPool(gormDb *gorm.DB) {
	sqlDB, err := gormDb.DB()
	if err != nil {
		return
	}
	sqlDB.SetMaxOpenConns(envInt("DB_MAX_OPEN_CONNS", 25))
	sqlDB.SetMaxIdleConns(envInt("DB_MAX_IDLE_CONNS", 10))
	sqlDB.SetConnMaxLifetime(time.Duration(envInt("DB_CONN_MAX_LIFETIME_MINUTES", 30)) * time.Minute)
}

func envInt(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func (db *MysqlDb) GetConnectString() string {
	return fmt.Sprintf("%v:%v@tcp(%v:%v)/%v?charset=utf8mb4,utf8&parseTime=True&loc=Local", db.User, db.Password, db.Address, db.Port, db.Schema)
}

func (db *MysqlDb) CreateTable() error {
	if db.Connect == nil {
		return fmt.Errorf("db connection is nil")
	}
	if err := db.Connect.AutoMigrate(&User{}, &Question{}, &QuestionFile{}, &Comment{}, &QuestionLike{}, &PreciousMetalSnapshot{}, &TechMarketSnapshot{}, &AIDailySnapshot{}); err != nil {
		return fmt.Errorf("auto migrate failed: %v", err)
	}
	return nil
}
