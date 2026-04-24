package service

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/database"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var (
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrUserExists         = errors.New("username already exists")
	ErrUnauthorized       = errors.New("unauthorized")
)

type AuthService struct {
	db  *gorm.DB
	cfg config.Auth
}

type UserResponse struct {
	ID        uint      `json:"id"`
	Username  string    `json:"username"`
	Nickname  string    `json:"nickname"`
	Sign      string    `json:"sign"`
	CreatedAt time.Time `json:"created_at"`
}

type AuthResult struct {
	Token     string       `json:"token"`
	ExpiresAt time.Time    `json:"expires_at"`
	User      UserResponse `json:"user"`
}

func NewAuthService(db *gorm.DB, cfg config.Auth) *AuthService {
	return &AuthService{db: db, cfg: cfg}
}

func (s *AuthService) Register(username, password, nickname, sign string) (*AuthResult, error) {
	username = strings.TrimSpace(username)
	nickname = strings.TrimSpace(nickname)
	sign = strings.TrimSpace(sign)
	if nickname == "" {
		nickname = username
	}

	var count int64
	if err := s.db.Model(&database.User{}).Where("username = ?", username).Count(&count).Error; err != nil {
		return nil, fmt.Errorf("check user exists failed: %w", err)
	}
	if count > 0 {
		return nil, ErrUserExists
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password failed: %w", err)
	}

	user := database.User{
		Username:     username,
		PasswordHash: string(passwordHash),
		Nickname:     nickname,
		Sign:         sign,
	}
	if err := s.db.Create(&user).Error; err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate") {
			return nil, ErrUserExists
		}
		return nil, fmt.Errorf("create user failed: %w", err)
	}

	return s.newAuthResult(user)
}

func (s *AuthService) Login(username, password string) (*AuthResult, error) {
	username = strings.TrimSpace(username)

	var user database.User
	if err := s.db.Where("username = ?", username).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("query user failed: %w", err)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	return s.newAuthResult(user)
}

func (s *AuthService) Me(userID uint) (*UserResponse, error) {
	var user database.User
	if err := s.db.First(&user, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUnauthorized
		}
		return nil, fmt.Errorf("query current user failed: %w", err)
	}
	resp := buildUserResponse(user)
	return &resp, nil
}

func (s *AuthService) ParseToken(token string) (uint, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return 0, ErrUnauthorized
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return 0, ErrUnauthorized
	}

	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0, ErrUnauthorized
	}

	expected := s.sign(payload)
	if !hmac.Equal(signature, expected) {
		return 0, ErrUnauthorized
	}

	values := strings.Split(string(payload), ":")
	if len(values) != 2 {
		return 0, ErrUnauthorized
	}

	userID, err := strconv.ParseUint(values[0], 10, 64)
	if err != nil {
		return 0, ErrUnauthorized
	}

	expiresAt, err := strconv.ParseInt(values[1], 10, 64)
	if err != nil {
		return 0, ErrUnauthorized
	}
	if time.Now().Unix() > expiresAt {
		return 0, ErrUnauthorized
	}

	return uint(userID), nil
}

func (s *AuthService) newAuthResult(user database.User) (*AuthResult, error) {
	expiresAt := time.Now().Add(s.cfg.TokenTTL())
	payload := []byte(fmt.Sprintf("%d:%d", user.ID, expiresAt.Unix()))
	token := base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(s.sign(payload))

	return &AuthResult{
		Token:     token,
		ExpiresAt: expiresAt,
		User:      buildUserResponse(user),
	}, nil
}

func (s *AuthService) sign(payload []byte) []byte {
	h := hmac.New(sha256.New, s.cfg.SigningKey())
	_, _ = h.Write(payload)
	return h.Sum(nil)
}

func buildUserResponse(user database.User) UserResponse {
	return UserResponse{
		ID:        user.ID,
		Username:  user.Username,
		Nickname:  user.Nickname,
		Sign:      user.Sign,
		CreatedAt: user.CreatedAt,
	}
}
