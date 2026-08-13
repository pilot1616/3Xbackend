package handler

import (
	"3Xbackend/internal/middleware"
	"3Xbackend/internal/service"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type AgentHandler struct {
	authService *service.AuthService
	baseURL     string
	client      *http.Client
}

type agentChatRequest struct {
	ConversationID string         `json:"conversation_id,omitempty"`
	Message        string         `json:"message" binding:"required,max=4000"`
	Context        map[string]any `json:"context,omitempty"`
}

type agentPromptRequest struct {
	Prompt  string         `json:"prompt" binding:"required,max=4000"`
	Context map[string]any `json:"context,omitempty"`
	DBScope string         `json:"db_scope,omitempty"`
}

type agentUser struct {
	ID       uint   `json:"id"`
	Username string `json:"username"`
}

type agentChatProxyRequest struct {
	ConversationID string         `json:"conversation_id,omitempty"`
	Message        string         `json:"message"`
	Context        map[string]any `json:"context"`
	User           agentUser      `json:"user"`
}

func NewAgentHandler(authService *service.AuthService) *AgentHandler {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("AGENT_BASE_URL")), "/")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8010"
	}
	return &AgentHandler{
		authService: authService,
		baseURL:     baseURL,
		client:      &http.Client{Timeout: 90 * time.Second},
	}
}

func (h *AgentHandler) ListConversations(c *gin.Context) {
	user, ok := h.currentUser(c)
	if !ok {
		return
	}
	h.proxy(c, http.MethodGet, "/conversations?user_id="+strconv.FormatUint(uint64(user.ID), 10), nil)
}

func (h *AgentHandler) ListMessages(c *gin.Context) {
	user, ok := h.currentUser(c)
	if !ok {
		return
	}
	conversationID := strings.TrimSpace(c.Param("conversationID"))
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "conversation_id is required"})
		return
	}
	h.proxy(c, http.MethodGet, "/conversations/"+url.PathEscape(conversationID)+"/messages?user_id="+strconv.FormatUint(uint64(user.ID), 10), nil)
}

func (h *AgentHandler) Chat(c *gin.Context) {
	user, ok := h.currentUser(c)
	if !ok {
		return
	}

	var req agentChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "message is required"})
		return
	}
	if req.Context == nil {
		req.Context = map[string]any{}
	}
	req.Context["source"] = "analysis-page-chat"

	payload := agentChatProxyRequest{
		ConversationID: strings.TrimSpace(req.ConversationID),
		Message:        req.Message,
		Context:        req.Context,
		User: agentUser{
			ID:       user.ID,
			Username: user.Username,
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "encode agent request failed"})
		return
	}
	h.proxy(c, http.MethodPost, "/chat", body)
}

func (h *AgentHandler) Prompt(c *gin.Context) {
	var req agentPromptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Prompt == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "prompt is required"})
		return
	}
	if req.Context == nil {
		req.Context = map[string]any{}
	}
	if _, exists := req.Context["source"]; !exists {
		req.Context["source"] = "analysis-page"
	}

	body, err := json.Marshal(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "encode agent request failed"})
		return
	}
	h.proxy(c, http.MethodPost, "/prompt", body)
}

func (h *AgentHandler) currentUser(c *gin.Context) (*service.UserResponse, bool) {
	userIDValue, exists := c.Get(middleware.ContextUserIDKey)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "unauthorized"})
		return nil, false
	}
	userID, ok := userIDValue.(uint)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "unauthorized"})
		return nil, false
	}
	user, err := h.authService.Me(userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "unauthorized"})
		return nil, false
	}
	return user, true
}

func (h *AgentHandler) proxy(c *gin.Context, method string, path string, body []byte) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), method, h.baseURL+path, reader)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "create agent request failed"})
		return
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := h.client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"message": "agent service unavailable"})
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"message": "read agent response failed"})
		return
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json"
	}
	c.Data(resp.StatusCode, contentType, respBody)
}
