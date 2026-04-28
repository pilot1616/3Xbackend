package main

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/database"
	seedpkg "3Xbackend/internal/seed"
	"flag"
	"fmt"
	"log"
	"path/filepath"
	"sort"
)

func main() {
	options := seedpkg.DefaultOptions()
	flag.IntVar(&options.UserCount, "users", options.UserCount, "number of seed users")
	flag.IntVar(&options.QuestionCount, "questions", options.QuestionCount, "number of seed questions")
	flag.IntVar(&options.MinCommentsPerPost, "min-comments", options.MinCommentsPerPost, "minimum comments per question")
	flag.IntVar(&options.MaxCommentsPerPost, "max-comments", options.MaxCommentsPerPost, "maximum comments per question")
	flag.IntVar(&options.MinLikesPerPost, "min-likes", options.MinLikesPerPost, "minimum likes per question")
	flag.IntVar(&options.MaxLikesPerPost, "max-likes", options.MaxLikesPerPost, "maximum likes per question")
	flag.IntVar(&options.MaxAssetsPerPost, "max-assets", options.MaxAssetsPerPost, "maximum assets per question")
	flag.Parse()

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

	summary, err := seedpkg.Run(db.Connect, cfg.Storage, options)
	if err != nil {
		log.Fatalf("run seed failed: %v", err)
	}

	counts, err := seedpkg.Report(db.Connect)
	if err != nil {
		log.Fatalf("report seed result failed: %v", err)
	}

	keys := make([]string, 0, len(counts))
	for key := range counts {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	fmt.Println("seed finished")
	fmt.Printf("seed options: users=%d questions=%d min-comments=%d max-comments=%d min-likes=%d max-likes=%d max-assets=%d\n",
		options.UserCount,
		options.QuestionCount,
		options.MinCommentsPerPost,
		options.MaxCommentsPerPost,
		options.MinLikesPerPost,
		options.MaxLikesPerPost,
		options.MaxAssetsPerPost,
	)
	fmt.Printf("created users: %d\n", summary.Users)
	fmt.Printf("created questions: %d\n", summary.Questions)
	fmt.Printf("created comments: %d\n", summary.Comments)
	fmt.Printf("created likes: %d\n", summary.Likes)
	fmt.Printf("created question files: %d\n", summary.QuestionFiles)
	fmt.Printf("copied avatars: %d\n", summary.CopiedAvatars)
	fmt.Printf("copied upload assets: %d\n", summary.CopiedUploads)
	fmt.Printf("prepared asset pool: %d\n", summary.PreparedAssets)
	for _, key := range keys {
		fmt.Printf("total %s: %d\n", key, counts[key])
	}
	fmt.Println("seed account password: Forum123")
	fmt.Println("seed security answer: 1999")
}
