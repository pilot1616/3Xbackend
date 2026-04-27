package database

import (
	"3Xbackend/internal/config"
	"fmt"
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
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return fmt.Errorf("connect db failed: %v\nconnect path: %v", err, db.GetConnectString())
	}
	db.Connect = gormDb
	return nil
}

func (db *MysqlDb) GetConnectString() string {
	return fmt.Sprintf("%v:%v@tcp(%v:%v)/%v?charset=utf8mb4&parseTime=True&loc=Local", db.User, db.Password, db.Address, db.Port, db.Schema)
}

func (db *MysqlDb) CreateTable() error {
	if db.Connect == nil {
		return fmt.Errorf("db connection is nil")
	}
	if err := db.Connect.AutoMigrate(&User{}, &Question{}, &QuestionFile{}, &Comment{}, &QuestionLike{}); err != nil {
		return fmt.Errorf("auto migrate failed: %v", err)
	}
	return nil
}
