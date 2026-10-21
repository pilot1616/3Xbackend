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
	authService   *service.AuthService
	baseURL       string
	internalToken string
	client        *http.Client
}

type agentChatRequest struct {
	ConversationID string         `json:"conversation_id,omitempty"`
	Message        string         `json:"message" binding:"required,max=4000"`
	Context        map[string]any `json:"context,omitempty"`
}

type agentPromptProxyRequest struct {
	Prompt  string         `json:"prompt"`
	Context map[string]any `json:"context"`
	DBScope string         `json:"db_scope,omitempty"`
	User    agentUser      `json:"user"`
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
	// 不设整体 Timeout：SSE 流式响应按块持续到达，整体计时会切断长回答。
	// 首字节 30s 兜底连不上的 agent；chunk 间隔交给 upstream 的读超时。
	transport := &http.Transport{
		ResponseHeaderTimeout: 30 * time.Second,
		IdleConnTimeout:       90 * time.Second,
	}
	return &AgentHandler{
		authService:   authService,
		baseURL:       baseURL,
		internalToken: strings.TrimSpace(os.Getenv("AGENT_INTERNAL_TOKEN")),
		client:        &http.Client{Transport: transport},
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
	h.proxy(c, http.MethodPost, "/chat/stream", body)
}

func (h *AgentHandler) Prompt(c *gin.Context) {
	user, ok := h.currentUser(c)
	if !ok {
		return
	}

	var req agentPromptProxyRequest
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
	req.User = agentUser{
		ID:       user.ID,
		Username: user.Username,
	}

	body, err := json.Marshal(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "encode agent request failed"})
		return
	}
	h.proxy(c, http.MethodPost, "/prompt", body)
}

// AgentLogs proxies read-only LLM log queries to the agent service.
// Mounted behind authGuard + adminGuard: only admins may audit LLM traffic.
func (h *AgentHandler) AgentLogs(c *gin.Context) {
	runID := strings.TrimSpace(c.Param("runID"))
	path := "/logs/stats"
	switch {
	case runID != "":
		path = "/logs/runs/" + url.PathEscape(runID)
	case c.Query("view") == "stats":
		path = "/logs/stats"
	default:
		path = "/logs/runs"
	}

	query := url.Values{}
	if view := c.Query("view"); view != "" {
		query.Set("view", view)
	}
	for _, key := range []string{"limit", "status", "search", "since_hours"} {
		if value := c.Query(key); value != "" {
			query.Set(key, value)
		}
	}
	if encoded := query.Encode(); encoded != "" {
		path += "?" + encoded
	}
	h.proxy(c, http.MethodGet, path, nil)
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
	if h.internalToken != "" {
		req.Header.Set("X-Agent-Token", h.internalToken)
	}

	resp, err := h.client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"message": "agent service unavailable"})
		return
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json"
	}

	// SSE 流式响应：逐块透传，不做整体缓冲；总时长不再受 client.Timeout 限制。
	if resp.StatusCode == http.StatusOK && strings.HasPrefix(contentType, "text/event-stream") {
		c.Writer.Header().Set("Content-Type", "text/event-stream")
		c.Writer.Header().Set("Cache-Control", "no-cache")
		c.Writer.Header().Set("X-Accel-Buffering", "no")
		c.Writer.WriteHeader(http.StatusOK)
		flusher, ok := c.Writer.(http.Flusher)
		buffer := make([]byte, 4096)
		for {
			n, readErr := resp.Body.Read(buffer)
			if n > 0 {
				if _, writeErr := c.Writer.Write(buffer[:n]); writeErr != nil {
					return // 客户端断开
				}
				if ok {
					flusher.Flush()
				}
			}
			if readErr != nil {
				return // EOF 或上游断开
			}
		}
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"message": "read agent response failed"})
		return
	}

	c.Data(resp.StatusCode, contentType, respBody)
}
