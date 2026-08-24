package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestParsePositiveInt(t *testing.T) {
	tests := []struct {
		name     string
		raw      string
		fallback int
		want     int
	}{
		{name: "valid", raw: "42", fallback: 7, want: 42},
		{name: "trims spaces", raw: " 12 ", fallback: 7, want: 12},
		{name: "zero fallback", raw: "0", fallback: 7, want: 7},
		{name: "negative fallback", raw: "-1", fallback: 7, want: 7},
		{name: "invalid fallback", raw: "abc", fallback: 7, want: 7},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parsePositiveInt(tt.raw, tt.fallback); got != tt.want {
				t.Fatalf("expected %d, got %d", tt.want, got)
			}
		})
	}
}

func TestAdminHandlerSyncFullHistoryDataFetchFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewAdminHandler(nil)
	handler.dataFetchBaseURL = "http://data-fetch.test"
	handler.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusInternalServerError,
			Body:       io.NopCloser(bytes.NewBufferString("boom")),
			Header:     make(http.Header),
		}, nil
	})}

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/sync/full-history", nil)

	handler.SyncFullHistory(ctx)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected status %d, got %d", http.StatusBadGateway, rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if body["message"] != "sync financial history failed" {
		t.Fatalf("unexpected message: %v", body["message"])
	}
}

func TestAdminHandlerSyncFullHistoryRequiresAIDailyService(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewAdminHandler(nil)
	handler.dataFetchBaseURL = "http://data-fetch.test"
	handler.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/sync/history" {
			t.Fatalf("unexpected path %s", req.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(`{"mode":"history","historyStartYear":2018,"preciousMetals":1,"preciousMetalsTotal":1,"techMarkets":2,"techMarketsTotal":2,"failures":[],"fetchedAt":"2026-08-24T10:00:00+08:00"}`)),
			Header:     make(http.Header),
		}, nil
	})}

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/sync/full-history", nil)

	handler.SyncFullHistory(ctx)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d", http.StatusServiceUnavailable, rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if body["message"] != "ai daily sync service unavailable" {
		t.Fatalf("unexpected message: %v", body["message"])
	}
	if _, ok := body["financialHistory"].(map[string]any); !ok {
		t.Fatalf("expected financialHistory in response, got %+v", body)
	}
}
