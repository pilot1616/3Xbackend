package server

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/handler"
	"3Xbackend/internal/middleware"
	"3Xbackend/internal/service"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type Server struct {
	router      *gin.Engine
	authHandler *handler.AuthHandler
	authGuard   gin.HandlerFunc
}

func (s *Server) Init(db *gorm.DB, authCfg config.Auth) error {
	s.router = gin.New()
	s.router.Use(gin.Logger(), gin.Recovery())

	authService := service.NewAuthService(db, authCfg)
	s.authHandler = handler.NewAuthHandler(authService)
	s.authGuard = middleware.AuthRequired(authService)

	s.registerRoutes()
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
	authGroup := api.Group("/auth")
	authGroup.POST("/register", s.authHandler.Register)
	authGroup.POST("/login", s.authHandler.Login)

	userGroup := api.Group("/users")
	userGroup.Use(s.authGuard)
	userGroup.GET("/me", s.authHandler.Me)
}
