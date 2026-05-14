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

type PreciousMetalSnapshot struct {
	ID             uint      `gorm:"primaryKey"`
	Source         string    `gorm:"size:64;index;not null"`
	Symbol         string    `gorm:"size:32;index;not null"`
	Name           string    `gorm:"size:64;not null"`
	SourceURL      string    `gorm:"size:255;not null"`
	Price          string    `gorm:"size:64"`
	Change         string    `gorm:"size:64"`
	ChangePercent  string    `gorm:"size:64"`
	PrevClose      string    `gorm:"size:64"`
	Open           string    `gorm:"size:64"`
	Bid            string    `gorm:"size:64"`
	Ask            string    `gorm:"size:64"`
	DayRange       string    `gorm:"size:128"`
	Week52Range    string    `gorm:"size:128"`
	Volume         string    `gorm:"size:64"`
	AvgVolume      string    `gorm:"size:64"`
	LastUpdateText string    `gorm:"size:255"`
	ContractMonth  string    `gorm:"size:64"`
	SettlementDate string    `gorm:"size:64"`
	TickSize       string    `gorm:"size:64"`
	ContractSize   string    `gorm:"size:128"`
	TickValue      string    `gorm:"size:64"`
	BaseUnit       string    `gorm:"size:64"`
	OverviewJSON   string    `gorm:"type:longtext"`
	FetchedAt      time.Time `gorm:"index;not null"`
	CreatedAt      time.Time `gorm:"autoCreateTime"`
}

type TechMarketSnapshot struct {
	ID             uint      `gorm:"primaryKey"`
	Source         string    `gorm:"size:64;index;not null"`
	Category       string    `gorm:"size:32;index;not null"`
	Symbol         string    `gorm:"size:32;index;not null"`
	Name           string    `gorm:"size:96;not null"`
	SourceURL      string    `gorm:"size:255;not null"`
	Price          string    `gorm:"size:64"`
	Change         string    `gorm:"size:64"`
	ChangePercent  string    `gorm:"size:64"`
	PrevClose      string    `gorm:"size:64"`
	Open           string    `gorm:"size:64"`
	Bid            string    `gorm:"size:64"`
	Ask            string    `gorm:"size:64"`
	DayRange       string    `gorm:"size:128"`
	Week52Range    string    `gorm:"size:128"`
	Volume         string    `gorm:"size:64"`
	AvgVolume      string    `gorm:"size:64"`
	MarketCap      string    `gorm:"size:64"`
	PERatio        string    `gorm:"size:64"`
	Beta           string    `gorm:"size:64"`
	EPS            string    `gorm:"size:64"`
	Dividend       string    `gorm:"size:64"`
	Yield          string    `gorm:"size:64"`
	LastUpdateText string    `gorm:"size:255"`
	OverviewJSON   string    `gorm:"type:longtext"`
	FetchedAt      time.Time `gorm:"index;not null"`
	CreatedAt      time.Time `gorm:"autoCreateTime"`
}
