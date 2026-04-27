package handler

import (
	"3Xbackend/internal/middleware"
	"3Xbackend/internal/service"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

type AuthHandler struct {
	authService *service.AuthService
}

type RegisterRequest struct {
	Username         string `json:"username" binding:"required,max=32"`
	Password         string `json:"password" binding:"required,min=6,max=72"`
	Nickname         string `json:"nickname" binding:"omitempty,max=32"`
	Sign             string `json:"sign" binding:"omitempty,max=255"`
	SecurityQuestion string `json:"security_question" binding:"required,max=32"`
	SecurityAnswer   string `json:"security_answer" binding:"required,max=255"`
}

type LoginRequest struct {
	Username string `json:"username" binding:"required,max=32"`
	Password string `json:"password" binding:"required,min=6,max=72"`
}

type ResetPasswordRequest struct {
	Username       string `json:"username" binding:"required,max=32"`
	Password       string `json:"password" binding:"required,min=6,max=72"`
	SecurityAnswer string `json:"security_answer" binding:"required,max=255"`
}

type UpdateProfileRequest struct {
	Nickname string `json:"nickname" binding:"omitempty,max=32"`
	Age      int    `json:"age"`
	Hobby    string `json:"hobby" binding:"omitempty,max=255"`
	Sign     string `json:"sign" binding:"omitempty,max=255"`
}

func NewAuthHandler(authService *service.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	result, err := h.authService.Register(req.Username, req.Password, req.Nickname, req.Sign, req.SecurityQuestion, req.SecurityAnswer)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrUserExists):
			c.JSON(http.StatusConflict, gin.H{"message": err.Error()})
		case errors.Is(err, service.ErrInvalidUsername), errors.Is(err, service.ErrInvalidPassword), errors.Is(err, service.ErrInvalidSecurityField):
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "register failed"})
		}
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	result, err := h.authService.Login(req.Username, req.Password)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidCredentials):
			c.JSON(http.StatusUnauthorized, gin.H{"message": err.Error()})
		case errors.Is(err, service.ErrInvalidUsername), errors.Is(err, service.ErrInvalidPassword):
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		default:
			c.JSON(http.StatusUnauthorized, gin.H{"message": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *AuthHandler) ResetPassword(c *gin.Context) {
	var req ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	result, err := h.authService.ResetPassword(req.Username, req.Password, req.SecurityAnswer)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidCredentials), errors.Is(err, service.ErrInvalidSecurity):
			c.JSON(http.StatusUnauthorized, gin.H{"message": err.Error()})
		case errors.Is(err, service.ErrInvalidUsername), errors.Is(err, service.ErrInvalidPassword), errors.Is(err, service.ErrInvalidSecurityField):
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "reset password failed"})
		}
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *AuthHandler) SecurityQuestion(c *gin.Context) {
	username := c.Query("username")
	result, err := h.authService.GetSecurityQuestion(username)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrInvalidCredentials):
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
		case errors.Is(err, service.ErrInvalidUsername):
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "query security question failed"})
		}
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *AuthHandler) UpdateProfile(c *gin.Context) {
	userIDValue, exists := c.Get(middleware.ContextUserIDKey)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "unauthorized"})
		return
	}

	userID, ok := userIDValue.(uint)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "unauthorized"})
		return
	}

	var req UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	result, err := h.authService.UpdateProfile(userID, req.Nickname, req.Age, req.Hobby, req.Sign)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrUnauthorized):
			c.JSON(http.StatusUnauthorized, gin.H{"message": err.Error()})
		case errors.Is(err, service.ErrInvalidAge):
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "update profile failed"})
		}
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *AuthHandler) Me(c *gin.Context) {
	userIDValue, exists := c.Get(middleware.ContextUserIDKey)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "unauthorized"})
		return
	}

	userID, ok := userIDValue.(uint)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "unauthorized"})
		return
	}

	user, err := h.authService.Me(userID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrUnauthorized):
			c.JSON(http.StatusUnauthorized, gin.H{"message": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "query current user failed"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": user})
}
