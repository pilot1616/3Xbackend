package main

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/database"
	"3Xbackend/internal/server"
	"3Xbackend/internal/service"
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
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
	marketConfig, err := config.LoadMarketTargets(filepath.Join("config", "market_targets.json"))
	if err != nil {
		log.Fatalf("load market targets failed: %v", err)
	}

	db := database.MysqlDb{}
	if err := db.Init(cfg.Database.Mysql); err != nil {
		log.Fatalf("init db failed: %v", err)
	}
	if err := db.CreateTable(); err != nil {
		log.Fatalf("create table failed: %v", err)
	}

	appCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	aiDailySyncService := service.NewAIDailySyncService(db.Connect, cfg.Sync.AIDaily)
	aiDailySyncService.Start(appCtx)

	svr := server.Server{}
	if err := svr.Init(db.Connect, cfg, marketConfig); err != nil {
		log.Fatalf("init server failed: %v", err)
	}

	serverErr := make(chan error, 1)
	go func() {
		if err := svr.Run(cfg.Server.Address()); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		log.Fatalf("start server failed: %v", err)
	case sig := <-stop:
		log.Printf("received %s, shutting down...", sig)
	}

	// 先停后台同步任务，再给 HTTP 一个排水窗口处理完进行中的请求。
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	if err := svr.Shutdown(shutdownCtx); err != nil {
		log.Printf("server shutdown failed: %v", err)
	}
}
