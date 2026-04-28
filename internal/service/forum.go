package service

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/database"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"gorm.io/gorm"
)

var (
	ErrQuestionNotFound     = errors.New("question not found")
	ErrQuestionFileNotFound = errors.New("question file not found")
	ErrCommentNotFound      = errors.New("comment not found")
	ErrForbidden            = errors.New("forbidden")
	ErrInvalidContent       = errors.New("content must not be empty")
	ErrContentTooLong       = errors.New("content exceeds maximum length")
	ErrUnsupportedFile      = errors.New("unsupported file type")
	ErrFileTooLarge         = errors.New("file exceeds maximum size")
)

const (
	maxQuestionTextLength = 5000
	maxCommentTextLength  = 1000
	maxAvatarFileSize     = 5 << 20
	maxQuestionFileSize   = 20 << 20
	maxSafeQuestionQID    = 9007199254740991
)

var avatarExtensions = map[string]struct{}{
	".png":  {},
	".jpg":  {},
	".jpeg": {},
	".gif":  {},
}

var questionFileExtensions = map[string]struct{}{
	".png":  {},
	".jpg":  {},
	".jpeg": {},
	".gif":  {},
	".mp4":  {},
}

var lastGeneratedQuestionQID atomic.Int64

type ForumService struct {
	db      *gorm.DB
	storage config.Storage
}

type QuestionCreateInput struct {
	QID      int64
	UserID   uint
	Username string
	Nickname string
	Text     string
	IsUpload bool
	Files    []string
	ImgName  []string
}

type QuestionUpdateInput struct {
	QID      int64
	UserID   uint
	Username string
	Nickname string
	Text     string
	IsUpload *bool
	Files    []string
	ImgName  []string
}

type CommentCreateInput struct {
	QID      int64
	Username string
	Nickname string
	Text     string
}

type QuestionListInput struct {
	Page     int
	PageSize int
	Author   string
	Username string
	Keyword  string
	Sort     string
	IsUpload *bool
}

type CommentListInput struct {
	QID      int64
	Page     int
	PageSize int
}

type LikeCreateInput struct {
	QID      int64
	Username string
	Nickname string
}

type LegacyQuestionList struct {
	Length  int                    `json:"length"`
	Records []LegacyQuestionRecord `json:"records"`
}

type QuestionListPage struct {
	Page     int                    `json:"page"`
	PageSize int                    `json:"page_size"`
	Total    int64                  `json:"total"`
	Records  []LegacyQuestionRecord `json:"records"`
}

type CommentListPage struct {
	Page     int                   `json:"page"`
	PageSize int                   `json:"page_size"`
	Total    int64                 `json:"total"`
	Records  []LegacyCommentRecord `json:"records"`
}

type LikeListPage struct {
	Page     int                `json:"page"`
	PageSize int                `json:"page_size"`
	Total    int64              `json:"total"`
	Records  []LegacyLikeRecord `json:"records"`
}

type MyCommentListPage struct {
	Page     int               `json:"page"`
	PageSize int               `json:"page_size"`
	Total    int64             `json:"total"`
	Records  []MyCommentRecord `json:"records"`
}

type MyLikeListPage struct {
	Page     int            `json:"page"`
	PageSize int            `json:"page_size"`
	Total    int64          `json:"total"`
	Records  []MyLikeRecord `json:"records"`
}

type MySummaryResult struct {
	QuestionsCount int64 `json:"questionsCount"`
	CommentsCount  int64 `json:"commentsCount"`
	LikesCount     int64 `json:"likesCount"`
}

type LegacyQuestionRecord struct {
	QID         int64                 `json:"qid"`
	IsUpload    bool                  `json:"isUpload"`
	User        string                `json:"user"`
	NickName    string                `json:"nickName"`
	Time        string                `json:"time"`
	Text        string                `json:"text"`
	Files       []string              `json:"files"`
	ImgName     []string              `json:"imgName"`
	LikesNum    int                   `json:"likesNum"`
	CommentsNum int                   `json:"commentsNum"`
	Comments    []LegacyCommentRecord `json:"comments"`
	LikedByMe   bool                  `json:"likedByMe"`
	OwnedByMe   bool                  `json:"ownedByMe"`
	AvatarPath  string                `json:"avatarPath,omitempty"`
	Deleted     bool                  `json:"deleted,omitempty"`
}

type LegacyCommentRecord struct {
	ID       uint   `json:"id"`
	User     string `json:"user"`
	NickName string `json:"nickName"`
	Time     string `json:"time"`
	Text     string `json:"text"`
}

type LegacyLikeRecord struct {
	ID       uint   `json:"id"`
	User     string `json:"user"`
	NickName string `json:"nickName"`
	Time     string `json:"time"`
}

type MyCommentRecord struct {
	ID           uint   `json:"id"`
	QID          int64  `json:"qid"`
	Time         string `json:"time"`
	Text         string `json:"text"`
	QuestionText string `json:"questionText,omitempty"`
}

type MyLikeRecord struct {
	ID               uint   `json:"id"`
	QID              int64  `json:"qid"`
	LikedAt          string `json:"likedAt"`
	QuestionUser     string `json:"questionUser,omitempty"`
	QuestionNickName string `json:"questionNickName,omitempty"`
	QuestionText     string `json:"questionText,omitempty"`
	IsUpload         bool   `json:"isUpload"`
	LikesNum         int    `json:"likesNum"`
	CommentsNum      int    `json:"commentsNum"`
}

type ToggleUploadResult struct {
	UploadFlag bool `json:"uploadFlag"`
}

type DeleteUploadResult struct {
	Deleted bool `json:"deleted"`
}

type LikeResult struct {
	Liked    bool `json:"liked"`
	LikesNum int  `json:"likesNum"`
}

type FileUploadResult struct {
	Saved         bool     `json:"saved"`
	Files         []string `json:"files,omitempty"`
	OriginalNames []string `json:"imgName,omitempty"`
	Path          string   `json:"path,omitempty"`
}

type FileDeleteResult struct {
	Deleted bool   `json:"deleted"`
	File    string `json:"file,omitempty"`
}

type ImageInfoResult struct {
	Status int    `json:"status"`
	Path   string `json:"path,omitempty"`
	Error  string `json:"error,omitempty"`
}

func NewForumService(db *gorm.DB, storage config.Storage) (*ForumService, error) {
	service := &ForumService{db: db, storage: storage}
	for _, dir := range []string{storage.PublicRoot(), storage.ImageRoot(), storage.UploadRoot()} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create storage dir failed: %w", err)
		}
	}
	if err := service.ensureDefaultAvatar(); err != nil {
		return nil, err
	}
	if err := service.syncQuestionQIDGenerator(); err != nil {
		return nil, err
	}
	if err := service.normalizeUnsafeQuestionQIDs(); err != nil {
		return nil, err
	}
	return service, nil
}

func (s *ForumService) ListQuestions() (*LegacyQuestionList, error) {
	pageResult, err := s.ListQuestionsPaged(QuestionListInput{Page: 1, PageSize: 200})
	if err != nil {
		return nil, err
	}
	return &LegacyQuestionList{Length: len(pageResult.Records), Records: pageResult.Records}, nil
}

func (s *ForumService) ListQuestionsPaged(input QuestionListInput) (*QuestionListPage, error) {
	page := normalizePage(input.Page)
	pageSize := normalizePageSize(input.PageSize)
	sortClause := questionSortClause(input.Sort)

	query := s.db.Model(&database.Question{})
	author := strings.TrimSpace(input.Author)
	username := strings.TrimSpace(input.Username)
	keyword := strings.TrimSpace(input.Keyword)
	if username != "" {
		query = query.Where("username = ?", username)
	}
	if author != "" {
		query = query.Where("username = ? OR nickname = ?", author, author)
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("text LIKE ?", like)
	}
	if input.IsUpload != nil {
		query = query.Where("is_upload = ?", *input.IsUpload)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count questions failed: %w", err)
	}

	var questions []database.Question
	if err := query.Preload("Files").Preload("Comments").Order(sortClause).Offset((page - 1) * pageSize).Limit(pageSize).Find(&questions).Error; err != nil {
		return nil, fmt.Errorf("query questions failed: %w", err)
	}

	records := make([]LegacyQuestionRecord, 0, len(questions))
	for _, question := range questions {
		records = append(records, buildQuestionRecord(question))
	}

	return &QuestionListPage{Page: page, PageSize: pageSize, Total: total, Records: records}, nil
}

func (s *ForumService) ListMyQuestions(userID uint, username string, page, pageSize int, keyword, sort string, isUpload *bool) (*QuestionListPage, error) {
	if userID != 0 {
		user, err := s.FindUserByID(userID)
		if err != nil {
			return nil, err
		}
		username = user.Username
	}
	return s.ListQuestionsPaged(QuestionListInput{
		Page:     page,
		PageSize: pageSize,
		Username: username,
		Keyword:  keyword,
		Sort:     sort,
		IsUpload: isUpload,
	})
}

func (s *ForumService) ListLikesPaged(qid int64, page, pageSize int) (*LikeListPage, error) {
	question, err := s.findQuestionByQID(qid)
	if err != nil {
		return nil, err
	}

	page = normalizePage(page)
	pageSize = normalizePageSize(pageSize)

	query := s.db.Model(&database.QuestionLike{}).Where("question_id = ?", question.ID)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count likes failed: %w", err)
	}

	var likes []database.QuestionLike
	if err := query.Order("created_at asc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&likes).Error; err != nil {
		return nil, fmt.Errorf("query likes failed: %w", err)
	}

	records := make([]LegacyLikeRecord, 0, len(likes))
	for _, like := range likes {
		records = append(records, buildLikeRecord(like))
	}

	return &LikeListPage{Page: page, PageSize: pageSize, Total: total, Records: records}, nil
}

func (s *ForumService) ListMyComments(userID uint, username string, page, pageSize int, keyword string) (*MyCommentListPage, error) {
	if userID != 0 {
		user, err := s.FindUserByID(userID)
		if err != nil {
			return nil, err
		}
		username = user.Username
	}

	page = normalizePage(page)
	pageSize = normalizePageSize(pageSize)
	username = strings.TrimSpace(username)
	keyword = strings.TrimSpace(keyword)

	query := s.db.Model(&database.Comment{}).Where("username = ?", username)
	if keyword != "" {
		query = query.Where("text LIKE ?", "%"+keyword+"%")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count comments failed: %w", err)
	}

	var comments []database.Comment
	if err := query.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&comments).Error; err != nil {
		return nil, fmt.Errorf("query comments failed: %w", err)
	}

	questionIDs := make([]uint, 0, len(comments))
	questionIDSet := make(map[uint]struct{}, len(comments))
	for _, comment := range comments {
		if _, exists := questionIDSet[comment.QuestionID]; exists {
			continue
		}
		questionIDSet[comment.QuestionID] = struct{}{}
		questionIDs = append(questionIDs, comment.QuestionID)
	}

	questionTextByID := make(map[uint]string, len(questionIDs))
	if len(questionIDs) > 0 {
		var questions []database.Question
		if err := s.db.Select("id", "text").Where("id IN ?", questionIDs).Find(&questions).Error; err != nil {
			return nil, fmt.Errorf("query comment questions failed: %w", err)
		}
		for _, question := range questions {
			questionTextByID[question.ID] = question.Text
		}
	}

	records := make([]MyCommentRecord, 0, len(comments))
	for _, comment := range comments {
		records = append(records, MyCommentRecord{
			ID:           comment.ID,
			QID:          comment.QID,
			Time:         formatLegacyTime(comment.CreatedAt),
			Text:         comment.Text,
			QuestionText: questionTextByID[comment.QuestionID],
		})
	}

	return &MyCommentListPage{Page: page, PageSize: pageSize, Total: total, Records: records}, nil
}

func (s *ForumService) ListMyLikes(userID uint, username string, page, pageSize int, keyword string) (*MyLikeListPage, error) {
	if userID != 0 {
		user, err := s.FindUserByID(userID)
		if err != nil {
			return nil, err
		}
		username = user.Username
	}

	page = normalizePage(page)
	pageSize = normalizePageSize(pageSize)
	username = strings.TrimSpace(username)
	keyword = strings.TrimSpace(keyword)

	baseQuery := s.db.Model(&database.QuestionLike{}).Where("username = ?", username)
	if keyword != "" {
		baseQuery = baseQuery.Joins("JOIN questions ON questions.id = question_likes.question_id").Where("questions.text LIKE ?", "%"+keyword+"%")
	}

	var total int64
	if err := baseQuery.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count likes failed: %w", err)
	}

	query := s.db.Model(&database.QuestionLike{}).Where("username = ?", username)
	if keyword != "" {
		query = query.Joins("JOIN questions ON questions.id = question_likes.question_id").Where("questions.text LIKE ?", "%"+keyword+"%")
	}

	var likes []database.QuestionLike
	if err := query.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&likes).Error; err != nil {
		return nil, fmt.Errorf("query likes failed: %w", err)
	}

	questionIDs := make([]uint, 0, len(likes))
	questionIDSet := make(map[uint]struct{}, len(likes))
	for _, like := range likes {
		if _, exists := questionIDSet[like.QuestionID]; exists {
			continue
		}
		questionIDSet[like.QuestionID] = struct{}{}
		questionIDs = append(questionIDs, like.QuestionID)
	}

	questionByID := make(map[uint]database.Question, len(questionIDs))
	if len(questionIDs) > 0 {
		var questions []database.Question
		if err := s.db.Select("id", "q_id", "username", "nickname", "text", "is_upload", "likes_num", "comments_num").Where("id IN ?", questionIDs).Find(&questions).Error; err != nil {
			return nil, fmt.Errorf("query liked questions failed: %w", err)
		}
		for _, question := range questions {
			questionByID[question.ID] = question
		}
	}

	records := make([]MyLikeRecord, 0, len(likes))
	for _, like := range likes {
		question := questionByID[like.QuestionID]
		records = append(records, MyLikeRecord{
			ID:               like.ID,
			QID:              like.QID,
			LikedAt:          formatLegacyTime(like.CreatedAt),
			QuestionUser:     question.Username,
			QuestionNickName: question.Nickname,
			QuestionText:     question.Text,
			IsUpload:         question.IsUpload,
			LikesNum:         question.LikesNum,
			CommentsNum:      question.CommentsNum,
		})
	}

	return &MyLikeListPage{Page: page, PageSize: pageSize, Total: total, Records: records}, nil
}

func (s *ForumService) GetMySummary(userID uint, username string) (*MySummaryResult, error) {
	if userID != 0 {
		user, err := s.FindUserByID(userID)
		if err != nil {
			return nil, err
		}
		username = user.Username
	}
	username = strings.TrimSpace(username)

	result := &MySummaryResult{}
	if err := s.db.Model(&database.Question{}).Where("username = ?", username).Count(&result.QuestionsCount).Error; err != nil {
		return nil, fmt.Errorf("count questions failed: %w", err)
	}
	if err := s.db.Model(&database.Comment{}).Where("username = ?", username).Count(&result.CommentsCount).Error; err != nil {
		return nil, fmt.Errorf("count comments failed: %w", err)
	}
	if err := s.db.Model(&database.QuestionLike{}).Where("username = ?", username).Count(&result.LikesCount).Error; err != nil {
		return nil, fmt.Errorf("count likes failed: %w", err)
	}

	return result, nil
}

func (s *ForumService) DecorateQuestionRecordForUser(record *LegacyQuestionRecord, userID uint, username string) error {
	if record == nil {
		return nil
	}
	return s.DecorateQuestionRecordsForUser([]*LegacyQuestionRecord{record}, userID, username)
}

func (s *ForumService) DecorateQuestionRecordsForUser(records []*LegacyQuestionRecord, userID uint, username string) error {
	if len(records) == 0 {
		return nil
	}

	if err := s.attachQuestionAvatarPaths(records); err != nil {
		return err
	}

	resolvedUsername, err := s.resolveUsername(userID, username)
	if err != nil {
		return err
	}
	if resolvedUsername == "" {
		for _, record := range records {
			if record == nil {
				continue
			}
			record.OwnedByMe = false
			record.LikedByMe = false
		}
		return nil
	}

	qids := make([]int64, 0, len(records))
	for _, record := range records {
		if record == nil {
			continue
		}
		record.OwnedByMe = record.User == resolvedUsername
		qids = append(qids, record.QID)
	}

	likedQIDs := make(map[int64]struct{}, len(qids))
	if len(qids) > 0 {
		var likes []database.QuestionLike
		if err := s.db.Select("q_id").Where("username = ? AND q_id IN ?", resolvedUsername, qids).Find(&likes).Error; err != nil {
			return fmt.Errorf("query question like state failed: %w", err)
		}
		for _, like := range likes {
			likedQIDs[like.QID] = struct{}{}
		}
	}

	for _, record := range records {
		if record == nil {
			continue
		}
		_, record.LikedByMe = likedQIDs[record.QID]
	}

	return nil
}

func (s *ForumService) attachQuestionAvatarPaths(records []*LegacyQuestionRecord) error {
	usernames := make([]string, 0, len(records))
	seen := make(map[string]struct{}, len(records))
	for _, record := range records {
		if record == nil {
			continue
		}
		username := strings.TrimSpace(record.User)
		if username == "" {
			continue
		}
		if _, exists := seen[username]; exists {
			continue
		}
		seen[username] = struct{}{}
		usernames = append(usernames, username)
	}

	if len(usernames) == 0 {
		return nil
	}

	var users []database.User
	if err := s.db.Select("username", "avatar_path").Where("username IN ?", usernames).Find(&users).Error; err != nil {
		return fmt.Errorf("query question avatars failed: %w", err)
	}

	avatarByUsername := make(map[string]string, len(users))
	for _, user := range users {
		avatarByUsername[user.Username] = user.AvatarPath
	}

	for _, record := range records {
		if record == nil || strings.TrimSpace(record.AvatarPath) != "" {
			continue
		}
		record.AvatarPath = avatarByUsername[strings.TrimSpace(record.User)]
	}

	return nil
}

func (s *ForumService) ListCommentsPaged(input CommentListInput) (*CommentListPage, error) {
	question, err := s.findQuestionByQID(input.QID)
	if err != nil {
		return nil, err
	}

	page := input.Page
	if page <= 0 {
		page = 1
	}
	pageSize := input.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	query := s.db.Model(&database.Comment{}).Where("question_id = ?", question.ID)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count comments failed: %w", err)
	}

	var comments []database.Comment
	if err := query.Order("created_at asc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&comments).Error; err != nil {
		return nil, fmt.Errorf("query comments failed: %w", err)
	}

	records := make([]LegacyCommentRecord, 0, len(comments))
	for _, comment := range comments {
		records = append(records, buildCommentRecord(comment))
	}

	return &CommentListPage{Page: page, PageSize: pageSize, Total: total, Records: records}, nil
}

func (s *ForumService) GetQuestion(qid int64) (*LegacyQuestionRecord, error) {
	return s.getQuestionRecord(qid)
}

func (s *ForumService) CreateQuestion(input QuestionCreateInput) (*LegacyQuestionRecord, error) {
	if input.QID == 0 {
		input.QID = nextQuestionQID(time.Now())
	}
	input.Username = strings.TrimSpace(input.Username)
	input.Nickname = strings.TrimSpace(input.Nickname)
	if input.Username == "" {
		return nil, ErrInvalidUsername
	}
	text, err := validateForumContent(input.Text, maxQuestionTextLength)
	if err != nil {
		return nil, err
	}

	user, _ := s.lookupUser(input.Username)
	nickname := input.Nickname
	avatarPath := ""
	userID := input.UserID
	if user != nil {
		nickname = fallbackNickname(nickname, user.Nickname, input.Username)
		avatarPath = user.AvatarPath
		if userID == 0 {
			userID = user.ID
		}
	} else {
		nickname = fallbackNickname(nickname, "", input.Username)
	}

	question := database.Question{
		QID:         input.QID,
		UserID:      userID,
		Username:    input.Username,
		Nickname:    nickname,
		Text:        text,
		IsUpload:    input.IsUpload,
		LikesNum:    0,
		CommentsNum: 0,
	}

	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&question).Error; err != nil {
			return err
		}

		for i, fileName := range input.Files {
			originalName := fileName
			if i < len(input.ImgName) && strings.TrimSpace(input.ImgName[i]) != "" {
				originalName = input.ImgName[i]
			}
			file := database.QuestionFile{
				QuestionID:   question.ID,
				QID:          question.QID,
				FileName:     fileName,
				OriginalName: originalName,
			}
			if err := tx.Create(&file).Error; err != nil {
				return err
			}
			question.Files = append(question.Files, file)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("create question failed: %w", err)
	}

	record := buildQuestionRecord(question)
	record.AvatarPath = avatarPath
	return &record, nil
}

func (s *ForumService) UpdateQuestion(input QuestionUpdateInput) (*LegacyQuestionRecord, error) {
	question, err := s.findQuestionByQID(input.QID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureQuestionOwner(question, input.UserID, input.Username); err != nil {
		return nil, err
	}

	nickname := strings.TrimSpace(input.Nickname)
	if nickname == "" {
		nickname = question.Nickname
	}
	text := question.Text
	if strings.TrimSpace(input.Text) != "" {
		validatedText, err := validateForumContent(input.Text, maxQuestionTextLength)
		if err != nil {
			return nil, err
		}
		text = validatedText
	} else if text == "" {
		text = question.Text
	}
	isUpload := question.IsUpload
	if input.IsUpload != nil {
		isUpload = *input.IsUpload
	}

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		updates := map[string]any{
			"nickname":  nickname,
			"text":      text,
			"is_upload": isUpload,
		}
		if err := tx.Model(question).Updates(updates).Error; err != nil {
			return err
		}

		if input.Files != nil {
			var oldFiles []database.QuestionFile
			if err := tx.Where("question_id = ?", question.ID).Find(&oldFiles).Error; err != nil {
				return err
			}
			if err := tx.Where("question_id = ?", question.ID).Delete(&database.QuestionFile{}).Error; err != nil {
				return err
			}
			for _, oldFile := range oldFiles {
				if !containsString(input.Files, oldFile.FileName) {
					_ = os.Remove(filepath.Join(s.storage.UploadRoot(), oldFile.FileName))
				}
			}
			for i, fileName := range input.Files {
				originalName := fileName
				if i < len(input.ImgName) && strings.TrimSpace(input.ImgName[i]) != "" {
					originalName = input.ImgName[i]
				}
				file := database.QuestionFile{
					QuestionID:   question.ID,
					QID:          question.QID,
					FileName:     fileName,
					OriginalName: originalName,
				}
				if err := tx.Create(&file).Error; err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		return nil, fmt.Errorf("update question failed: %w", err)
	}

	return s.getQuestionRecord(input.QID)
}

func (s *ForumService) AddComment(input CommentCreateInput) (*LegacyQuestionRecord, error) {
	question, err := s.findQuestionByQID(input.QID)
	if err != nil {
		return nil, err
	}
	text, err := validateForumContent(input.Text, maxCommentTextLength)
	if err != nil {
		return nil, err
	}

	user, _ := s.lookupUser(input.Username)
	nickname := input.Nickname
	if user != nil {
		nickname = fallbackNickname(nickname, user.Nickname, input.Username)
	} else {
		nickname = fallbackNickname(nickname, "", input.Username)
	}

	comment := database.Comment{
		QuestionID: question.ID,
		QID:        question.QID,
		Username:   strings.TrimSpace(input.Username),
		Nickname:   nickname,
		Text:       text,
	}

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&comment).Error; err != nil {
			return err
		}
		return tx.Model(question).Update("comments_num", gorm.Expr("comments_num + 1")).Error
	}); err != nil {
		return nil, fmt.Errorf("create comment failed: %w", err)
	}

	return s.getQuestionRecord(input.QID)
}

func (s *ForumService) AddCommentOwned(qid int64, userID uint, username, text string) (*LegacyQuestionRecord, error) {
	user, err := s.FindUserByID(userID)
	if err != nil {
		return nil, err
	}
	resolvedUsername := strings.TrimSpace(username)
	if resolvedUsername == "" {
		resolvedUsername = user.Username
	}
	return s.AddComment(CommentCreateInput{
		QID:      qid,
		Username: resolvedUsername,
		Nickname: user.Nickname,
		Text:     text,
	})
}

func (s *ForumService) UpdateCommentOwned(qid int64, commentID uint, userID uint, username, text string) (*LegacyQuestionRecord, error) {
	question, err := s.findQuestionByQID(qid)
	if err != nil {
		return nil, err
	}

	validatedText, err := validateForumContent(text, maxCommentTextLength)
	if err != nil {
		return nil, err
	}

	var comment database.Comment
	if err := s.db.Where("id = ? AND question_id = ?", commentID, question.ID).First(&comment).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCommentNotFound
		}
		return nil, fmt.Errorf("query comment failed: %w", err)
	}

	resolvedUsername := strings.TrimSpace(username)
	if resolvedUsername == "" && userID != 0 {
		user, err := s.FindUserByID(userID)
		if err != nil {
			return nil, err
		}
		resolvedUsername = user.Username
	}
	if resolvedUsername == "" || comment.Username != resolvedUsername {
		return nil, ErrForbidden
	}

	if err := s.db.Model(&comment).Update("text", validatedText).Error; err != nil {
		return nil, fmt.Errorf("update comment failed: %w", err)
	}

	return s.getQuestionRecord(qid)
}

func (s *ForumService) DeleteCommentOwned(qid int64, commentID uint, userID uint, username string) (*LegacyQuestionRecord, error) {
	question, err := s.findQuestionByQID(qid)
	if err != nil {
		return nil, err
	}

	var comment database.Comment
	if err := s.db.Where("id = ? AND question_id = ?", commentID, question.ID).First(&comment).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCommentNotFound
		}
		return nil, fmt.Errorf("query comment failed: %w", err)
	}

	resolvedUsername := strings.TrimSpace(username)
	if resolvedUsername == "" && userID != 0 {
		user, err := s.FindUserByID(userID)
		if err != nil {
			return nil, err
		}
		resolvedUsername = user.Username
	}
	if resolvedUsername == "" || comment.Username != resolvedUsername {
		return nil, ErrForbidden
	}

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&comment).Error; err != nil {
			return err
		}
		return tx.Model(question).Update("comments_num", gorm.Expr("GREATEST(comments_num - 1, 0)")).Error
	}); err != nil {
		return nil, fmt.Errorf("delete comment failed: %w", err)
	}

	return s.getQuestionRecord(qid)
}

func (s *ForumService) AddLike(input LikeCreateInput) (*LikeResult, error) {
	question, err := s.findQuestionByQID(input.QID)
	if err != nil {
		return nil, err
	}

	user, _ := s.lookupUser(input.Username)
	nickname := input.Nickname
	if user != nil {
		nickname = fallbackNickname(nickname, user.Nickname, input.Username)
	} else {
		nickname = fallbackNickname(nickname, "", input.Username)
	}

	var existing database.QuestionLike
	err = s.db.Where("question_id = ? AND username = ?", question.ID, strings.TrimSpace(input.Username)).First(&existing).Error
	if err == nil {
		return &LikeResult{Liked: true, LikesNum: question.LikesNum}, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("query like failed: %w", err)
	}

	like := database.QuestionLike{
		QuestionID: question.ID,
		QID:        question.QID,
		Username:   strings.TrimSpace(input.Username),
		Nickname:   nickname,
	}
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&like).Error; err != nil {
			return err
		}
		return tx.Model(question).Update("likes_num", gorm.Expr("likes_num + 1")).Error
	}); err != nil {
		return nil, fmt.Errorf("create like failed: %w", err)
	}

	question.LikesNum++
	return &LikeResult{Liked: true, LikesNum: question.LikesNum}, nil
}

func (s *ForumService) AddLikeOwned(qid int64, userID uint, username string) (*LikeResult, error) {
	user, err := s.FindUserByID(userID)
	if err != nil {
		return nil, err
	}
	resolvedUsername := strings.TrimSpace(username)
	if resolvedUsername == "" {
		resolvedUsername = user.Username
	}
	return s.AddLike(LikeCreateInput{
		QID:      qid,
		Username: resolvedUsername,
		Nickname: user.Nickname,
	})
}

func (s *ForumService) RemoveLikeOwned(qid int64, userID uint, username string) (*LikeResult, error) {
	question, err := s.findQuestionByQID(qid)
	if err != nil {
		return nil, err
	}

	resolvedUsername := strings.TrimSpace(username)
	if resolvedUsername == "" {
		user, err := s.FindUserByID(userID)
		if err != nil {
			return nil, err
		}
		resolvedUsername = user.Username
	}

	var like database.QuestionLike
	err = s.db.Where("question_id = ? AND username = ?", question.ID, resolvedUsername).First(&like).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &LikeResult{Liked: false, LikesNum: question.LikesNum}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query like failed: %w", err)
	}

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&like).Error; err != nil {
			return err
		}
		return tx.Model(question).Update("likes_num", gorm.Expr("GREATEST(likes_num - 1, 0)")).Error
	}); err != nil {
		return nil, fmt.Errorf("delete like failed: %w", err)
	}

	likesNum := question.LikesNum - 1
	if likesNum < 0 {
		likesNum = 0
	}
	return &LikeResult{Liked: false, LikesNum: likesNum}, nil
}

func (s *ForumService) ToggleQuestionUpload(qid int64) (*ToggleUploadResult, error) {
	question, err := s.findQuestionByQID(qid)
	if err != nil {
		return nil, err
	}

	newFlag := !question.IsUpload
	if err := s.db.Model(question).Update("is_upload", newFlag).Error; err != nil {
		return nil, fmt.Errorf("toggle upload failed: %w", err)
	}

	return &ToggleUploadResult{UploadFlag: newFlag}, nil
}

func (s *ForumService) ToggleQuestionUploadOwned(qid int64, userID uint, username string) (*ToggleUploadResult, error) {
	question, err := s.findQuestionByQID(qid)
	if err != nil {
		return nil, err
	}
	if err := s.ensureQuestionOwner(question, userID, username); err != nil {
		return nil, err
	}
	return s.ToggleQuestionUpload(qid)
}

func (s *ForumService) DeleteQuestion(qid int64) (*DeleteUploadResult, error) {
	question, err := s.findQuestionByQID(qid)
	if err != nil {
		return nil, err
	}

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("question_id = ?", question.ID).Delete(&database.QuestionFile{}).Error; err != nil {
			return err
		}
		if err := tx.Where("question_id = ?", question.ID).Delete(&database.Comment{}).Error; err != nil {
			return err
		}
		if err := tx.Where("question_id = ?", question.ID).Delete(&database.QuestionLike{}).Error; err != nil {
			return err
		}
		return tx.Delete(question).Error
	}); err != nil {
		return nil, fmt.Errorf("delete question failed: %w", err)
	}

	for _, file := range question.Files {
		_ = os.Remove(filepath.Join(s.storage.UploadRoot(), file.FileName))
	}

	return &DeleteUploadResult{Deleted: true}, nil
}

func (s *ForumService) DeleteQuestionOwned(qid int64, userID uint, username string) (*DeleteUploadResult, error) {
	question, err := s.findQuestionByQID(qid)
	if err != nil {
		return nil, err
	}
	if err := s.ensureQuestionOwner(question, userID, username); err != nil {
		return nil, err
	}
	return s.DeleteQuestion(qid)
}

func (s *ForumService) SaveQuestionFiles(qid int64, files []*multipart.FileHeader) (*FileUploadResult, error) {
	saved := make([]string, 0, len(files))
	for _, file := range files {
		if err := validateUploadedFile(file, questionFileExtensions, maxQuestionFileSize); err != nil {
			return nil, err
		}
		name := buildQuestionFileName(qid, file.Filename)
		if err := saveMultipartFile(file, filepath.Join(s.storage.UploadRoot(), name)); err != nil {
			return nil, err
		}
		saved = append(saved, name)
	}
	return &FileUploadResult{Saved: true, Files: saved}, nil
}

func (s *ForumService) SaveQuestionFilesOwned(qid int64, userID uint, username string, files []*multipart.FileHeader) (*FileUploadResult, error) {
	question, err := s.findQuestionByQID(qid)
	if err != nil {
		return nil, err
	}
	if err := s.ensureQuestionOwner(question, userID, username); err != nil {
		return nil, err
	}

	saved := make([]string, 0, len(files))
	originalNames := make([]string, 0, len(files))
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		for _, file := range files {
			if err := validateUploadedFile(file, questionFileExtensions, maxQuestionFileSize); err != nil {
				return err
			}
			name := buildQuestionFileName(qid, file.Filename)
			originalName := filepath.Base(file.Filename)
			if err := saveMultipartFile(file, filepath.Join(s.storage.UploadRoot(), name)); err != nil {
				return err
			}

			saved = append(saved, name)
			originalNames = append(originalNames, originalName)

			var existing database.QuestionFile
			err := tx.Where("question_id = ? AND file_name = ?", question.ID, name).First(&existing).Error
			switch {
			case err == nil:
				if existing.OriginalName != originalName {
					if err := tx.Model(&existing).Update("original_name", originalName).Error; err != nil {
						return err
					}
				}
			case errors.Is(err, gorm.ErrRecordNotFound):
				questionFile := database.QuestionFile{
					QuestionID:   question.ID,
					QID:          question.QID,
					FileName:     name,
					OriginalName: originalName,
				}
				if err := tx.Create(&questionFile).Error; err != nil {
					return err
				}
			default:
				return fmt.Errorf("query question file failed: %w", err)
			}
		}
		return nil
	}); err != nil {
		return nil, fmt.Errorf("save question files failed: %w", err)
	}

	return &FileUploadResult{Saved: true, Files: saved, OriginalNames: originalNames}, nil
}

func (s *ForumService) DeleteQuestionFileOwned(qid int64, fileName string, userID uint, username string) (*FileDeleteResult, error) {
	question, err := s.findQuestionByQID(qid)
	if err != nil {
		return nil, err
	}
	if err := s.ensureQuestionOwner(question, userID, username); err != nil {
		return nil, err
	}

	resolvedName := filepath.Base(strings.TrimSpace(fileName))
	if resolvedName == "" {
		return nil, ErrQuestionFileNotFound
	}

	var questionFile database.QuestionFile
	if err := s.db.Where("question_id = ? AND file_name = ?", question.ID, resolvedName).First(&questionFile).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrQuestionFileNotFound
		}
		return nil, fmt.Errorf("query question file failed: %w", err)
	}

	if err := s.db.Delete(&questionFile).Error; err != nil {
		return nil, fmt.Errorf("delete question file failed: %w", err)
	}

	_ = os.Remove(filepath.Join(s.storage.UploadRoot(), resolvedName))
	return &FileDeleteResult{Deleted: true, File: resolvedName}, nil
}

func (s *ForumService) SaveProfileImage(file *multipart.FileHeader, username string) (*FileUploadResult, error) {
	if err := validateUploadedFile(file, avatarExtensions, maxAvatarFileSize); err != nil {
		return nil, err
	}
	name := filepath.Base(file.Filename)
	if err := saveMultipartFile(file, filepath.Join(s.storage.ImageRoot(), name)); err != nil {
		return nil, err
	}

	resolvedUsername := strings.TrimSpace(username)
	if resolvedUsername == "" {
		resolvedUsername = strings.TrimSuffix(name, filepath.Ext(name))
	}
	resolvedPath := "/public/images/" + name
	if phonePattern.MatchString(resolvedUsername) {
		_ = s.db.Model(&database.User{}).Where("username = ?", resolvedUsername).Update("avatar_path", resolvedPath).Error
	}

	return &FileUploadResult{Saved: true, Path: resolvedPath}, nil
}

func (s *ForumService) SaveProfileImageOwned(file *multipart.FileHeader, userID uint) (*FileUploadResult, error) {
	user, err := s.FindUserByID(userID)
	if err != nil {
		return nil, err
	}
	if err := validateUploadedFile(file, avatarExtensions, maxAvatarFileSize); err != nil {
		return nil, err
	}

	name := buildAvatarFileName(user.Username, file.Filename)
	if err := saveMultipartFile(file, filepath.Join(s.storage.ImageRoot(), name)); err != nil {
		return nil, err
	}

	resolvedPath := "/public/images/" + name
	previousPath := user.AvatarPath
	if err := s.db.Model(user).Update("avatar_path", resolvedPath).Error; err != nil {
		return nil, fmt.Errorf("update avatar failed: %w", err)
	}

	if previousPath != "" && previousPath != resolvedPath && previousPath != "/public/images/userImgDefault.png" {
		_ = os.Remove(filepath.Join(s.storage.ImageRoot(), filepath.Base(previousPath)))
	}

	return &FileUploadResult{Saved: true, Path: resolvedPath}, nil
}

func (s *ForumService) GetImageInfo(filename string) *ImageInfoResult {
	name := filepath.Base(filename)
	path := filepath.Join(s.storage.ImageRoot(), name)
	if _, err := os.Stat(path); err != nil {
		return &ImageInfoResult{Status: 404, Error: "image not found"}
	}
	return &ImageInfoResult{Status: 200, Path: "/public/images/" + name}
}

func (s *ForumService) getQuestionRecord(qid int64) (*LegacyQuestionRecord, error) {
	question, err := s.findQuestionByQID(qid)
	if err != nil {
		return nil, err
	}
	record := buildQuestionRecord(*question)
	return &record, nil
}

func (s *ForumService) findQuestionByQID(qid int64) (*database.Question, error) {
	var question database.Question
	if err := s.db.Preload("Files").Preload("Comments").Where("q_id = ?", qid).First(&question).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrQuestionNotFound
		}
		return nil, fmt.Errorf("query question failed: %w", err)
	}
	return &question, nil
}

func (s *ForumService) lookupUser(username string) (*database.User, error) {
	var user database.User
	if err := s.db.Where("username = ?", strings.TrimSpace(username)).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &user, nil
}

func (s *ForumService) resolveUsername(userID uint, username string) (string, error) {
	resolvedUsername := strings.TrimSpace(username)
	if resolvedUsername != "" {
		return resolvedUsername, nil
	}
	if userID == 0 {
		return "", nil
	}
	user, err := s.FindUserByID(userID)
	if err != nil {
		return "", err
	}
	return user.Username, nil
}

func (s *ForumService) FindUserByID(userID uint) (*database.User, error) {
	var user database.User
	if err := s.db.First(&user, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUnauthorized
		}
		return nil, err
	}
	return &user, nil
}

func (s *ForumService) ensureQuestionOwner(question *database.Question, userID uint, username string) error {
	if userID != 0 && question.UserID != 0 && question.UserID == userID {
		return nil
	}
	if strings.TrimSpace(username) != "" && question.Username == strings.TrimSpace(username) {
		return nil
	}
	if userID != 0 {
		user, err := s.FindUserByID(userID)
		if err == nil && user.Username == question.Username {
			return nil
		}
	}
	return ErrForbidden
}

func buildQuestionRecord(question database.Question) LegacyQuestionRecord {
	files := make([]string, 0, len(question.Files))
	imgNames := make([]string, 0, len(question.Files))
	comments := make([]LegacyCommentRecord, 0, len(question.Comments))

	sort.Slice(question.Files, func(i, j int) bool {
		return question.Files[i].ID < question.Files[j].ID
	})
	sort.Slice(question.Comments, func(i, j int) bool {
		return question.Comments[i].ID < question.Comments[j].ID
	})

	for _, file := range question.Files {
		files = append(files, file.FileName)
		imgNames = append(imgNames, file.OriginalName)
	}
	for _, comment := range question.Comments {
		comments = append(comments, buildCommentRecord(comment))
	}

	return LegacyQuestionRecord{
		QID:         question.QID,
		IsUpload:    question.IsUpload,
		User:        question.Username,
		NickName:    question.Nickname,
		Time:        formatLegacyTime(question.CreatedAt),
		Text:        question.Text,
		Files:       files,
		ImgName:     imgNames,
		LikesNum:    question.LikesNum,
		CommentsNum: question.CommentsNum,
		Comments:    comments,
	}
}

func buildCommentRecord(comment database.Comment) LegacyCommentRecord {
	return LegacyCommentRecord{
		ID:       comment.ID,
		User:     comment.Username,
		NickName: comment.Nickname,
		Time:     formatLegacyTime(comment.CreatedAt),
		Text:     comment.Text,
	}
}

func buildLikeRecord(like database.QuestionLike) LegacyLikeRecord {
	return LegacyLikeRecord{
		ID:       like.ID,
		User:     like.Username,
		NickName: like.Nickname,
		Time:     formatLegacyTime(like.CreatedAt),
	}
}

func formatLegacyTime(t time.Time) string {
	return t.Local().Format("2006-01-02 15:04:05")
}

func normalizePage(page int) int {
	if page <= 0 {
		return 1
	}
	return page
}

func normalizePageSize(pageSize int) int {
	if pageSize <= 0 {
		return 20
	}
	if pageSize > 100 {
		return 100
	}
	return pageSize
}

func normalizeQuestionSort(sort string) string {
	switch strings.ToLower(strings.TrimSpace(sort)) {
	case "oldest":
		return "oldest"
	case "most_liked":
		return "most_liked"
	case "most_commented":
		return "most_commented"
	default:
		return "latest"
	}
}

func questionSortClause(sort string) string {
	switch normalizeQuestionSort(sort) {
	case "oldest":
		return "created_at asc"
	case "most_liked":
		return "likes_num desc, created_at desc"
	case "most_commented":
		return "comments_num desc, created_at desc"
	default:
		return "created_at desc"
	}
}

func fallbackNickname(preferred, current, username string) string {
	if strings.TrimSpace(preferred) != "" {
		return strings.TrimSpace(preferred)
	}
	if strings.TrimSpace(current) != "" {
		return strings.TrimSpace(current)
	}
	return strings.TrimSpace(username)
}

func buildQuestionFileName(qid int64, original string) string {
	name := filepath.Base(original)
	prefix := fmt.Sprintf("%d_", qid)
	if strings.HasPrefix(name, prefix) {
		return name
	}
	return prefix + name
}

func nextQuestionQID(now time.Time) int64 {
	current := now.UnixMilli()
	for {
		last := lastGeneratedQuestionQID.Load()
		next := current
		if last >= next {
			next = last + 1
		}
		if lastGeneratedQuestionQID.CompareAndSwap(last, next) {
			return next
		}
	}
}

func (s *ForumService) syncQuestionQIDGenerator() error {
	var maxQID int64
	if err := s.db.Model(&database.Question{}).Where("q_id <= ?", maxSafeQuestionQID).Select("COALESCE(MAX(q_id), 0)").Scan(&maxQID).Error; err != nil {
		return fmt.Errorf("query max safe question qid failed: %w", err)
	}
	if maxQID > lastGeneratedQuestionQID.Load() {
		lastGeneratedQuestionQID.Store(maxQID)
	}
	return nil
}

func (s *ForumService) normalizeUnsafeQuestionQIDs() error {
	var questions []database.Question
	if err := s.db.Select("id", "q_id").Where("q_id > ?", maxSafeQuestionQID).Order("id asc").Find(&questions).Error; err != nil {
		return fmt.Errorf("query unsafe question qids failed: %w", err)
	}

	for _, question := range questions {
		newQID := nextQuestionQID(time.Now())
		if err := s.db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Model(&database.Question{}).Where("id = ?", question.ID).Update("q_id", newQID).Error; err != nil {
				return fmt.Errorf("update question qid failed: %w", err)
			}
			for _, model := range []any{&database.QuestionFile{}, &database.Comment{}, &database.QuestionLike{}} {
				if err := tx.Model(model).Where("question_id = ?", question.ID).Update("q_id", newQID).Error; err != nil {
					return fmt.Errorf("update related qid failed: %w", err)
				}
			}
			return nil
		}); err != nil {
			return err
		}
	}

	return nil
}

func buildAvatarFileName(username, original string) string {
	ext := strings.ToLower(filepath.Ext(filepath.Base(original)))
	if ext == "" {
		ext = ".jpg"
	}
	return username + ext
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func validateForumContent(text string, limit int) (string, error) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return "", ErrInvalidContent
	}
	if len([]rune(trimmed)) > limit {
		return "", ErrContentTooLong
	}
	return trimmed, nil
}

func validateUploadedFile(file *multipart.FileHeader, allowedExtensions map[string]struct{}, maxSize int64) error {
	name := filepath.Base(strings.TrimSpace(file.Filename))
	ext := strings.ToLower(filepath.Ext(name))
	if _, ok := allowedExtensions[ext]; !ok {
		return ErrUnsupportedFile
	}
	if file.Size > maxSize {
		return ErrFileTooLarge
	}
	return nil
}

func saveMultipartFile(file *multipart.FileHeader, target string) error {
	src, err := file.Open()
	if err != nil {
		return fmt.Errorf("open upload file failed: %w", err)
	}
	defer src.Close()

	dst, err := os.Create(target)
	if err != nil {
		return fmt.Errorf("create upload file failed: %w", err)
	}
	defer dst.Close()

	if _, err := dst.ReadFrom(src); err != nil {
		return fmt.Errorf("save upload file failed: %w", err)
	}
	return nil
}

func (s *ForumService) ensureDefaultAvatar() error {
	target := filepath.Join(s.storage.ImageRoot(), "userImgDefault.png")
	if _, err := os.Stat(target); err == nil {
		return nil
	}

	source := filepath.Join("example", "res", "img", "userImgDefault.png")
	src, err := os.Open(source)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("open default avatar failed: %w", err)
	}
	defer src.Close()

	dst, err := os.Create(target)
	if err != nil {
		return fmt.Errorf("create default avatar failed: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return fmt.Errorf("copy default avatar failed: %w", err)
	}
	return nil
}
