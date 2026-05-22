package handler

import (
	"3Xbackend/internal/service"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

type AnalysisHandler struct {
	analysisService *service.AnalysisService
}

func NewAnalysisHandler(analysisService *service.AnalysisService) *AnalysisHandler {
	return &AnalysisHandler{analysisService: analysisService}
}

func (h *AnalysisHandler) GetAITrend(c *gin.Context) {
	window, ok := h.parseWindow(c)
	if !ok {
		return
	}

	result, err := h.analysisService.AnalyzeAITrend(window)
	if err != nil {
		h.writeAnalysisError(c, err)
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *AnalysisHandler) GetMarketTrend(c *gin.Context) {
	window, ok := h.parseWindow(c)
	if !ok {
		return
	}

	result, err := h.analysisService.AnalyzeMarketTrend(window)
	if err != nil {
		h.writeAnalysisError(c, err)
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *AnalysisHandler) GetOverview(c *gin.Context) {
	window, ok := h.parseWindow(c)
	if !ok {
		return
	}

	result, err := h.analysisService.AnalyzeOverview(window)
	if err != nil {
		h.writeAnalysisError(c, err)
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *AnalysisHandler) parseWindow(c *gin.Context) (service.AnalysisWindow, bool) {
	window, err := service.ParseAnalysisWindow(c.Query("window"))
	if err != nil {
		h.writeAnalysisError(c, err)
		return "", false
	}
	return window, true
}

func (h *AnalysisHandler) writeAnalysisError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrInvalidAnalysisWindow):
		c.JSON(http.StatusBadRequest, gin.H{
			"message": service.ErrInvalidAnalysisWindow.Error(),
			"code":    "INVALID_ANALYSIS_WINDOW",
		})
	case errors.Is(err, service.ErrInsufficientAIDailyData):
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"message": service.ErrInsufficientAIDailyData.Error(),
			"code":    "INSUFFICIENT_AI_DAILY_DATA",
		})
	case errors.Is(err, service.ErrInsufficientMarketHistory):
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"message": service.ErrInsufficientMarketHistory.Error(),
			"code":    "INSUFFICIENT_MARKET_HISTORY",
		})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{
			"message": service.ErrAnalysisComputationFailed.Error(),
			"code":    "ANALYSIS_COMPUTATION_FAILED",
		})
	}
}
