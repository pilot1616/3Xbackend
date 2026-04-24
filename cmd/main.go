package main

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/database"
	"3Xbackend/internal/server"
	"log"
	"path/filepath"
)

var configFile string

func init() {
	// 将相对路径转换为绝对路径
	cf, err := filepath.Abs("./config/config.yaml")
	if err != nil {
		panic(err)
	}
	configFile = cf
}

func main() {
	cfg, err := config.Load(configFile)
	if err != nil {
		log.Fatalf("load config failed: %v", err)
	}

	db := database.MysqlDb{}
	if err := db.Init(cfg.Database.Mysql); err != nil {
		log.Fatalf("init db failed: %v", err)
	}
	if err := db.CreateTable(); err != nil {
		log.Fatalf("create table failed: %v", err)
	}

	svr := server.Server{}
	if err := svr.Init(db.Connect, cfg.Auth); err != nil {
		log.Fatalf("init server failed: %v", err)
	}
	if err := svr.Run(cfg.Server.Address()); err != nil {
		log.Fatalf("start server failed: %v", err)
	}
}
