package server

import "github.com/gin-gonic/gin"

type Server struct {
	router *gin.Engine
}

func (s *Server) Init() error {
	s.router = gin.Default()
	return nil
}
