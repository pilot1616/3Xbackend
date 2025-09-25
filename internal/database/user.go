package database

type User struct {
	Id       uint32 `gorm:"primaryKey;default:auto_random()"`
	Username string
	Password string
	Sign     string
}
