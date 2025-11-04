package main

import (
	"3Xbackend/internal/database"
	"3Xbackend/internal/server"
	"fmt"
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
	db := database.MysqlDb{}
	if err := db.Init(configFile); err != nil {
		fmt.Printf("init db failed: %v", err)
	}
	
	svr := server.Server{}
	svr.Init()
}
