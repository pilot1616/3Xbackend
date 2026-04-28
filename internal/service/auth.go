package service

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/database"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var (
	ErrInvalidCredentials   = errors.New("invalid username or password")
	ErrUserExists           = errors.New("username already exists")
	ErrUnauthorized         = errors.New("unauthorized")
	ErrInvalidSecurity      = errors.New("invalid security answer")
	ErrInvalidUsername      = errors.New("username must be an 11-digit phone number")
	ErrInvalidPassword      = errors.New("password must contain letters and numbers and be at least 6 characters")
	ErrInvalidSecurityField = errors.New("security question and answer are required")
	ErrInvalidAge           = errors.New("age must be between 0 and 120")
)

var passwordLetterPattern = regexp.MustCompile(`[A-Za-z]`)
var passwordDigitPattern = regexp.MustCompile(`[0-9]`)
var phonePattern = regexp.MustCompile(`^\d{11}$`)

type AuthService struct {
	db  *gorm.DB
	cfg config.Auth
}

type UserResponse struct {
	ID         uint      `json:"id"`
	Username   string    `json:"username"`
	Nickname   string    `json:"nickname"`
	Age        int       `json:"age"`
	Hobby      string    `json:"hobby"`
	Sign       string    `json:"sign"`
	AvatarPath string    `json:"avatar_path"`
	CreatedAt  time.Time `json:"created_at"`
}

type AuthResult struct {
	Token     string       `json:"token"`
	ExpiresAt time.Time    `json:"expires_at"`
	User      UserResponse `json:"user"`
}

type PasswordResetResult struct {
	Message string `json:"message"`
}

type ProfileUpdateResult struct {
	Message string       `json:"message"`
	User    UserResponse `json:"user"`
}

type SecurityQuestionResult struct {
	Username         string `json:"username"`
	SecurityQuestion string `json:"security_question"`
}

func NewAuthService(db *gorm.DB, cfg config.Auth) *AuthService {
	return &AuthService{db: db, cfg: cfg}
}

func (s *AuthService) Register(username, password, nickname, sign, securityQuestion, securityAnswer string) (*AuthResult, error) {
	username = strings.TrimSpace(username)
	nickname = strings.TrimSpace(nickname)
	sign = strings.TrimSpace(sign)
	securityQuestion = strings.TrimSpace(securityQuestion)
	securityAnswer = strings.TrimSpace(securityAnswer)

	if err := validateUsername(username); err != nil {
		return nil, err
	}
	if err := validatePassword(password); err != nil {
		return nil, err
	}
	if securityQuestion == "" || securityAnswer == "" {
		return nil, ErrInvalidSecurityField
	}
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
	securityAnswerHash, err := bcrypt.GenerateFromPassword([]byte(securityAnswer), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash security answer failed: %w", err)
	}

	user := database.User{
		Username:           username,
		PasswordHash:       string(passwordHash),
		Nickname:           nickname,
		Sign:               sign,
		SecurityQuestion:   securityQuestion,
		SecurityAnswerHash: string(securityAnswerHash),
		AvatarPath:         "/public/images/userImgDefault.png",
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

	if user.LockoutUntil != nil && time.Now().Before(*user.LockoutUntil) {
		remaining := int(time.Until(*user.LockoutUntil).Minutes()) + 1
		return nil, fmt.Errorf("account locked, try again in %d minute(s)", remaining)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		user.FailedLoginCount++
		updates := map[string]any{"failed_login_count": user.FailedLoginCount}
		if user.FailedLoginCount >= 3 {
			lockoutUntil := time.Now().Add(5 * time.Minute)
			updates["lockout_until"] = &lockoutUntil
			updates["failed_login_count"] = 0
		}
		_ = s.db.Model(&user).Updates(updates).Error
		if lockout, ok := updates["lockout_until"]; ok && lockout != nil {
			return nil, fmt.Errorf("account locked, try again in 5 minute(s)")
		}
		remaining := 3 - user.FailedLoginCount
		if remaining < 0 {
			remaining = 0
		}
		return nil, fmt.Errorf("invalid username or password, %d attempt(s) remaining", remaining)
	}

	if err := s.db.Model(&user).Updates(map[string]any{"failed_login_count": 0, "lockout_until": nil}).Error; err != nil {
		return nil, fmt.Errorf("reset login state failed: %w", err)
	}
	user.FailedLoginCount = 0
	user.LockoutUntil = nil

	return s.newAuthResult(user)
}

func (s *AuthService) ResetPassword(username, password, securityAnswer string) (*PasswordResetResult, error) {
	username = strings.TrimSpace(username)
	securityAnswer = strings.TrimSpace(securityAnswer)

	if err := validateUsername(username); err != nil {
		return nil, err
	}
	if err := validatePassword(password); err != nil {
		return nil, err
	}
	if securityAnswer == "" {
		return nil, ErrInvalidSecurityField
	}

	var user database.User
	if err := s.db.Where("username = ?", username).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("query user failed: %w", err)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.SecurityAnswerHash), []byte(securityAnswer)); err != nil {
		return nil, ErrInvalidSecurity
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password failed: %w", err)
	}

	if err := s.db.Model(&user).Updates(map[string]any{
		"password_hash":      string(passwordHash),
		"failed_login_count": 0,
		"lockout_until":      nil,
	}).Error; err != nil {
		return nil, fmt.Errorf("reset password failed: %w", err)
	}

	return &PasswordResetResult{Message: "password reset successfully"}, nil
}

func (s *AuthService) GetSecurityQuestion(username string) (*SecurityQuestionResult, error) {
	username = strings.TrimSpace(username)
	if err := validateUsername(username); err != nil {
		return nil, err
	}

	var user database.User
	if err := s.db.Where("username = ?", username).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("query user failed: %w", err)
	}

	return &SecurityQuestionResult{
		Username:         user.Username,
		SecurityQuestion: user.SecurityQuestion,
	}, nil
}

func (s *AuthService) UpdateProfile(userID uint, nickname string, age int, hobby, sign string) (*ProfileUpdateResult, error) {
	nickname = strings.TrimSpace(nickname)
	hobby = strings.TrimSpace(hobby)
	sign = strings.TrimSpace(sign)
	if age < 0 || age > 120 {
		return nil, ErrInvalidAge
	}

	var user database.User
	if err := s.db.First(&user, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUnauthorized
		}
		return nil, fmt.Errorf("query current user failed: %w", err)
	}

	if nickname == "" {
		nickname = user.Nickname
	}

	if err := s.db.Model(&user).Updates(map[string]any{
		"nickname": nickname,
		"age":      age,
		"hobby":    hobby,
		"sign":     sign,
	}).Error; err != nil {
		return nil, fmt.Errorf("update profile failed: %w", err)
	}

	user.Nickname = nickname
	user.Age = age
	user.Hobby = hobby
	user.Sign = sign

	return &ProfileUpdateResult{
		Message: "profile updated successfully",
		User:    buildUserResponse(user),
	}, nil
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
		ID:         user.ID,
		Username:   user.Username,
		Nickname:   user.Nickname,
		Age:        user.Age,
		Hobby:      user.Hobby,
		Sign:       user.Sign,
		AvatarPath: user.AvatarPath,
		CreatedAt:  user.CreatedAt,
	}
}

func validateUsername(username string) error {
	if !phonePattern.MatchString(username) {
		return ErrInvalidUsername
	}
	return nil
}

func validatePassword(password string) error {
	if len(password) < 6 || !passwordLetterPattern.MatchString(password) || !passwordDigitPattern.MatchString(password) {
		return ErrInvalidPassword
	}
	return nil
}
