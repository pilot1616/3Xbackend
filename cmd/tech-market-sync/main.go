package main

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/database"
	"3Xbackend/internal/service"
	"context"
	"log"
	"path/filepath"
)

func main() {
	configFile, err := filepath.Abs("./config/config.yaml")
	if err != nil {
		log.Fatalf("resolve config path failed: %v", err)
	}

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

	syncService := service.NewTechMarketSyncService(db.Connect, cfg.Sync.AITech)
	if err := syncService.SyncOnce(context.Background()); err != nil {
		log.Fatalf("sync ai tech market failed: %v", err)
	}

	log.Printf("ai tech market sync finished successfully")
}
