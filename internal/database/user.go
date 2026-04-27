package database

import "time"

type User struct {
	ID                 uint   `gorm:"primaryKey"`
	Username           string `gorm:"size:32;uniqueIndex;not null"`
	PasswordHash       string `gorm:"column:password_hash;size:255;not null"`
	Nickname           string `gorm:"size:32;not null"`
	Age                int
	Hobby              string `gorm:"size:255"`
	Sign               string `gorm:"size:255"`
	SecurityQuestion   string `gorm:"size:32"`
	SecurityAnswerHash string `gorm:"column:security_answer_hash;size:255"`
	FailedLoginCount   int    `gorm:"default:0"`
	LockoutUntil       *time.Time
	AvatarPath         string    `gorm:"size:255"`
	CreatedAt          time.Time `gorm:"autoCreateTime"`
	UpdatedAt          time.Time `gorm:"autoUpdateTime"`
}
