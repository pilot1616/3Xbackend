package handler

import (
	"3Xbackend/internal/middleware"
	"3Xbackend/internal/service"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

type ForumHandler struct {
	forumService *service.ForumService
}

type QuestionUploadRequest struct {
	QID      int64    `json:"qid"`
	IsUpload bool     `json:"isUpload"`
	User     string   `json:"user"`
	NickName string   `json:"nickName"`
	Text     string   `json:"text"`
	Files    []string `json:"files"`
	ImgName  []string `json:"imgName"`
}

type CommentUploadRequest struct {
	QID      int64  `json:"qid"`
	User     string `json:"user"`
	NickName string `json:"nickName"`
	Text     string `json:"text"`
}

type LikeUploadRequest struct {
	QID      int64  `json:"qid"`
	User     string `json:"user"`
	NickName string `json:"nickName"`
}

type ControlUploadRequest struct {
	QID  int64  `json:"qid"`
	User string `json:"user"`
}

type UpdateQuestionRequest struct {
	NickName string   `json:"nickName"`
	Text     string   `json:"text"`
	IsUpload *bool    `json:"isUpload,omitempty"`
	Files    []string `json:"files,omitempty"`
	ImgName  []string `json:"imgName,omitempty"`
}

type CreateCommentRequest struct {
	Text string `json:"text" binding:"required"`
}

type UpdateCommentRequest struct {
	Text string `json:"text" binding:"required"`
}

func NewForumHandler(forumService *service.ForumService) *ForumHandler {
	return &ForumHandler{forumService: forumService}
}

func (h *ForumHandler) QuestionRequest(c *gin.Context) {
	result, err := h.forumService.ListQuestions()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "query questions failed"})
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) ListQuestionsPaginated(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	author := c.Query("author")
	keyword := c.Query("keyword")
	sort := c.Query("sort")

	var isUpload *bool
	if raw := strings.TrimSpace(c.Query("is_upload")); raw != "" {
		value := raw == "1" || strings.EqualFold(raw, "true")
		isUpload = &value
	}

	result, err := h.forumService.ListQuestionsPaged(service.QuestionListInput{
		Page:     page,
		PageSize: pageSize,
		Author:   author,
		Keyword:  keyword,
		Sort:     sort,
		IsUpload: isUpload,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "query questions failed"})
		return
	}
	if err := h.decorateQuestionListForCurrentUser(c, result); err != nil {
		h.handleForumError(c, err, "decorate questions failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) ListMyQuestions(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	keyword := c.Query("keyword")
	sort := c.Query("sort")

	var isUpload *bool
	if raw := strings.TrimSpace(c.Query("is_upload")); raw != "" {
		value := raw == "1" || strings.EqualFold(raw, "true")
		isUpload = &value
	}

	result, err := h.forumService.ListMyQuestions(userID, user.Username, page, pageSize, keyword, sort, isUpload)
	if err != nil {
		h.handleForumError(c, err, "query my questions failed")
		return
	}
	if err := h.forumService.DecorateQuestionRecordsForUser(questionRecordPointers(result.Records), userID, user.Username); err != nil {
		h.handleForumError(c, err, "decorate my questions failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) ListMyComments(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	keyword := c.Query("keyword")

	result, err := h.forumService.ListMyComments(userID, user.Username, page, pageSize, keyword)
	if err != nil {
		h.handleForumError(c, err, "query my comments failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) ListMyLikes(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	keyword := c.Query("keyword")

	result, err := h.forumService.ListMyLikes(userID, user.Username, page, pageSize, keyword)
	if err != nil {
		h.handleForumError(c, err, "query my likes failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) GetMySummary(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	result, err := h.forumService.GetMySummary(userID, user.Username)
	if err != nil {
		h.handleForumError(c, err, "query my summary failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) ListCommentsPaginated(c *gin.Context) {
	qid, err := strconv.ParseInt(c.Param("qid"), 10, 64)
	if err != nil || qid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid qid"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	result, err := h.forumService.ListCommentsPaged(service.CommentListInput{
		QID:      qid,
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		h.handleForumError(c, err, "query comments failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) ListLikesPaginated(c *gin.Context) {
	qid, err := strconv.ParseInt(c.Param("qid"), 10, 64)
	if err != nil || qid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid qid"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	result, err := h.forumService.ListLikesPaged(qid, page, pageSize)
	if err != nil {
		h.handleForumError(c, err, "query likes failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) GetQuestion(c *gin.Context) {
	qid, err := strconv.ParseInt(c.Param("qid"), 10, 64)
	if err != nil || qid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid qid"})
		return
	}

	result, err := h.forumService.GetQuestion(qid)
	if err != nil {
		h.handleForumError(c, err, "query question failed")
		return
	}
	if err := h.decorateQuestionRecordForCurrentUser(c, result); err != nil {
		h.handleForumError(c, err, "decorate question failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) QuestionUpload(c *gin.Context) {
	var req QuestionUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	result, err := h.forumService.CreateQuestion(service.QuestionCreateInput{
		QID:      req.QID,
		Username: req.User,
		Nickname: req.NickName,
		Text:     req.Text,
		IsUpload: req.IsUpload,
		Files:    req.Files,
		ImgName:  req.ImgName,
	})
	if err != nil {
		h.handleForumError(c, err, "create question failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) CommentUpload(c *gin.Context) {
	var req CommentUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	result, err := h.forumService.AddComment(service.CommentCreateInput{
		QID:      req.QID,
		Username: req.User,
		Nickname: req.NickName,
		Text:     req.Text,
	})
	if err != nil {
		h.handleForumError(c, err, "create comment failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) LikeUpload(c *gin.Context) {
	var req LikeUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	result, err := h.forumService.AddLike(service.LikeCreateInput{
		QID:      req.QID,
		Username: req.User,
		Nickname: req.NickName,
	})
	if err != nil {
		h.handleForumError(c, err, "create like failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) ControlUpload(c *gin.Context) {
	var req ControlUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	result, err := h.forumService.ToggleQuestionUpload(req.QID)
	if strings.TrimSpace(req.User) != "" {
		result, err = h.forumService.ToggleQuestionUploadOwned(req.QID, 0, req.User)
	}
	if err != nil {
		h.handleForumError(c, err, "toggle upload failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) DeleteUpload(c *gin.Context) {
	var req ControlUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	result, err := h.forumService.DeleteQuestion(req.QID)
	if strings.TrimSpace(req.User) != "" {
		result, err = h.forumService.DeleteQuestionOwned(req.QID, 0, req.User)
	}
	if err != nil {
		h.handleForumError(c, err, "delete question failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) QuestionFileUpload(c *gin.Context) {
	qid, err := strconv.ParseInt(c.PostForm("qid"), 10, 64)
	if err != nil || qid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid qid"})
		return
	}

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid multipart form"})
		return
	}

	files := form.File["file"]
	result, err := h.forumService.SaveQuestionFiles(qid, files)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "save question files failed"})
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) FileUpload(c *gin.Context) {
	file, err := c.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "image file is required"})
		return
	}

	result, err := h.forumService.SaveProfileImage(file, c.PostForm("username"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "save image failed"})
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) UploadMyAvatar(c *gin.Context) {
	userID, _, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	file, err := c.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "image file is required"})
		return
	}

	result, err := h.forumService.SaveProfileImageOwned(file, userID)
	if err != nil {
		h.handleForumError(c, err, "save avatar failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) ImageInfo(c *gin.Context) {
	result := h.forumService.GetImageInfo(c.Param("filename"))
	if c.Query("callback") != "" {
		c.JSONP(http.StatusOK, result)
		return
	}
	status := http.StatusOK
	if result.Status == 404 {
		status = http.StatusNotFound
	}
	c.JSON(status, result)
}

func (h *ForumHandler) CreateQuestionAuthenticated(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	var req UpdateQuestionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	result, err := h.forumService.CreateQuestion(service.QuestionCreateInput{
		UserID:   userID,
		Username: user.Username,
		Nickname: req.NickName,
		Text:     req.Text,
		IsUpload: true,
		Files:    req.Files,
		ImgName:  req.ImgName,
	})
	if err != nil {
		h.handleForumError(c, err, "create question failed")
		return
	}
	if err := h.forumService.DecorateQuestionRecordForUser(result, userID, user.Username); err != nil {
		h.handleForumError(c, err, "decorate question failed")
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *ForumHandler) UpdateQuestionAuthenticated(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	qid, err := strconv.ParseInt(c.Param("qid"), 10, 64)
	if err != nil || qid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid qid"})
		return
	}

	var req UpdateQuestionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	result, err := h.forumService.UpdateQuestion(service.QuestionUpdateInput{
		QID:      qid,
		UserID:   userID,
		Username: user.Username,
		Nickname: req.NickName,
		Text:     req.Text,
		IsUpload: req.IsUpload,
		Files:    req.Files,
		ImgName:  req.ImgName,
	})
	if err != nil {
		h.handleForumError(c, err, "update question failed")
		return
	}
	if err := h.forumService.DecorateQuestionRecordForUser(result, userID, user.Username); err != nil {
		h.handleForumError(c, err, "decorate question failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) DeleteQuestionAuthenticated(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	qid, err := strconv.ParseInt(c.Param("qid"), 10, 64)
	if err != nil || qid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid qid"})
		return
	}

	result, err := h.forumService.DeleteQuestionOwned(qid, userID, user.Username)
	if err != nil {
		h.handleForumError(c, err, "delete question failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) ToggleQuestionUploadAuthenticated(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	qid, err := strconv.ParseInt(c.Param("qid"), 10, 64)
	if err != nil || qid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid qid"})
		return
	}

	result, err := h.forumService.ToggleQuestionUploadOwned(qid, userID, user.Username)
	if err != nil {
		h.handleForumError(c, err, "toggle upload failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) UploadQuestionFilesAuthenticated(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	qid, err := strconv.ParseInt(c.Param("qid"), 10, 64)
	if err != nil || qid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid qid"})
		return
	}

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid multipart form"})
		return
	}

	files := form.File["files"]
	if len(files) == 0 {
		files = form.File["file"]
	}
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "at least one file is required"})
		return
	}

	result, err := h.forumService.SaveQuestionFilesOwned(qid, userID, user.Username, files)
	if err != nil {
		h.handleForumError(c, err, "save question files failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) DeleteQuestionFileAuthenticated(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	qid, err := strconv.ParseInt(c.Param("qid"), 10, 64)
	if err != nil || qid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid qid"})
		return
	}

	fileName := c.Param("filename")
	if strings.TrimSpace(fileName) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid filename"})
		return
	}

	result, err := h.forumService.DeleteQuestionFileOwned(qid, fileName, userID, user.Username)
	if err != nil {
		h.handleForumError(c, err, "delete question file failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) CreateCommentAuthenticated(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	qid, err := strconv.ParseInt(c.Param("qid"), 10, 64)
	if err != nil || qid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid qid"})
		return
	}

	var req CreateCommentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	result, err := h.forumService.AddCommentOwned(qid, userID, user.Username, req.Text)
	if err != nil {
		h.handleForumError(c, err, "create comment failed")
		return
	}
	if err := h.forumService.DecorateQuestionRecordForUser(result, userID, user.Username); err != nil {
		h.handleForumError(c, err, "decorate question failed")
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *ForumHandler) DeleteCommentAuthenticated(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	qid, err := strconv.ParseInt(c.Param("qid"), 10, 64)
	if err != nil || qid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid qid"})
		return
	}

	commentID, err := strconv.ParseUint(c.Param("commentID"), 10, 64)
	if err != nil || commentID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid comment id"})
		return
	}

	result, err := h.forumService.DeleteCommentOwned(qid, uint(commentID), userID, user.Username)
	if err != nil {
		h.handleForumError(c, err, "delete comment failed")
		return
	}
	if err := h.forumService.DecorateQuestionRecordForUser(result, userID, user.Username); err != nil {
		h.handleForumError(c, err, "decorate question failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) UpdateCommentAuthenticated(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	qid, err := strconv.ParseInt(c.Param("qid"), 10, 64)
	if err != nil || qid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid qid"})
		return
	}

	commentID, err := strconv.ParseUint(c.Param("commentID"), 10, 64)
	if err != nil || commentID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid comment id"})
		return
	}

	var req UpdateCommentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	result, err := h.forumService.UpdateCommentOwned(qid, uint(commentID), userID, user.Username, req.Text)
	if err != nil {
		h.handleForumError(c, err, "update comment failed")
		return
	}
	if err := h.forumService.DecorateQuestionRecordForUser(result, userID, user.Username); err != nil {
		h.handleForumError(c, err, "decorate question failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) LikeQuestionAuthenticated(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	qid, err := strconv.ParseInt(c.Param("qid"), 10, 64)
	if err != nil || qid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid qid"})
		return
	}

	result, err := h.forumService.AddLikeOwned(qid, userID, user.Username)
	if err != nil {
		h.handleForumError(c, err, "create like failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) UnlikeQuestionAuthenticated(c *gin.Context) {
	userID, user, ok := h.getCurrentUser(c)
	if !ok {
		return
	}

	qid, err := strconv.ParseInt(c.Param("qid"), 10, 64)
	if err != nil || qid == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid qid"})
		return
	}

	result, err := h.forumService.RemoveLikeOwned(qid, userID, user.Username)
	if err != nil {
		h.handleForumError(c, err, "delete like failed")
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *ForumHandler) getCurrentUser(c *gin.Context) (uint, *service.UserResponse, bool) {
	userIDValue, exists := c.Get(middleware.ContextUserIDKey)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "unauthorized"})
		return 0, nil, false
	}
	userID, ok := userIDValue.(uint)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "unauthorized"})
		return 0, nil, false
	}
	user, err := h.forumService.FindUserByID(userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "unauthorized"})
		return 0, nil, false
	}
	return userID, &service.UserResponse{Username: user.Username}, true
}

func (h *ForumHandler) decorateQuestionListForCurrentUser(c *gin.Context, result *service.QuestionListPage) error {
	if result == nil {
		return nil
	}
	userID, username, err := h.getCurrentViewer(c)
	if err != nil {
		return err
	}
	return h.forumService.DecorateQuestionRecordsForUser(questionRecordPointers(result.Records), userID, username)
}

func (h *ForumHandler) decorateQuestionRecordForCurrentUser(c *gin.Context, record *service.LegacyQuestionRecord) error {
	userID, username, err := h.getCurrentViewer(c)
	if err != nil {
		return err
	}
	return h.forumService.DecorateQuestionRecordForUser(record, userID, username)
}

func (h *ForumHandler) getCurrentViewer(c *gin.Context) (uint, string, error) {
	userIDValue, exists := c.Get(middleware.ContextUserIDKey)
	if !exists {
		return 0, "", nil
	}
	userID, ok := userIDValue.(uint)
	if !ok {
		return 0, "", nil
	}
	user, err := h.forumService.FindUserByID(userID)
	if err != nil {
		return 0, "", err
	}
	return userID, user.Username, nil
}

func questionRecordPointers(records []service.LegacyQuestionRecord) []*service.LegacyQuestionRecord {
	pointers := make([]*service.LegacyQuestionRecord, 0, len(records))
	for i := range records {
		pointers = append(pointers, &records[i])
	}
	return pointers
}

func (h *ForumHandler) handleForumError(c *gin.Context, err error, fallback string) {
	switch {
	case errors.Is(err, service.ErrQuestionNotFound):
		c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
	case errors.Is(err, service.ErrQuestionFileNotFound):
		c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
	case errors.Is(err, service.ErrCommentNotFound):
		c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
	case errors.Is(err, service.ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"message": err.Error()})
	case errors.Is(err, service.ErrInvalidContent), errors.Is(err, service.ErrContentTooLong), errors.Is(err, service.ErrUnsupportedFile), errors.Is(err, service.ErrFileTooLarge):
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
	case errors.Is(err, service.ErrInvalidUsername):
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"message": fallback})
	}
}
