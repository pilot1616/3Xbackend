package server

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/handler"
	"3Xbackend/internal/middleware"
	"3Xbackend/internal/service"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type Server struct {
	router       *gin.Engine
	authHandler  *handler.AuthHandler
	forumHandler *handler.ForumHandler
	authGuard    gin.HandlerFunc
	optionalAuth gin.HandlerFunc
}

func (s *Server) Init(db *gorm.DB, cfg *config.Config) error {
	s.router = gin.New()
	s.router.Use(gin.Logger(), gin.Recovery(), middleware.CORS())

	authService := service.NewAuthService(db, cfg.Auth)
	s.authHandler = handler.NewAuthHandler(authService)
	s.authGuard = middleware.AuthRequired(authService)
	s.optionalAuth = middleware.OptionalAuth(authService)
	forumService, err := service.NewForumService(db, cfg.Storage)
	if err != nil {
		return err
	}
	s.forumHandler = handler.NewForumHandler(forumService)
	s.router.Static("/public", cfg.Storage.PublicRoot())

	s.registerRoutes()
	s.registerFrontendRoutes(filepath.Join("front", "dist"))
	return nil
}

func (s *Server) Run(addr string) error {
	if s.router == nil {
		return http.ErrServerClosed
	}
	return s.router.Run(addr)
}

func (s *Server) registerRoutes() {
	s.router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"service": "3Xbackend",
			"status":  "ok",
		})
	})

	api := s.router.Group("/api/v1")
	api.Use(s.optionalAuth)
	authGroup := api.Group("/auth")
	authGroup.POST("/register", s.authHandler.Register)
	authGroup.POST("/login", s.authHandler.Login)
	authGroup.POST("/reset-password", s.authHandler.ResetPassword)
	authGroup.GET("/security-question", s.authHandler.SecurityQuestion)
	api.GET("/questions", s.forumHandler.ListQuestionsPaginated)
	api.GET("/questions/:qid", s.forumHandler.GetQuestion)
	api.GET("/questions/:qid/comments", s.forumHandler.ListCommentsPaginated)
	api.GET("/questions/:qid/likes", s.forumHandler.ListLikesPaginated)

	userGroup := api.Group("/users")
	userGroup.Use(s.authGuard)
	userGroup.GET("/me", s.authHandler.Me)
	userGroup.PATCH("/me", s.authHandler.UpdateProfile)
	userGroup.POST("/me/avatar", s.forumHandler.UploadMyAvatar)
	userGroup.GET("/me/questions", s.forumHandler.ListMyQuestions)
	userGroup.GET("/me/comments", s.forumHandler.ListMyComments)
	userGroup.GET("/me/likes", s.forumHandler.ListMyLikes)
	userGroup.GET("/me/summary", s.forumHandler.GetMySummary)

	questionGroup := api.Group("/questions")
	questionGroup.Use(s.authGuard)
	questionGroup.POST("", s.forumHandler.CreateQuestionAuthenticated)
	questionGroup.POST("/:qid/files", s.forumHandler.UploadQuestionFilesAuthenticated)
	questionGroup.DELETE("/:qid/files/:filename", s.forumHandler.DeleteQuestionFileAuthenticated)
	questionGroup.PATCH("/:qid", s.forumHandler.UpdateQuestionAuthenticated)
	questionGroup.DELETE("/:qid", s.forumHandler.DeleteQuestionAuthenticated)
	questionGroup.POST("/:qid/toggle-upload", s.forumHandler.ToggleQuestionUploadAuthenticated)
	questionGroup.POST("/:qid/comments", s.forumHandler.CreateCommentAuthenticated)
	questionGroup.PATCH("/:qid/comments/:commentID", s.forumHandler.UpdateCommentAuthenticated)
	questionGroup.DELETE("/:qid/comments/:commentID", s.forumHandler.DeleteCommentAuthenticated)
	questionGroup.POST("/:qid/like", s.forumHandler.LikeQuestionAuthenticated)
	questionGroup.DELETE("/:qid/like", s.forumHandler.UnlikeQuestionAuthenticated)

	s.router.GET("/question_request/", s.forumHandler.QuestionRequest)
	s.router.POST("/question_upload/", s.forumHandler.QuestionUpload)
	s.router.POST("/question_file_upload/", s.forumHandler.QuestionFileUpload)
	s.router.POST("/comment_upload/", s.forumHandler.CommentUpload)
	s.router.POST("/like_upload/", s.forumHandler.LikeUpload)
	s.router.POST("/control_upload/", s.forumHandler.ControlUpload)
	s.router.POST("/delete_upload/", s.forumHandler.DeleteUpload)
	s.router.POST("/file_upload/", s.forumHandler.FileUpload)
	s.router.GET("/image_info/:filename", s.forumHandler.ImageInfo)
}

func (s *Server) registerFrontendRoutes(frontDist string) {
	indexFile := filepath.Join(frontDist, "index.html")
	if _, err := os.Stat(indexFile); err != nil {
		return
	}

	staticDirs := []string{"assets", "legacy"}
	for _, dir := range staticDirs {
		fullPath := filepath.Join(frontDist, dir)
		if _, err := os.Stat(fullPath); err == nil {
			s.router.Static("/"+dir, fullPath)
		}
	}

	s.router.GET("/", func(c *gin.Context) {
		c.File(indexFile)
	})

	s.router.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if isBackendPath(path) {
			c.JSON(http.StatusNotFound, gin.H{"message": "not found"})
			return
		}
		c.File(indexFile)
	})
}

func isBackendPath(path string) bool {
	prefixes := []string{
		"/api/",
		"/public/",
		"/question_request/",
		"/question_upload/",
		"/question_file_upload/",
		"/comment_upload/",
		"/like_upload/",
		"/control_upload/",
		"/delete_upload/",
		"/file_upload/",
		"/image_info/",
	}

	for _, prefix := range prefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}

	return path == "/health"
}
