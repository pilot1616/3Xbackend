package handler

import (
	"3Xbackend/internal/service"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type AdminHandler struct {
	aiDailySyncService *service.AIDailySyncService
	dataFetchBaseURL   string
	client             *http.Client
}

func NewAdminHandler(aiDailySyncService *service.AIDailySyncService) *AdminHandler {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("DATA_FETCH_BASE_URL")), "/")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8020"
	}
	return &AdminHandler{
		aiDailySyncService: aiDailySyncService,
		dataFetchBaseURL:   baseURL,
		client:             &http.Client{Timeout: 30 * time.Minute},
	}
}

func (h *AdminHandler) SyncFullHistory(c *gin.Context) {
	financialHistory, err := h.callDataFetch(c.Request.Context(), "/sync/history")
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"message": "sync financial history failed", "detail": err.Error()})
		return
	}

	if h.aiDailySyncService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"message": "ai daily sync service unavailable", "financialHistory": financialHistory})
		return
	}

	maxEntries := parsePositiveInt(c.DefaultQuery("ai_daily_max_entries", "10000"), 10000)
	aiDailyResult, err := h.aiDailySyncService.SyncArchiveWithResult(context.Background(), maxEntries)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"message": "sync ai daily archive failed", "financialHistory": financialHistory, "detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":          "full historical sync completed",
		"financialHistory": financialHistory,
		"aiDailyArchive":   aiDailyResult,
	})
}

func (h *AdminHandler) SyncFinancialLatest(c *gin.Context) {
	financialLatest, err := h.callDataFetch(c.Request.Context(), "/sync/latest")
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"message": "sync financial latest failed", "detail": err.Error()})
		return
	}

	successCount := intFromAny(financialLatest["preciousMetals"]) + intFromAny(financialLatest["techMarkets"])
	if strings.Contains(c.FullPath(), "precious-metals") {
		successCount = intFromAny(financialLatest["preciousMetals"])
	}
	if strings.Contains(c.FullPath(), "ai-tech") {
		successCount = intFromAny(financialLatest["techMarkets"])
	}
	failures := stringSliceFromAny(financialLatest["failures"])
	c.JSON(http.StatusOK, gin.H{
		"message":         "financial latest sync completed",
		"financialLatest": financialLatest,
		"targetCount":     successCount,
		"successCount":    successCount,
		"failedSymbols":   []string{},
		"failedDetails":   failures,
		"fetchedAt":       financialLatest["fetchedAt"],
		"partial":         len(failures) > 0,
	})
}

func (h *AdminHandler) callDataFetch(ctx context.Context, path string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.dataFetchBaseURL+path, bytes.NewReader(nil))
	if err != nil {
		return nil, fmt.Errorf("create data-fetch request failed: %w", err)
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("data-fetch unavailable: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read data-fetch response failed: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("data-fetch returned %d: %s", resp.StatusCode, string(body))
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode data-fetch response failed: %w", err)
	}
	return payload, nil
}

func parsePositiveInt(raw string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	default:
		return 0
	}
}

func stringSliceFromAny(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return []string{}
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
			result = append(result, text)
		}
	}
	return result
}
