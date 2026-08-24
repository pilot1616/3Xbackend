package service

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/database"
	"testing"
)

func TestBuildUserResponseMarksAdmin(t *testing.T) {
	authService := NewAuthService(nil, config.Auth{AdminUsernames: "13800138000"})

	admin := authService.buildUserResponse(database.User{ID: 1, Username: "13800138000", Nickname: "admin"})
	if !admin.IsAdmin {
		t.Fatalf("expected admin user to be marked as admin")
	}

	regular := authService.buildUserResponse(database.User{ID: 2, Username: "13900139000", Nickname: "regular"})
	if regular.IsAdmin {
		t.Fatalf("expected regular user to not be marked as admin")
	}
}
