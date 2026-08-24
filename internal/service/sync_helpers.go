package service

import (
	"regexp"
	"strings"
	"time"
)

type MarketSyncSummary struct {
	TargetCount   int       `json:"targetCount"`
	SuccessCount  int       `json:"successCount"`
	FailedSymbols []string  `json:"failedSymbols"`
	FailedDetails []string  `json:"failedDetails"`
	FetchedAt     time.Time `json:"fetchedAt"`
	Partial       bool      `json:"partial"`
}

var (
	tagPattern   = regexp.MustCompile(`(?s)<[^>]+>`)
	spacePattern = regexp.MustCompile(`\s+`)
)

func cleanHTMLText(value string) string {
	value = strings.ReplaceAll(value, "&nbsp;", " ")
	value = strings.ReplaceAll(value, "&amp;", "&")
	value = strings.ReplaceAll(value, "&#x27;", "'")
	value = strings.ReplaceAll(value, "&#39;", "'")
	value = strings.ReplaceAll(value, "&quot;", `"`)
	value = tagPattern.ReplaceAllString(value, " ")
	value = spacePattern.ReplaceAllString(value, " ")
	return strings.TrimSpace(value)
}

func truncateString(value string, limit int) string {
	if limit <= 0 {
		return value
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
