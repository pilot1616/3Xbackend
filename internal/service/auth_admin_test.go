package service

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/database"
	"errors"
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

func TestLockedErrorMatchesSentinel(t *testing.T) {
	err := lockedError{"account locked, try again in 5 minute(s)"}

	if !errors.Is(err, ErrAccountLocked) {
		t.Fatal("expected lockedError to match ErrAccountLocked")
	}
	if err.Error() != "account locked, try again in 5 minute(s)" {
		t.Fatalf("unexpected message: %q", err.Error())
	}
}
