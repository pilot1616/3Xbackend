package service

import (
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

func TestAIDailyQueryStartAddsOneDayBuffer(t *testing.T) {
	now := time.Date(2026, 5, 22, 16, 30, 0, 0, time.Local)
	tests := []struct {
		window AnalysisWindow
		want   time.Time
	}{
		{window: AnalysisWindow1D, want: time.Date(2026, 5, 21, 0, 0, 0, 0, time.Local)},
		{window: AnalysisWindow7D, want: time.Date(2026, 5, 15, 0, 0, 0, 0, time.Local)},
		{window: AnalysisWindow30D, want: time.Date(2026, 4, 22, 0, 0, 0, 0, time.Local)},
	}

	for _, tt := range tests {
		if got := aiDailyQueryStart(tt.window, now); !got.Equal(tt.want) {
			t.Fatalf("window %q: expected %s, got %s", tt.window, tt.want.Format(time.RFC3339), got.Format(time.RFC3339))
		}
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
