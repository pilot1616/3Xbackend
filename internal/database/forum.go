package database

import (
	"time"

	"gorm.io/gorm"
)

type Question struct {
	ID          uint  `gorm:"primaryKey"`
	QID         int64 `gorm:"uniqueIndex;not null"`
	UserID      uint
	Username    string         `gorm:"size:32;index;not null"`
	Nickname    string         `gorm:"size:64;not null"`
	Text        string         `gorm:"type:text"`
	IsUpload    bool           `gorm:"default:true"`
	LikesNum    int            `gorm:"default:0"`
	CommentsNum int            `gorm:"default:0"`
	CreatedAt   time.Time      `gorm:"autoCreateTime"`
	UpdatedAt   time.Time      `gorm:"autoUpdateTime"`
	DeletedAt   gorm.DeletedAt `gorm:"index"`
	Files       []QuestionFile `gorm:"foreignKey:QuestionID"`
	Comments    []Comment      `gorm:"foreignKey:QuestionID"`
	Likes       []QuestionLike `gorm:"foreignKey:QuestionID"`
}

type QuestionFile struct {
	ID           uint      `gorm:"primaryKey"`
	QuestionID   uint      `gorm:"index;not null"`
	QID          int64     `gorm:"index;not null"`
	FileName     string    `gorm:"size:255;not null"`
	OriginalName string    `gorm:"size:255;not null"`
	CreatedAt    time.Time `gorm:"autoCreateTime"`
}

type Comment struct {
	ID         uint      `gorm:"primaryKey"`
	QuestionID uint      `gorm:"index;not null"`
	QID        int64     `gorm:"index;not null"`
	Username   string    `gorm:"size:32;index;not null"`
	Nickname   string    `gorm:"size:64;not null"`
	Text       string    `gorm:"type:text"`
	CreatedAt  time.Time `gorm:"autoCreateTime"`
}

type QuestionLike struct {
	ID         uint      `gorm:"primaryKey"`
	QuestionID uint      `gorm:"index;not null"`
	QID        int64     `gorm:"index;not null"`
	Username   string    `gorm:"size:32;index;not null"`
	Nickname   string    `gorm:"size:64;not null"`
	CreatedAt  time.Time `gorm:"autoCreateTime"`
}
