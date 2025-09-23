package database

import (
	"3Xbackend/internal/config"
	"fmt"

	"github.com/spf13/viper"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

type MysqlDb struct {
	User     string
	Password string
	Address  string
	Port     string
	Schema   string
	Connect  *gorm.DB
}

func (db *MysqlDb) Init(path string) error {
	if err := config.Parse(path); err != nil {
		return fmt.Errorf("parse params error: %v", err)
	}
	db.User = viper.GetString("database.mysql.user")
	db.Password = viper.GetString("database.mysql.password")
	db.Address = viper.GetString("database.mysql.address")
	db.Port = viper.GetString("database.mysql.port")
	db.Schema = viper.GetString("database.mysql.schema")
	return db.GetConnect()
}

func (db *MysqlDb) GetConnect() error {
	gormDb, err := gorm.Open(mysql.Open(db.GetConnectString()), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("connect db failed: %v\nconnect path: %v", err, db.GetConnectString())
	}
	db.Connect = gormDb
	return nil
}

func (db *MysqlDb) GetConnectString() string {
	return fmt.Sprintf("%v:%v@tcp(%v:%v)/%v?charset=utf8mb4&parseTime=True&loc=Local", db.User, db.Password, db.Address, db.Port, db.Schema)
}
