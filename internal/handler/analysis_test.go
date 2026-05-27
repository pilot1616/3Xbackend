package handler

import (
	"3Xbackend/internal/service"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

type analysisErrorBody struct {
	Message string `json:"message"`
	Code    string `json:"code"`
}

func TestAnalysisHandlerWriteAnalysisError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewAnalysisHandler(nil)
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "invalid window", err: service.ErrInvalidAnalysisWindow, wantStatus: http.StatusBadRequest, wantCode: "INVALID_ANALYSIS_WINDOW"},
		{name: "insufficient ai", err: service.ErrInsufficientAIDailyData, wantStatus: http.StatusUnprocessableEntity, wantCode: "INSUFFICIENT_AI_DAILY_DATA"},
		{name: "insufficient market", err: service.ErrInsufficientMarketHistory, wantStatus: http.StatusUnprocessableEntity, wantCode: "INSUFFICIENT_MARKET_HISTORY"},
		{name: "generic", err: service.ErrAnalysisComputationFailed, wantStatus: http.StatusInternalServerError, wantCode: "ANALYSIS_COMPUTATION_FAILED"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(rec)

			handler.writeAnalysisError(ctx, tt.err)

			if rec.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d", tt.wantStatus, rec.Code)
			}

			var body analysisErrorBody
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("unmarshal response: %v", err)
			}
			if body.Code != tt.wantCode {
				t.Fatalf("expected code %q, got %q", tt.wantCode, body.Code)
			}
		})
	}
}

func TestAnalysisHandlerParseWindow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewAnalysisHandler(nil)

	t.Run("default window", func(t *testing.T) {
		rec := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(rec)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/analysis/overview", nil)

		window, ok := handler.parseWindow(ctx)
		if !ok {
			t.Fatalf("expected parse success")
		}
		if window != service.AnalysisWindow7D {
			t.Fatalf("expected default window %q, got %q", service.AnalysisWindow7D, window)
		}
	})

	t.Run("invalid window", func(t *testing.T) {
		rec := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(rec)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/analysis/overview?window=2d", nil)

		_, ok := handler.parseWindow(ctx)
		if ok {
			t.Fatalf("expected parse failure")
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected status %d, got %d", http.StatusBadRequest, rec.Code)
		}

		var body analysisErrorBody
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if body.Code != "INVALID_ANALYSIS_WINDOW" {
			t.Fatalf("expected invalid window code, got %q", body.Code)
		}
	})
}
