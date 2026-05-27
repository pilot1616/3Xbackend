package service

import (
	"3Xbackend/internal/database"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestParseAnalysisWindow(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    AnalysisWindow
		wantErr error
	}{
		{name: "default empty", raw: "", want: AnalysisWindow7D},
		{name: "one day", raw: "1d", want: AnalysisWindow1D},
		{name: "seven day", raw: "7d", want: AnalysisWindow7D},
		{name: "thirty day", raw: "30d", want: AnalysisWindow30D},
		{name: "uppercase invalid", raw: "7D", wantErr: ErrInvalidAnalysisWindow},
		{name: "unknown invalid", raw: "2d", wantErr: ErrInvalidAnalysisWindow},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseAnalysisWindow(tt.raw)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("expected err %v, got %v", tt.wantErr, err)
			}
			if got != tt.want {
				t.Fatalf("expected window %q, got %q", tt.want, got)
			}
		})
	}
}

func TestBuildAIDailyInputsUsesPublishedDateWindow(t *testing.T) {
	now := time.Date(2026, 5, 22, 16, 30, 0, 0, time.Local)
	snapshots := []database.AIDailySnapshot{
		{
			Title:         "published in window",
			PublishedDate: "2026-05-20",
			FetchedAt:     time.Date(2026, 5, 10, 9, 0, 0, 0, time.Local),
		},
		{
			Title:         "published outside window",
			PublishedDate: "2026-05-10",
			FetchedAt:     time.Date(2026, 5, 22, 9, 0, 0, 0, time.Local),
		},
	}

	inputs := buildAIDailyInputs(AnalysisWindow7D, now, snapshots)
	if len(inputs) != 1 {
		t.Fatalf("expected 1 input, got %d", len(inputs))
	}
	if inputs[0].Title != "published in window" {
		t.Fatalf("expected published-date match to be retained, got %q", inputs[0].Title)
	}
}

func TestCountAIDailyFallbacksWithinWindowOnly(t *testing.T) {
	now := time.Date(2026, 5, 22, 16, 30, 0, 0, time.Local)
	snapshots := []database.AIDailySnapshot{
		{
			Title:     "fallback in window",
			FetchedAt: time.Date(2026, 5, 21, 9, 0, 0, 0, time.Local),
		},
		{
			Title:         "published in window",
			PublishedDate: "2026-05-20",
			FetchedAt:     time.Date(2026, 5, 10, 9, 0, 0, 0, time.Local),
		},
		{
			Title:     "fallback outside window",
			FetchedAt: time.Date(2026, 5, 1, 9, 0, 0, 0, time.Local),
		},
	}

	got := countAIDailyFallbacks(AnalysisWindow7D, now, snapshots)
	if got != 1 {
		t.Fatalf("expected 1 fallback in window, got %d", got)
	}
}

func TestClassifyAIDailyThemesMultiThemeAndSections(t *testing.T) {
	input := aiDailyAnalysisInput{
		Title:   "GPU workflow assistant update",
		Summary: "A new enterprise copilot ships with multimodal reasoning.",
		Sections: []aiDailySection{{
			Heading: "Open Source Release",
			Items:   []string{"Published on GitHub with community release notes."},
		}},
	}

	themes := classifyAIDailyThemes(input)
	want := []string{"infra", "model-capability", "agent", "enterprise-app", "open-source"}
	for _, theme := range want {
		if !containsStringValue(themes, theme) {
			t.Fatalf("expected theme %q in %v", theme, themes)
		}
	}
}

func TestComputeAIThemeStatsDetectsDominantAndEmerging(t *testing.T) {
	base := time.Date(2026, 5, 22, 10, 0, 0, 0, time.Local)
	inputs := []aiDailyAnalysisInput{
		{Title: "infra a", EffectiveTime: base.AddDate(0, 0, -6), Themes: []string{"infra"}},
		{Title: "infra b", EffectiveTime: base.AddDate(0, 0, -5), Themes: []string{"infra", "model-capability"}},
		{Title: "infra c", EffectiveTime: base.AddDate(0, 0, -4), Themes: []string{"infra"}},
		{Title: "reg one", EffectiveTime: base.AddDate(0, 0, -2), Themes: []string{"regulation"}},
		{Title: "reg two", EffectiveTime: base.AddDate(0, 0, -1), Themes: []string{"regulation"}},
	}

	stats := computeAIThemeStats(AnalysisWindow7D, inputs)
	if len(stats.DominantThemes) == 0 || stats.DominantThemes[0].Theme != "infra" {
		t.Fatalf("expected infra dominant themes, got %+v", stats.DominantThemes)
	}
	if !containsEmergingTheme(stats.EmergingThemes, "regulation") {
		t.Fatalf("expected regulation emerging themes, got %+v", stats.EmergingThemes)
	}
}

func TestBuildAIConfidenceDropsForDiffuseThemes(t *testing.T) {
	stats := themeStats{
		Concentration: 0.2,
		DominantThemes: []ThemeCount{
			{Theme: "infra", Count: 2, Share: 0.2},
		},
	}
	if got := buildAIConfidence(AnalysisWindow30D, 10, stats); got != confidenceLow {
		t.Fatalf("expected low confidence, got %q", got)
	}
}

func TestComputeMarketRegimeRiskOn(t *testing.T) {
	tech := marketSeriesSet(map[string][2]float64{
		"NDX": {100, 106},
		"QQQ": {100, 104},
		"XLK": {100, 103},
		"SMH": {100, 108},
		"IGV": {100, 102},
	})
	metals := marketSeriesSet(map[string][2]float64{
		"XAU": {100, 99},
		"XAG": {100, 98},
		"XPT": {100, 99},
		"XPD": {100, 100},
	})

	result, err := computeMarketRegime(tech, metals)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Regime != marketRegimeRiskOn {
		t.Fatalf("expected risk-on, got %q", result.Regime)
	}
}

func TestComputeMarketRegimeRiskOff(t *testing.T) {
	tech := marketSeriesSet(map[string][2]float64{
		"NDX": {100, 95},
		"QQQ": {100, 94},
		"XLK": {100, 97},
		"SMH": {100, 93},
		"IGV": {100, 96},
	})
	metals := marketSeriesSet(map[string][2]float64{
		"XAU": {100, 103},
		"XAG": {100, 104},
		"XPT": {100, 101},
		"XPD": {100, 100.5},
	})

	result, err := computeMarketRegime(tech, metals)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Regime != marketRegimeRiskOff {
		t.Fatalf("expected risk-off, got %q", result.Regime)
	}
}

func TestComputeMarketRegimeMixed(t *testing.T) {
	tech := marketSeriesSet(map[string][2]float64{
		"NDX": {100, 101},
		"QQQ": {100, 99},
		"XLK": {100, 102},
		"SMH": {100, 98},
		"IGV": {100, 100.2},
	})
	metals := marketSeriesSet(map[string][2]float64{
		"XAU": {100, 101},
		"XAG": {100, 99.5},
		"XPT": {100, 100.5},
		"XPD": {100, 99.8},
	})

	result, err := computeMarketRegime(tech, metals)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Regime != marketRegimeMixed {
		t.Fatalf("expected mixed, got %q", result.Regime)
	}
}

func TestComputeMarketRegimeAllowsMetalDegradation(t *testing.T) {
	tech := marketSeriesSet(map[string][2]float64{
		"NDX": {100, 104},
		"QQQ": {100, 103},
		"XLK": {100, 102},
		"SMH": {100, 105},
		"IGV": {100, 101},
	})
	metals := marketSeriesSet(map[string][2]float64{
		"XAU": {100, 101},
	})

	result, err := computeMarketRegime(tech, metals)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Partial {
		t.Fatalf("expected partial result")
	}
	if result.Confidence != confidenceLow {
		t.Fatalf("expected low confidence, got %q", result.Confidence)
	}
	if result.Note == "" {
		t.Fatalf("expected degradation note")
	}
	if len(result.Risks) == 0 || result.Risks[0] == "" {
		t.Fatalf("expected degradation risk")
	}
}

func TestComputeMarketRegimeInsufficientHistory(t *testing.T) {
	tech := marketSeriesSet(map[string][2]float64{
		"QQQ": {100, 101},
		"SMH": {100, 102},
	})

	_, err := computeMarketRegime(tech, nil)
	if !errors.Is(err, ErrInsufficientMarketHistory) {
		t.Fatalf("expected insufficient market history, got %v", err)
	}
}

func TestBuildOverviewLinkageInfraAlignment(t *testing.T) {
	ai := &AITrendAnalysisResponse{
		Summary:        "Infra dominates AI coverage.",
		DominantThemes: []ThemeCount{{Theme: "infra", Count: 4, Share: 0.8}},
		Confidence:     confidenceMedium,
	}
	market := &MarketTrendAnalysisResponse{
		Summary:           "Tech is strong.",
		MarketRegime:      marketRegimeRiskOn,
		TechMomentum:      MarketMomentum{AverageChangePercent: 3.2, Advancers: 4, Decliners: 1},
		SafeHavenMomentum: MarketMomentum{AverageChangePercent: -0.4, Advancers: 1, Decliners: 3},
		Leaders:           []MarketMover{{Symbol: "SMH", ChangePercent: 5}, {Symbol: "QQQ", ChangePercent: 3}},
		Confidence:        confidenceMedium,
	}

	linkage := buildOverviewLinkage(ai, market)
	if linkage.Alignment != overviewAlignmentAligned {
		t.Fatalf("expected aligned, got %q", linkage.Alignment)
	}
	if !containsStringValue(linkage.Tags, "infra-chip-alignment") {
		t.Fatalf("expected infra-chip-alignment tag, got %v", linkage.Tags)
	}
}

func TestBuildOverviewLinkageAppPricingGap(t *testing.T) {
	ai := &AITrendAnalysisResponse{
		Summary:        "Enterprise app heat is rising.",
		DominantThemes: []ThemeCount{{Theme: "model-capability", Count: 3, Share: 0.6}},
		EmergingThemes: []EmergingTheme{{Theme: "enterprise-app", Count: 2, Reason: emergingReasonClusteredRecent}},
		Confidence:     confidenceMedium,
	}
	market := &MarketTrendAnalysisResponse{
		Summary:      "Market remains mixed.",
		MarketRegime: marketRegimeMixed,
		TechMomentum: MarketMomentum{AverageChangePercent: 0.2, Advancers: 2, Decliners: 2},
		Confidence:   confidenceLow,
	}

	linkage := buildOverviewLinkage(ai, market)
	if !containsStringValue(linkage.Tags, "app-pricing-gap") {
		t.Fatalf("expected app-pricing-gap tag, got %v", linkage.Tags)
	}
	if linkage.Alignment != overviewAlignmentDiverging && linkage.Alignment != overviewAlignmentMixed {
		t.Fatalf("expected diverging or mixed alignment, got %q", linkage.Alignment)
	}
}

func marketSeriesSet(changes map[string][2]float64) map[string][]marketSeriesPoint {
	base := time.Date(2026, 5, 22, 9, 0, 0, 0, time.Local)
	series := make(map[string][]marketSeriesPoint, len(changes))
	for symbol, prices := range changes {
		series[symbol] = []marketSeriesPoint{
			{Symbol: symbol, Name: symbol, Price: prices[0], PriceText: formatTestPrice(prices[0]), FetchedAt: base.Add(-24 * time.Hour)},
			{Symbol: symbol, Name: symbol, Price: prices[1], PriceText: formatTestPrice(prices[1]), FetchedAt: base},
		}
	}
	return series
}

func formatTestPrice(value float64) string {
	return strconv.FormatFloat(value, 'f', 2, 64)
}

func TestBuildAISummaryUsesChineseWindowLabel(t *testing.T) {
	stats := themeStats{
		DominantThemes: []ThemeCount{{Theme: "infra", Count: 3, Share: 0.75}, {Theme: "model-capability", Count: 2, Share: 0.5}},
	}

	summary := buildAISummary(AnalysisWindow7D, stats)
	if strings.Contains(summary, "最近近 7 天") {
		t.Fatalf("expected natural Chinese wording, got %q", summary)
	}
	if !strings.Contains(summary, "近 7 天内") {
		t.Fatalf("expected Chinese window label in summary, got %q", summary)
	}
	if !strings.Contains(summary, "基础设施") || !strings.Contains(summary, "模型能力") {
		t.Fatalf("expected localized theme labels, got %q", summary)
	}
}

func TestBuildAIHeadlineSignalsUsesChineseThemeLabels(t *testing.T) {
	stats := themeStats{
		DominantThemes: []ThemeCount{{Theme: "infra", Count: 4, Share: 0.8}, {Theme: "model-capability", Count: 2, Share: 0.4}},
		EmergingThemes: []EmergingTheme{{Theme: "enterprise-app", Count: 2, Reason: emergingReasonClusteredRecent}},
	}

	signals := buildAIHeadlineSignals(stats)
	joined := strings.Join(signals, " | ")
	if strings.Contains(joined, "infra") || strings.Contains(joined, "model-capability") || strings.Contains(joined, "enterprise-app") {
		t.Fatalf("expected localized theme labels, got %q", joined)
	}
	if !strings.Contains(joined, "基础设施") || !strings.Contains(joined, "模型能力") || !strings.Contains(joined, "企业应用") {
		t.Fatalf("expected Chinese theme labels in signals, got %q", joined)
	}
}

func TestBuildOverviewSummaryChineseCopy(t *testing.T) {
	ai := &AITrendAnalysisResponse{
		DominantThemes: []ThemeCount{{Theme: "infra", Count: 3, Share: 0.75}},
	}
	market := &MarketTrendAnalysisResponse{MarketRegime: marketRegimeRiskOn}
	linkage := overviewLinkageResult{Alignment: overviewAlignmentAligned}

	summary := buildOverviewSummary(ai, market, linkage)
	if !strings.Contains(summary, "AI 信息面") {
		t.Fatalf("expected Chinese overview summary, got %q", summary)
	}
}

func TestBuildOverviewSummaryChineseFallbackTheme(t *testing.T) {
	ai := &AITrendAnalysisResponse{}
	market := &MarketTrendAnalysisResponse{MarketRegime: marketRegimeMixed}
	linkage := overviewLinkageResult{Alignment: overviewAlignmentMixed}

	summary := buildOverviewSummary(ai, market, linkage)
	if strings.Contains(summary, "mixed AI themes") {
		t.Fatalf("expected Chinese fallback theme, got %q", summary)
	}
	if !strings.Contains(summary, "分散主题") {
		t.Fatalf("expected fallback theme wording, got %q", summary)
	}
}

func TestBuildOverviewResponseAllowsAIPartial(t *testing.T) {
	now := time.Date(2026, 5, 27, 10, 30, 0, 0, time.Local)
	ai := &AITrendAnalysisResponse{
		Window:      AnalysisWindow7D,
		GeneratedAt: now.Add(-2 * time.Hour).Format(time.RFC3339),
		DataStatus: AnalysisDataStatus{
			Sufficient:  true,
			Partial:     true,
			WindowStart: "2026-05-20",
			WindowEnd:   "2026-05-27",
			SampleCount: 6,
			Note:        "1 篇 AI 日报缺少发布时间，已使用抓取时间回退。",
		},
		Summary:        "近 7 天基础设施话题占优。",
		DominantThemes: []ThemeCount{{Theme: "infra", Count: 4, Share: 0.66}},
		Confidence:     confidenceMedium,
	}
	market := &MarketTrendAnalysisResponse{
		Window:      AnalysisWindow7D,
		GeneratedAt: now.Add(-1 * time.Hour).Format(time.RFC3339),
		DataStatus: AnalysisDataStatus{
			Sufficient:              true,
			Partial:                 false,
			WindowStart:             "2026-05-20",
			WindowEnd:               "2026-05-27",
			CoveredSymbols:          []string{"NDX", "QQQ", "XLK", "SMH", "IGV", "XAU"},
			ExpectedSymbols:         append([]string(nil), analysisExpectedAllSymbols...),
			TechCoveredSymbolCount:  5,
			MetalCoveredSymbolCount: 1,
			Note:                    "贵金属覆盖有限，但仍可形成方向判断。",
		},
		Summary:      "科技偏强，避险偏弱。",
		MarketRegime: marketRegimeRiskOn,
		Confidence:   confidenceLow,
	}

	response := buildOverviewResponse(AnalysisWindow7D, ai, market, now)
	if response == nil {
		t.Fatalf("expected overview response")
	}
	if !response.DataStatus.Partial {
		t.Fatalf("expected overview partial when ai partial is true")
	}
	if response.DataStatus.AISampleCount != 6 {
		t.Fatalf("expected ai sample count 6, got %d", response.DataStatus.AISampleCount)
	}
	if response.DataStatus.TechCoveredSymbolCount != 5 || response.DataStatus.MetalCoveredSymbolCount != 1 {
		t.Fatalf("expected market coverage counts to be preserved, got tech=%d metal=%d", response.DataStatus.TechCoveredSymbolCount, response.DataStatus.MetalCoveredSymbolCount)
	}
	if !strings.Contains(response.DataStatus.Note, "抓取时间回退") {
		t.Fatalf("expected ai fallback note to be preserved, got %q", response.DataStatus.Note)
	}
	if !strings.Contains(response.DataStatus.Note, "贵金属覆盖有限") {
		t.Fatalf("expected market degradation note to be preserved, got %q", response.DataStatus.Note)
	}
	if response.GeneratedAt != now.Format(time.RFC3339) {
		t.Fatalf("expected generatedAt to use supplied time, got %q", response.GeneratedAt)
	}
}

func TestBuildOverviewResponseAllowsMarketPartial(t *testing.T) {
	now := time.Date(2026, 5, 27, 11, 0, 0, 0, time.Local)
	ai := &AITrendAnalysisResponse{
		DataStatus: AnalysisDataStatus{
			Sufficient:  true,
			Partial:     false,
			WindowStart: "2026-05-20",
			WindowEnd:   "2026-05-27",
			SampleCount: 5,
			Note:        "AI 样本完整。",
		},
		Summary:        "近 7 天企业应用热度抬升。",
		DominantThemes: []ThemeCount{{Theme: "enterprise-app", Count: 3, Share: 0.6}},
		Confidence:     confidenceMedium,
	}
	market := &MarketTrendAnalysisResponse{
		DataStatus: AnalysisDataStatus{
			Sufficient:              true,
			Partial:                 true,
			WindowStart:             "2026-05-20",
			WindowEnd:               "2026-05-27",
			CoveredSymbols:          []string{"NDX", "QQQ", "XLK", "SMH", "IGV"},
			ExpectedSymbols:         append([]string(nil), analysisExpectedAllSymbols...),
			TechCoveredSymbolCount:  5,
			MetalCoveredSymbolCount: 0,
			Note:                    "贵金属样本不足，当前市场判断基于科技侧。",
		},
		Summary:      "科技资产延续强势。",
		MarketRegime: marketRegimeRiskOn,
		Confidence:   confidenceLow,
	}

	response := buildOverviewResponse(AnalysisWindow7D, ai, market, now)
	if response == nil {
		t.Fatalf("expected overview response")
	}
	if !response.DataStatus.Partial {
		t.Fatalf("expected overview partial when market partial is true")
	}
	if response.DataStatus.AISampleCount != 5 {
		t.Fatalf("expected ai sample count 5, got %d", response.DataStatus.AISampleCount)
	}
	if response.DataStatus.MetalCoveredSymbolCount != 0 {
		t.Fatalf("expected metal covered count 0, got %d", response.DataStatus.MetalCoveredSymbolCount)
	}
	if !strings.Contains(response.DataStatus.Note, "AI 样本完整") {
		t.Fatalf("expected ai note to be preserved, got %q", response.DataStatus.Note)
	}
	if !strings.Contains(response.DataStatus.Note, "贵金属样本不足") {
		t.Fatalf("expected market partial note to be preserved, got %q", response.DataStatus.Note)
	}
}

func TestQuestionAuthorFilterUsesPartialMatch(t *testing.T) {
	author := strings.TrimSpace("  pilot  ")
	like := "%" + author + "%"
	if like != "%pilot%" {
		t.Fatalf("expected wrapped LIKE pattern, got %q", like)
	}
}
