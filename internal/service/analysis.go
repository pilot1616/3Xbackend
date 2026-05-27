package service

import (
	"3Xbackend/internal/database"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

var (
	ErrInvalidAnalysisWindow     = errors.New("invalid analysis window")
	ErrInsufficientAIDailyData   = errors.New("insufficient ai daily data for analysis")
	ErrInsufficientMarketHistory = errors.New("insufficient market history for analysis")
	ErrAnalysisComputationFailed = errors.New("analysis computation failed")
)

type AnalysisWindow string

const (
	AnalysisWindow1D  AnalysisWindow = "1d"
	AnalysisWindow7D  AnalysisWindow = "7d"
	AnalysisWindow30D AnalysisWindow = "30d"
)

const (
	marketRegimeRiskOn  = "risk-on"
	marketRegimeRiskOff = "risk-off"
	marketRegimeMixed   = "mixed"

	overviewAlignmentAligned   = "aligned"
	overviewAlignmentDiverging = "diverging"
	overviewAlignmentMixed     = "mixed"

	confidenceLow    = "low"
	confidenceMedium = "medium"
	confidenceHigh   = "high"

	emergingReasonClusteredRecent = "clustered-in-recent-days"
)

var (
	analysisExpectedTechSymbols  = []string{"NDX", "QQQ", "XLK", "SMH", "IGV"}
	analysisExpectedMetalSymbols = []string{"XAU", "XAG", "XPT", "XPD"}
	analysisExpectedAllSymbols   = []string{"NDX", "QQQ", "XLK", "SMH", "IGV", "XAU", "XAG", "XPT", "XPD"}
	aiThemeOrder                 = []string{"infra", "model-capability", "agent", "enterprise-app", "open-source", "regulation"}
	aiThemeKeywords              = map[string][]string{
		"agent":            {"agent", "agents", "autonomous", "workflow", "multi-agent", "assistant"},
		"model-capability": {"model", "reasoning", "benchmark", "multimodal", "inference", "inference-time", "capability"},
		"infra":            {"gpu", "chip", "chips", "inference stack", "datacenter", "data center", "serving", "training", "compute", "cluster", "semiconductor"},
		"open-source":      {"open source", "open-source", "github", "apache", "community release"},
		"enterprise-app":   {"enterprise", "workflow", "copilot", "copilots", "business automation", "pricing", "deployment"},
		"regulation":       {"policy", "regulation", "compliance", "governance", "safety law", "监管", "政策"},
	}
)

type AnalysisService struct {
	db *gorm.DB
}

type AnalysisDataStatus struct {
	Sufficient              bool     `json:"sufficient"`
	Partial                 bool     `json:"partial"`
	WindowStart             string   `json:"windowStart"`
	WindowEnd               string   `json:"windowEnd"`
	SampleCount             int      `json:"sampleCount,omitempty"`
	CoveredSymbols          []string `json:"coveredSymbols,omitempty"`
	ExpectedSymbols         []string `json:"expectedSymbols,omitempty"`
	TechCoveredSymbolCount  int      `json:"techCoveredSymbolCount,omitempty"`
	MetalCoveredSymbolCount int      `json:"metalCoveredSymbolCount,omitempty"`
	AISampleCount           int      `json:"aiSampleCount,omitempty"`
	Note                    string   `json:"note"`
}

type ThemeCount struct {
	Theme string  `json:"theme"`
	Count int     `json:"count"`
	Share float64 `json:"share,omitempty"`
}

type EmergingTheme struct {
	Theme  string `json:"theme"`
	Count  int    `json:"count"`
	Reason string `json:"reason"`
}

type AIEvidenceItem struct {
	Title         string   `json:"title"`
	PublishedDate string   `json:"publishedDate"`
	Themes        []string `json:"themes"`
}

type MarketMomentum struct {
	AverageChangePercent float64 `json:"averageChangePercent"`
	Advancers            int     `json:"advancers"`
	Decliners            int     `json:"decliners"`
}

type MarketMover struct {
	Symbol        string  `json:"symbol"`
	ChangePercent float64 `json:"changePercent"`
}

type MarketEvidenceItem struct {
	Symbol        string  `json:"symbol"`
	StartPrice    string  `json:"startPrice"`
	EndPrice      string  `json:"endPrice"`
	ChangePercent float64 `json:"changePercent"`
}

type OverviewEvidenceItem struct {
	Type    string   `json:"type"`
	Theme   string   `json:"theme,omitempty"`
	Symbols []string `json:"symbols,omitempty"`
	Note    string   `json:"note"`
}

type OverviewAITrendSummary struct {
	Summary        string   `json:"summary"`
	DominantThemes []string `json:"dominantThemes"`
	Confidence     string   `json:"confidence"`
}

type OverviewMarketTrendSummary struct {
	Summary      string `json:"summary"`
	MarketRegime string `json:"marketRegime"`
	Confidence   string `json:"confidence"`
}

type AITrendAnalysisResponse struct {
	Window          AnalysisWindow     `json:"window"`
	GeneratedAt     string             `json:"generatedAt"`
	DataStatus      AnalysisDataStatus `json:"dataStatus"`
	Summary         string             `json:"summary"`
	DominantThemes  []ThemeCount       `json:"dominantThemes"`
	EmergingThemes  []EmergingTheme    `json:"emergingThemes"`
	HeadlineSignals []string           `json:"headlineSignals"`
	Risks           []string           `json:"risks"`
	Confidence      string             `json:"confidence"`
	Evidence        []AIEvidenceItem   `json:"evidence"`
}

type MarketTrendAnalysisResponse struct {
	Window            AnalysisWindow       `json:"window"`
	GeneratedAt       string               `json:"generatedAt"`
	DataStatus        AnalysisDataStatus   `json:"dataStatus"`
	Summary           string               `json:"summary"`
	MarketRegime      string               `json:"marketRegime"`
	TechMomentum      MarketMomentum       `json:"techMomentum"`
	SafeHavenMomentum MarketMomentum       `json:"safeHavenMomentum"`
	Leaders           []MarketMover        `json:"leaders"`
	Laggards          []MarketMover        `json:"laggards"`
	Risks             []string             `json:"risks"`
	Confidence        string               `json:"confidence"`
	Evidence          []MarketEvidenceItem `json:"evidence"`
}

type OverviewAnalysisResponse struct {
	Window        AnalysisWindow             `json:"window"`
	GeneratedAt   string                     `json:"generatedAt"`
	DataStatus    AnalysisDataStatus         `json:"dataStatus"`
	Summary       string                     `json:"summary"`
	Alignment     string                     `json:"alignment"`
	LinkageTags   []string                   `json:"linkageTags"`
	KeyAgreements []string                   `json:"keyAgreements"`
	KeyTensions   []string                   `json:"keyTensions"`
	AITrend       OverviewAITrendSummary     `json:"aiTrend"`
	MarketTrend   OverviewMarketTrendSummary `json:"marketTrend"`
	Evidence      []OverviewEvidenceItem     `json:"evidence,omitempty"`
	Risks         []string                   `json:"risks"`
	Confidence    string                     `json:"confidence"`
}

type aiDailySection struct {
	Heading string   `json:"heading"`
	Items   []string `json:"items"`
}

type aiDailyAnalysisInput struct {
	Title             string
	Summary           string
	Content           string
	PublishedDate     string
	Sections          []aiDailySection
	FetchedAt         time.Time
	EffectiveTime     time.Time
	UsedPublishedDate bool
	Themes            []string
	FallbackToFetched bool
}

type themeStats struct {
	Counts          map[string]int
	DominantThemes  []ThemeCount
	EmergingThemes  []EmergingTheme
	ThemeOrder      []string
	TotalSamples    int
	Concentration   float64
	ClassifiedCount int
}

type marketSeriesPoint struct {
	Symbol    string
	Name      string
	Price     float64
	PriceText string
	FetchedAt time.Time
}

type marketSeriesSnapshot struct {
	Symbol         string
	Name           string
	StartPrice     float64
	StartPriceText string
	EndPrice       float64
	EndPriceText   string
	ChangePercent  float64
	LatestAt       time.Time
}

type marketRegimeResult struct {
	Regime         string
	TechMomentum   MarketMomentum
	MetalMomentum  MarketMomentum
	Leaders        []MarketMover
	Laggards       []MarketMover
	Evidence       []MarketEvidenceItem
	CoveredSymbols []string
	TechCovered    int
	MetalCovered   int
	Partial        bool
	Note           string
	Risks          []string
	Confidence     string
	TechLeaders    []string
	MetalLeaders   []string
	TechAverage    float64
	MetalAverage   float64
}

type overviewLinkageResult struct {
	Alignment  string
	Tags       []string
	Summary    string
	Agreements []string
	Tensions   []string
	Evidence   []OverviewEvidenceItem
	Confidence string
	Risks      []string
}

func NewAnalysisService(db *gorm.DB) *AnalysisService {
	return &AnalysisService{db: db}
}

func parseAnalysisWindow(raw string) (AnalysisWindow, error) {
	switch raw {
	case "":
		return AnalysisWindow7D, nil
	case string(AnalysisWindow1D):
		return AnalysisWindow1D, nil
	case string(AnalysisWindow7D):
		return AnalysisWindow7D, nil
	case string(AnalysisWindow30D):
		return AnalysisWindow30D, nil
	default:
		return "", ErrInvalidAnalysisWindow
	}
}

func ParseAnalysisWindow(raw string) (AnalysisWindow, error) {
	return parseAnalysisWindow(raw)
}

func validateAnalysisWindow(window AnalysisWindow) error {
	_, err := parseAnalysisWindow(string(window))
	return err
}

func (s *AnalysisService) AnalyzeAITrend(window AnalysisWindow) (*AITrendAnalysisResponse, error) {
	if err := validateAnalysisWindow(window); err != nil {
		return nil, err
	}
	now := time.Now()
	inputs, fallbackCount, err := s.listAIDailyInputs(window, now)
	if err != nil {
		return nil, err
	}
	if len(inputs) < minAIDailySamples(window) {
		return nil, ErrInsufficientAIDailyData
	}
	if len(inputs) == fallbackCount && fallbackCount > 0 {
		return nil, ErrInsufficientAIDailyData
	}

	stats := computeAIThemeStats(window, inputs)
	status := AnalysisDataStatus{
		Sufficient:  true,
		Partial:     fallbackCount > 0,
		WindowStart: aiWindowDateString(windowStart(window, now)),
		WindowEnd:   aiWindowDateString(now),
		SampleCount: len(inputs),
		Note:        buildAIDailyStatusNote(fallbackCount),
	}

	response := &AITrendAnalysisResponse{
		Window:          window,
		GeneratedAt:     now.Format(time.RFC3339),
		DataStatus:      status,
		Summary:         buildAISummary(window, stats),
		DominantThemes:  stats.DominantThemes,
		EmergingThemes:  stats.EmergingThemes,
		HeadlineSignals: buildAIHeadlineSignals(stats),
		Risks:           buildAIRisks(window, fallbackCount, stats),
		Confidence:      buildAIConfidence(window, len(inputs), stats),
		Evidence:        buildAIEvidence(inputs),
	}

	return response, nil
}

func (s *AnalysisService) AnalyzeMarketTrend(window AnalysisWindow) (*MarketTrendAnalysisResponse, error) {
	if err := validateAnalysisWindow(window); err != nil {
		return nil, err
	}
	now := time.Now()
	techSeries, techInvalid, err := s.listTechMarketInputs(window, now)
	if err != nil {
		return nil, err
	}
	metalSeries, metalInvalid, err := s.listMetalMarketInputs(window, now)
	if err != nil {
		return nil, err
	}

	regime, err := computeMarketRegime(techSeries, metalSeries)
	if err != nil {
		return nil, err
	}

	noteParts := make([]string, 0, 3)
	missingSymbols := diffStrings(analysisExpectedAllSymbols, regime.CoveredSymbols)
	if regime.Note != "" {
		noteParts = append(noteParts, regime.Note)
	}
	if len(missingSymbols) > 0 {
		noteParts = append(noteParts, fmt.Sprintf("当前窗口缺少预期市场标的：%s。", strings.Join(missingSymbols, ", ")))
	}
	if techInvalid > 0 || metalInvalid > 0 {
		noteParts = append(noteParts, fmt.Sprintf("有 %d 条市场快照因价格不可解析被跳过。", techInvalid+metalInvalid))
	}

	risks := append(buildMarketRisks(regime), regime.Risks...)
	if len(missingSymbols) > 0 {
		risks = append(risks, fmt.Sprintf("以下预期市场标的在当前窗口内覆盖不完整：%s。", strings.Join(missingSymbols, ", ")))
	}

	response := &MarketTrendAnalysisResponse{
		Window:      window,
		GeneratedAt: now.Format(time.RFC3339),
		DataStatus: AnalysisDataStatus{
			Sufficient:              true,
			Partial:                 regime.Partial || techInvalid > 0 || metalInvalid > 0 || len(missingSymbols) > 0,
			WindowStart:             windowStart(window, now).Format(time.RFC3339),
			WindowEnd:               now.Format(time.RFC3339),
			CoveredSymbols:          regime.CoveredSymbols,
			ExpectedSymbols:         append([]string(nil), analysisExpectedAllSymbols...),
			TechCoveredSymbolCount:  regime.TechCovered,
			MetalCoveredSymbolCount: regime.MetalCovered,
			Note:                    strings.Join(noteParts, " "),
		},
		Summary:           buildMarketSummary(regime),
		MarketRegime:      regime.Regime,
		TechMomentum:      regime.TechMomentum,
		SafeHavenMomentum: regime.MetalMomentum,
		Leaders:           regime.Leaders,
		Laggards:          regime.Laggards,
		Risks:             risks,
		Confidence:        regime.Confidence,
		Evidence:          regime.Evidence,
	}

	return response, nil
}

func (s *AnalysisService) AnalyzeOverview(window AnalysisWindow) (*OverviewAnalysisResponse, error) {
	if err := validateAnalysisWindow(window); err != nil {
		return nil, err
	}
	aiTrend, err := s.AnalyzeAITrend(window)
	if err != nil {
		return nil, err
	}
	marketTrend, err := s.AnalyzeMarketTrend(window)
	if err != nil {
		return nil, err
	}
	return buildOverviewResponse(window, aiTrend, marketTrend, time.Now()), nil
}

func buildOverviewResponse(window AnalysisWindow, aiTrend *AITrendAnalysisResponse, marketTrend *MarketTrendAnalysisResponse, now time.Time) *OverviewAnalysisResponse {
	linkage := buildOverviewLinkage(aiTrend, marketTrend)
	response := &OverviewAnalysisResponse{
		Window:      window,
		GeneratedAt: now.Format(time.RFC3339),
		DataStatus: AnalysisDataStatus{
			Sufficient:              true,
			Partial:                 aiTrend.DataStatus.Partial || marketTrend.DataStatus.Partial,
			WindowStart:             marketTrend.DataStatus.WindowStart,
			WindowEnd:               marketTrend.DataStatus.WindowEnd,
			AISampleCount:           aiTrend.DataStatus.SampleCount,
			TechCoveredSymbolCount:  marketTrend.DataStatus.TechCoveredSymbolCount,
			MetalCoveredSymbolCount: marketTrend.DataStatus.MetalCoveredSymbolCount,
			CoveredSymbols:          append([]string(nil), marketTrend.DataStatus.CoveredSymbols...),
			ExpectedSymbols:         append([]string(nil), marketTrend.DataStatus.ExpectedSymbols...),
			Note:                    combineNotes(aiTrend.DataStatus.Note, marketTrend.DataStatus.Note),
		},
		Summary:       linkage.Summary,
		Alignment:     linkage.Alignment,
		LinkageTags:   linkage.Tags,
		KeyAgreements: linkage.Agreements,
		KeyTensions:   linkage.Tensions,
		AITrend: OverviewAITrendSummary{
			Summary:        aiTrend.Summary,
			DominantThemes: extractThemeNames(aiTrend.DominantThemes),
			Confidence:     aiTrend.Confidence,
		},
		MarketTrend: OverviewMarketTrendSummary{
			Summary:      marketTrend.Summary,
			MarketRegime: marketTrend.MarketRegime,
			Confidence:   marketTrend.Confidence,
		},
		Evidence:   linkage.Evidence,
		Risks:      linkage.Risks,
		Confidence: linkage.Confidence,
	}
	return response
}

func (s *AnalysisService) listAIDailyInputs(window AnalysisWindow, now time.Time) ([]aiDailyAnalysisInput, int, error) {
	if s.db == nil {
		return nil, 0, ErrAnalysisComputationFailed
	}
	var snapshots []database.AIDailySnapshot
	if err := s.db.Where("fetched_at <= ?", now).Order("fetched_at ASC").Find(&snapshots).Error; err != nil {
		return nil, 0, ErrAnalysisComputationFailed
	}
	return buildAIDailyInputs(window, now, snapshots), countAIDailyFallbacks(window, now, snapshots), nil
}

func buildAIDailyInputs(window AnalysisWindow, now time.Time, snapshots []database.AIDailySnapshot) []aiDailyAnalysisInput {
	start := windowStart(window, now)
	end := now
	inputs := make([]aiDailyAnalysisInput, 0, len(snapshots))
	for _, snapshot := range snapshots {
		sections := make([]aiDailySection, 0)
		if snapshot.SectionsJSON != "" {
			if err := json.Unmarshal([]byte(snapshot.SectionsJSON), &sections); err != nil {
				sections = nil
			}
		}

		effectiveTime, usedPublished := resolveAIDailyTime(snapshot.PublishedDate, snapshot.FetchedAt)
		fallback := !usedPublished
		if effectiveTime.Before(start) || effectiveTime.After(end) {
			continue
		}
		input := aiDailyAnalysisInput{
			Title:             snapshot.Title,
			Summary:           snapshot.Summary,
			Content:           snapshot.Content,
			PublishedDate:     snapshot.PublishedDate,
			Sections:          sections,
			FetchedAt:         snapshot.FetchedAt,
			EffectiveTime:     effectiveTime,
			UsedPublishedDate: usedPublished,
			FallbackToFetched: fallback,
		}
		input.Themes = classifyAIDailyThemes(input)
		inputs = append(inputs, input)
	}

	sort.Slice(inputs, func(i, j int) bool {
		return inputs[i].EffectiveTime.Before(inputs[j].EffectiveTime)
	})
	return inputs
}

func countAIDailyFallbacks(window AnalysisWindow, now time.Time, snapshots []database.AIDailySnapshot) int {
	start := windowStart(window, now)
	end := now
	fallbackCount := 0
	for _, snapshot := range snapshots {
		effectiveTime, usedPublished := resolveAIDailyTime(snapshot.PublishedDate, snapshot.FetchedAt)
		if effectiveTime.Before(start) || effectiveTime.After(end) {
			continue
		}
		if !usedPublished {
			fallbackCount++
		}
	}
	return fallbackCount
}

func (s *AnalysisService) listTechMarketInputs(window AnalysisWindow, now time.Time) (map[string][]marketSeriesPoint, int, error) {
	if s.db == nil {
		return nil, 0, ErrAnalysisComputationFailed
	}
	var snapshots []database.TechMarketSnapshot
	start := windowStart(window, now)
	if err := s.db.Where("symbol IN ? AND fetched_at >= ? AND fetched_at <= ?", analysisExpectedTechSymbols, start, now).Order("fetched_at ASC").Find(&snapshots).Error; err != nil {
		return nil, 0, ErrAnalysisComputationFailed
	}
	return groupTechSeries(snapshots), countInvalidTechPrices(snapshots), nil
}

func (s *AnalysisService) listMetalMarketInputs(window AnalysisWindow, now time.Time) (map[string][]marketSeriesPoint, int, error) {
	if s.db == nil {
		return nil, 0, ErrAnalysisComputationFailed
	}
	var snapshots []database.PreciousMetalSnapshot
	start := windowStart(window, now)
	if err := s.db.Where("symbol IN ? AND fetched_at >= ? AND fetched_at <= ?", analysisExpectedMetalSymbols, start, now).Order("fetched_at ASC").Find(&snapshots).Error; err != nil {
		return nil, 0, ErrAnalysisComputationFailed
	}
	return groupMetalSeries(snapshots), countInvalidMetalPrices(snapshots), nil
}

func groupTechSeries(snapshots []database.TechMarketSnapshot) map[string][]marketSeriesPoint {
	series := make(map[string][]marketSeriesPoint)
	for _, snapshot := range snapshots {
		price, err := parseNumericString(snapshot.Price)
		if err != nil {
			continue
		}
		series[snapshot.Symbol] = append(series[snapshot.Symbol], marketSeriesPoint{
			Symbol:    snapshot.Symbol,
			Name:      snapshot.Name,
			Price:     price,
			PriceText: normalizePriceText(snapshot.Price),
			FetchedAt: snapshot.FetchedAt,
		})
	}
	return series
}

func groupMetalSeries(snapshots []database.PreciousMetalSnapshot) map[string][]marketSeriesPoint {
	series := make(map[string][]marketSeriesPoint)
	for _, snapshot := range snapshots {
		price, err := parseNumericString(snapshot.Price)
		if err != nil {
			continue
		}
		series[snapshot.Symbol] = append(series[snapshot.Symbol], marketSeriesPoint{
			Symbol:    snapshot.Symbol,
			Name:      snapshot.Name,
			Price:     price,
			PriceText: normalizePriceText(snapshot.Price),
			FetchedAt: snapshot.FetchedAt,
		})
	}
	return series
}

func countInvalidTechPrices(snapshots []database.TechMarketSnapshot) int {
	invalid := 0
	for _, snapshot := range snapshots {
		if _, err := parseNumericString(snapshot.Price); err != nil {
			invalid++
		}
	}
	return invalid
}

func countInvalidMetalPrices(snapshots []database.PreciousMetalSnapshot) int {
	invalid := 0
	for _, snapshot := range snapshots {
		if _, err := parseNumericString(snapshot.Price); err != nil {
			invalid++
		}
	}
	return invalid
}

func windowStart(window AnalysisWindow, now time.Time) time.Time {
	localNow := now.In(time.Local)
	dayStart := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, localNow.Location())
	switch window {
	case AnalysisWindow1D:
		return dayStart
	case AnalysisWindow30D:
		return dayStart.AddDate(0, 0, -29)
	default:
		return dayStart.AddDate(0, 0, -6)
	}
}

func minAIDailySamples(window AnalysisWindow) int {
	switch window {
	case AnalysisWindow1D:
		return 1
	case AnalysisWindow30D:
		return 7
	default:
		return 3
	}
}

func resolveAIDailyTime(publishedDate string, fetchedAt time.Time) (time.Time, bool) {
	publishedDate = strings.TrimSpace(publishedDate)
	if publishedDate == "" {
		return fetchedAt, false
	}
	formats := []string{time.RFC3339, "2006-01-02", "2006/01/02", "2006-01-02 15:04:05", "2006-01-02T15:04:05"}
	for _, format := range formats {
		parsed, err := time.ParseInLocation(format, publishedDate, time.Local)
		if err == nil {
			if format == "2006-01-02" || format == "2006/01/02" {
				parsed = time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 12, 0, 0, 0, time.Local)
			}
			return parsed, true
		}
	}
	return fetchedAt, false
}

func classifyAIDailyThemes(input aiDailyAnalysisInput) []string {
	text := buildAIDailyCorpus(input)
	themes := make([]string, 0, len(aiThemeKeywords))
	for _, theme := range aiThemeOrder {
		keywords := aiThemeKeywords[theme]
		for _, keyword := range keywords {
			if strings.Contains(text, keyword) {
				themes = append(themes, theme)
				break
			}
		}
	}
	return themes
}

func buildAIDailyCorpus(input aiDailyAnalysisInput) string {
	parts := []string{input.Title, input.Summary, input.Content}
	for _, section := range input.Sections {
		parts = append(parts, section.Heading)
		parts = append(parts, section.Items...)
	}
	text := strings.ToLower(strings.Join(parts, " "))
	return strings.Join(strings.Fields(text), " ")
}

func computeAIThemeStats(window AnalysisWindow, inputs []aiDailyAnalysisInput) themeStats {
	stats := themeStats{
		Counts:       make(map[string]int, len(aiThemeKeywords)),
		ThemeOrder:   append([]string(nil), aiThemeOrder...),
		TotalSamples: len(inputs),
	}
	for _, input := range inputs {
		if len(input.Themes) > 0 {
			stats.ClassifiedCount++
		}
		for _, theme := range input.Themes {
			stats.Counts[theme]++
		}
	}

	themeCounts := make([]ThemeCount, 0, len(stats.Counts))
	maxShare := 0.0
	for _, theme := range aiThemeOrder {
		count := stats.Counts[theme]
		if count == 0 {
			continue
		}
		share := roundTo(float64(count)/float64(max(1, len(inputs))), 2)
		if share > maxShare {
			maxShare = share
		}
		if window == AnalysisWindow1D || (count >= 2 && share >= 0.2) {
			themeCounts = append(themeCounts, ThemeCount{Theme: theme, Count: count, Share: share})
		}
	}
	sort.Slice(themeCounts, func(i, j int) bool {
		if themeCounts[i].Count == themeCounts[j].Count {
			return themeIndex(themeCounts[i].Theme) < themeIndex(themeCounts[j].Theme)
		}
		return themeCounts[i].Count > themeCounts[j].Count
	})
	if len(themeCounts) > 3 {
		themeCounts = themeCounts[:3]
	}
	stats.DominantThemes = themeCounts
	stats.Concentration = maxShare
	stats.EmergingThemes = computeEmergingThemes(inputs, stats.Counts)
	return stats
}

func computeEmergingThemes(inputs []aiDailyAnalysisInput, counts map[string]int) []EmergingTheme {
	if len(inputs) < 3 {
		return nil
	}
	mid := len(inputs) / 2
	if mid == 0 {
		mid = 1
	}
	front := inputs[:mid]
	back := inputs[mid:]
	emerging := make([]EmergingTheme, 0, 2)
	for _, theme := range aiThemeOrder {
		frontCount := countThemeHits(front, theme)
		backCount := countThemeHits(back, theme)
		if frontCount <= 1 && backCount >= 2 && counts[theme] > 0 {
			emerging = append(emerging, EmergingTheme{Theme: theme, Count: counts[theme], Reason: emergingReasonClusteredRecent})
		}
	}
	sort.Slice(emerging, func(i, j int) bool {
		if emerging[i].Count == emerging[j].Count {
			return themeIndex(emerging[i].Theme) < themeIndex(emerging[j].Theme)
		}
		return emerging[i].Count > emerging[j].Count
	})
	if len(emerging) > 3 {
		return emerging[:3]
	}
	return emerging
}

func countThemeHits(inputs []aiDailyAnalysisInput, theme string) int {
	count := 0
	for _, input := range inputs {
		if containsStringValue(input.Themes, theme) {
			count++
		}
	}
	return count
}

func buildAISummary(window AnalysisWindow, stats themeStats) string {
	windowLabel := analysisWindowNarrativeLabel(window)
	if len(stats.DominantThemes) == 0 {
		return fmt.Sprintf("%s内的 AI 日报主题分布较分散，暂时没有形成明确的主导焦点。", windowLabel)
	}
	first := analysisThemeLabel(stats.DominantThemes[0].Theme)
	if len(stats.DominantThemes) == 1 {
		return fmt.Sprintf("%s内的 AI 日报主要由%s主题主导，关注点明显集中在这一方向。", windowLabel, first)
	}
	second := analysisThemeLabel(stats.DominantThemes[1].Theme)
	return fmt.Sprintf("%s内的 AI 日报主要围绕%s和%s展开，信息重心仍然集中在这两个主题。", windowLabel, first, second)
}

func buildAIHeadlineSignals(stats themeStats) []string {
	signals := make([]string, 0, 3)
	if len(stats.DominantThemes) > 0 {
		signals = append(signals, fmt.Sprintf("%s是当前窗口内出现频率最高的 AI 主题。", analysisThemeLabel(stats.DominantThemes[0].Theme)))
	}
	if len(stats.DominantThemes) > 1 {
		signals = append(signals, fmt.Sprintf("%s虽然不是第一主题，但保持了持续出现。", analysisThemeLabel(stats.DominantThemes[1].Theme)))
	}
	if len(stats.EmergingThemes) > 0 {
		signals = append(signals, fmt.Sprintf("%s主题在窗口后半段出现得更集中，存在升温迹象。", analysisThemeLabel(stats.EmergingThemes[0].Theme)))
	}
	return signals
}

func buildAIRisks(window AnalysisWindow, fallbackCount int, stats themeStats) []string {
	risks := []string{"主题识别基于规则关键词，可能遗漏隐含主题或语义相近表达。"}
	if window == AnalysisWindow1D {
		risks = append(risks, "短窗口更容易反映近期信息脉冲，不代表稳定长期趋势。")
	}
	if fallbackCount > 0 {
		risks = append(risks, "部分 AI 日报因 PublishedDate 缺失或不可解析，回退使用了 FetchedAt。")
	}
	if stats.Concentration < 0.34 {
		risks = append(risks, "主题分布较分散，因此总结结论的集中度会低于表面描述。")
	}
	return truncateStrings(risks, 3)
}

func buildAIConfidence(window AnalysisWindow, sampleCount int, stats themeStats) string {
	minSamples := minAIDailySamples(window)
	if sampleCount <= minSamples || stats.Concentration < 0.34 {
		return confidenceLow
	}
	if sampleCount >= minSamples+3 && stats.Concentration >= 0.55 && len(stats.DominantThemes) > 0 {
		return confidenceHigh
	}
	return confidenceMedium
}

func buildAIEvidence(inputs []aiDailyAnalysisInput) []AIEvidenceItem {
	evidence := make([]AIEvidenceItem, 0, min(6, len(inputs)))
	for i := len(inputs) - 1; i >= 0 && len(evidence) < 6; i-- {
		input := inputs[i]
		if len(input.Themes) == 0 {
			continue
		}
		publishedDate := input.PublishedDate
		if input.FallbackToFetched || strings.TrimSpace(publishedDate) == "" {
			publishedDate = input.FetchedAt.In(time.Local).Format("2006-01-02")
		}
		evidence = append(evidence, AIEvidenceItem{
			Title:         input.Title,
			PublishedDate: publishedDate,
			Themes:        append([]string(nil), input.Themes...),
		})
	}
	return evidence
}

func buildAIDailyStatusNote(fallbackCount int) string {
	if fallbackCount == 0 {
		return ""
	}
	if fallbackCount == 1 {
		return "1 条 AI 日报因 PublishedDate 缺失或不可解析，回退使用了 FetchedAt。"
	}
	return fmt.Sprintf("%d 条 AI 日报因 PublishedDate 缺失或不可解析，回退使用了 FetchedAt。", fallbackCount)
}

func computeMarketRegime(tech map[string][]marketSeriesPoint, metals map[string][]marketSeriesPoint) (marketRegimeResult, error) {
	techSnapshots := summarizeMarketSeries(analysisExpectedTechSymbols, tech)
	metalSnapshots := summarizeMarketSeries(analysisExpectedMetalSymbols, metals)
	if len(techSnapshots) < 3 {
		return marketRegimeResult{}, ErrInsufficientMarketHistory
	}

	techMomentum := buildMarketMomentum(techSnapshots)
	metalMomentum := buildMarketMomentum(metalSnapshots)
	regime := marketRegimeResult{
		TechMomentum:   techMomentum,
		MetalMomentum:  metalMomentum,
		TechCovered:    len(techSnapshots),
		MetalCovered:   len(metalSnapshots),
		CoveredSymbols: append(extractMarketSymbols(techSnapshots), extractMarketSymbols(metalSnapshots)...),
		Confidence:     confidenceMedium,
	}

	allSnapshots := append(append([]marketSeriesSnapshot(nil), techSnapshots...), metalSnapshots...)
	regime.Leaders = marketMovers(allSnapshots, true)
	regime.Laggards = marketMovers(allSnapshots, false)
	regime.Evidence = buildMarketEvidence(techSnapshots, metalSnapshots)
	regime.TechLeaders = extractTopSymbols(regime.Leaders, analysisExpectedTechSymbols)
	regime.MetalLeaders = extractPositivePriorityMetals(metalSnapshots)
	regime.TechAverage = techMomentum.AverageChangePercent
	regime.MetalAverage = metalMomentum.AverageChangePercent

	if len(metalSnapshots) < 2 {
		regime.Partial = true
		regime.Note = "贵金属覆盖不足，因此本次市场结论更多依赖科技组数据。"
		regime.Risks = append(regime.Risks, "贵金属样本不足时，结果可能更偏向科技组风险偏好的判断。")
		regime.Confidence = confidenceLow
		if techMomentum.AverageChangePercent > 0 && techMomentum.Advancers > techMomentum.Decliners {
			regime.Regime = marketRegimeRiskOn
		} else {
			regime.Regime = marketRegimeMixed
		}
		return regime, nil
	}

	goldOrSilverStrong := symbolPositive(metalSnapshots, "XAU") || symbolPositive(metalSnapshots, "XAG")
	switch {
	case techMomentum.Advancers > techMomentum.Decliners && techMomentum.AverageChangePercent > 0 && metalMomentum.AverageChangePercent <= 0:
		regime.Regime = marketRegimeRiskOn
	case techMomentum.Decliners > techMomentum.Advancers && techMomentum.AverageChangePercent < 0 && metalMomentum.AverageChangePercent > 0 && goldOrSilverStrong:
		regime.Regime = marketRegimeRiskOff
	default:
		regime.Regime = marketRegimeMixed
	}

	if len(techSnapshots) >= 4 && len(metalSnapshots) >= 3 {
		if (regime.Regime == marketRegimeRiskOn && techMomentum.AverageChangePercent >= 1.5) || (regime.Regime == marketRegimeRiskOff && metalMomentum.AverageChangePercent >= 1) {
			regime.Confidence = confidenceHigh
		}
	}
	if regime.Regime == marketRegimeMixed {
		regime.Confidence = confidenceLow
	}
	return regime, nil
}

func summarizeMarketSeries(expected []string, seriesBySymbol map[string][]marketSeriesPoint) []marketSeriesSnapshot {
	series := make([]marketSeriesSnapshot, 0, len(expected))
	for _, symbol := range expected {
		points := append([]marketSeriesPoint(nil), seriesBySymbol[symbol]...)
		if len(points) < 2 {
			continue
		}
		sort.Slice(points, func(i, j int) bool {
			return points[i].FetchedAt.Before(points[j].FetchedAt)
		})
		start := points[0]
		end := points[len(points)-1]
		if start.Price == 0 {
			continue
		}
		changePercent := roundTo(((end.Price-start.Price)/start.Price)*100, 2)
		series = append(series, marketSeriesSnapshot{
			Symbol:         symbol,
			Name:           end.Name,
			StartPrice:     start.Price,
			StartPriceText: start.PriceText,
			EndPrice:       end.Price,
			EndPriceText:   end.PriceText,
			ChangePercent:  changePercent,
			LatestAt:       end.FetchedAt,
		})
	}
	return series
}

func buildMarketMomentum(series []marketSeriesSnapshot) MarketMomentum {
	if len(series) == 0 {
		return MarketMomentum{}
	}
	advancers := 0
	decliners := 0
	total := 0.0
	for _, item := range series {
		total += item.ChangePercent
		if item.ChangePercent > 0 {
			advancers++
		}
		if item.ChangePercent < 0 {
			decliners++
		}
	}
	return MarketMomentum{
		AverageChangePercent: roundTo(total/float64(len(series)), 2),
		Advancers:            advancers,
		Decliners:            decliners,
	}
}

func marketMovers(series []marketSeriesSnapshot, descending bool) []MarketMover {
	movers := make([]MarketMover, 0, len(series))
	for _, item := range series {
		movers = append(movers, MarketMover{Symbol: item.Symbol, ChangePercent: item.ChangePercent})
	}
	sort.Slice(movers, func(i, j int) bool {
		if movers[i].ChangePercent == movers[j].ChangePercent {
			return movers[i].Symbol < movers[j].Symbol
		}
		if descending {
			return movers[i].ChangePercent > movers[j].ChangePercent
		}
		return movers[i].ChangePercent < movers[j].ChangePercent
	})
	if len(movers) > 3 {
		return movers[:3]
	}
	return movers
}

func buildMarketEvidence(tech []marketSeriesSnapshot, metals []marketSeriesSnapshot) []MarketEvidenceItem {
	priority := []string{"QQQ", "SMH", "NDX", "XAU", "XAG", "XLK", "IGV", "XPT", "XPD"}
	lookup := make(map[string]marketSeriesSnapshot, len(tech)+len(metals))
	for _, item := range tech {
		lookup[item.Symbol] = item
	}
	for _, item := range metals {
		lookup[item.Symbol] = item
	}
	evidence := make([]MarketEvidenceItem, 0, 5)
	for _, symbol := range priority {
		item, ok := lookup[symbol]
		if !ok {
			continue
		}
		evidence = append(evidence, MarketEvidenceItem{
			Symbol:        item.Symbol,
			StartPrice:    item.StartPriceText,
			EndPrice:      item.EndPriceText,
			ChangePercent: item.ChangePercent,
		})
		if len(evidence) == 5 {
			break
		}
	}
	return evidence
}

func buildMarketSummary(result marketRegimeResult) string {
	switch result.Regime {
	case marketRegimeRiskOn:
		if result.Partial {
			return "科技风险资产整体更强，但贵金属覆盖有限，因此当前市场判断会更偏向科技组证据。"
		}
		return "科技风险资产整体偏强，而贵金属并未形成领涨，当前市场更接近风险偏好环境。"
	case marketRegimeRiskOff:
		return "科技资产整体偏弱，而黄金或白银更强，当前市场更接近避险偏好环境。"
	default:
		return "科技资产与避险资产信号分化，因此当前市场状态更接近分化环境。"
	}
}

func buildMarketRisks(result marketRegimeResult) []string {
	risks := []string{
		"市场分析基于抓取快照，不是交易所级别的高频实时行情。",
		"不同标的在同一窗口内的快照密度可能并不完全一致。",
	}
	if result.Partial {
		risks = append(risks, "当贵金属覆盖较薄时，市场判断会更容易体现科技组强弱，而不是完整的避险确认。")
	}
	return truncateStrings(risks, 3)
}

func buildOverviewLinkage(ai *AITrendAnalysisResponse, market *MarketTrendAnalysisResponse) overviewLinkageResult {
	result := overviewLinkageResult{
		Alignment:  overviewAlignmentMixed,
		Confidence: combineConfidence(ai.Confidence, market.Confidence),
		Risks: []string{
			"综合判断基于规则联动，不代表稳定长期因果关系。",
			"短窗口内，市场反馈可能滞后于叙事变化。",
		},
	}

	aiDominant := extractThemeNames(ai.DominantThemes)
	hasInfra := containsStringValue(aiDominant, "infra")
	hasEnterprise := containsStringValue(aiDominant, "enterprise-app") || containsEmergingTheme(ai.EmergingThemes, "enterprise-app")
	hasRegulation := containsStringValue(aiDominant, "regulation") || containsEmergingTheme(ai.EmergingThemes, "regulation")
	hasModelOrAgent := containsStringValue(aiDominant, "model-capability") || containsStringValue(aiDominant, "agent")
	leaderSet := moversToSet(market.Leaders)

	if hasInfra && (market.MarketRegime == marketRegimeRiskOn || market.TechMomentum.AverageChangePercent > 0) && (leaderSet["SMH"] || leaderSet["QQQ"] || leaderSet["NDX"]) {
		result.Tags = append(result.Tags, "infra-chip-alignment")
		result.Agreements = append(result.Agreements, "基础设施主题升温，同时半导体与科技基准也处于领涨位置。")
		result.Evidence = append(result.Evidence, OverviewEvidenceItem{
			Type:    "theme-market-alignment",
			Theme:   "infra",
			Symbols: collectSymbolsInOrder(leaderSet, []string{"SMH", "QQQ", "NDX"}),
			Note:    "基础设施关注度提升，同时半导体和广义科技风险资产也在同步走强。",
		})
	}
	if hasEnterprise && market.MarketRegime != marketRegimeRiskOn {
		result.Tags = append(result.Tags, "app-pricing-gap")
		result.Tensions = append(result.Tensions, "企业应用叙事正在升温，但市场尚未用明确的风险偏好表现去确认它。")
	}
	if hasRegulation && (market.MarketRegime == marketRegimeRiskOff || market.MarketRegime == marketRegimeMixed) {
		result.Tags = append(result.Tags, "policy-overhang")
		result.Tensions = append(result.Tensions, "监管主题占比正在提升，而市场风险偏好仍然受限。")
	}
	if hasModelOrAgent && market.MarketRegime == marketRegimeRiskOn && market.SafeHavenMomentum.AverageChangePercent <= 0 {
		result.Tags = append(result.Tags, "speculative-risk-on")
		result.Agreements = append(result.Agreements, "模型能力与智能体叙事，正在获得科技风险偏好改善的支持。")
	}
	if market.MarketRegime == marketRegimeRiskOff && (containsStringValue(aiDominant, "infra") || hasModelOrAgent) {
		result.Tags = append(result.Tags, "defensive-rotation")
		result.Tensions = append(result.Tensions, "AI 叙事仍然活跃，但市场整体正在向避险资产做防御性轮动。")
	}
	if len(result.Tags) == 0 || (len(result.Agreements) == 0 && len(result.Tensions) == 0) {
		result.Tags = append(result.Tags, "mixed-conviction")
	}

	if len(result.Agreements) > 0 && len(result.Tensions) == 0 {
		result.Alignment = overviewAlignmentAligned
	} else if len(result.Tensions) > 0 && len(result.Agreements) == 0 {
		result.Alignment = overviewAlignmentDiverging
	} else {
		result.Alignment = overviewAlignmentMixed
	}

	result.Tags = uniqueStrings(result.Tags)
	result.Agreements = uniqueStrings(result.Agreements)
	result.Tensions = uniqueStrings(result.Tensions)
	result.Evidence = truncateOverviewEvidence(result.Evidence, 3)
	result.Summary = buildOverviewSummary(ai, market, result)
	return result
}

func buildOverviewSummary(ai *AITrendAnalysisResponse, market *MarketTrendAnalysisResponse, linkage overviewLinkageResult) string {
	primaryTheme := "分散主题"
	if len(ai.DominantThemes) > 0 {
		primaryTheme = analysisThemeLabel(ai.DominantThemes[0].Theme)
	}
	regimeLabel := marketRegimeNarrativeLabel(market.MarketRegime)
	switch linkage.Alignment {
	case overviewAlignmentAligned:
		return fmt.Sprintf("AI 信息面目前由%s主导，而市场也通过%s状态对这一叙事做出了确认。", primaryTheme, regimeLabel)
	case overviewAlignmentDiverging:
		return fmt.Sprintf("AI 信息面目前由%s主导，但市场定价尚未确认这一叙事，当前仍表现为%s。", primaryTheme, regimeLabel)
	default:
		return fmt.Sprintf("AI 信息面目前由%s主导，但市场确认信号仍然分化，当前整体更接近%s。", primaryTheme, regimeLabel)
	}
}

func parseNumericString(raw string) (float64, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "-" || trimmed == "--" || strings.EqualFold(trimmed, "n/a") {
		return 0, fmt.Errorf("invalid numeric value")
	}
	cleaned := strings.ReplaceAll(trimmed, ",", "")
	cleaned = strings.ReplaceAll(cleaned, "%", "")
	cleaned = strings.ReplaceAll(cleaned, "(", "")
	cleaned = strings.ReplaceAll(cleaned, ")", "")
	cleaned = strings.TrimSpace(cleaned)
	value, err := strconv.ParseFloat(cleaned, 64)
	if err != nil {
		return 0, err
	}
	return value, nil
}

func normalizePriceText(raw string) string {
	value, err := parseNumericString(raw)
	if err != nil {
		return strings.TrimSpace(raw)
	}
	return strconv.FormatFloat(value, 'f', 2, 64)
}

func aiWindowDateString(t time.Time) string {
	return t.In(time.Local).Format("2006-01-02")
}

func analysisWindowNarrativeLabel(window AnalysisWindow) string {
	switch window {
	case AnalysisWindow1D:
		return "近 1 天"
	case AnalysisWindow30D:
		return "近 30 天"
	default:
		return "近 7 天"
	}
}

func analysisThemeLabel(theme string) string {
	switch theme {
	case "infra":
		return "基础设施"
	case "model-capability":
		return "模型能力"
	case "agent":
		return "智能体"
	case "enterprise-app":
		return "企业应用"
	case "open-source":
		return "开源生态"
	case "regulation":
		return "监管政策"
	default:
		return theme
	}
}

func marketRegimeNarrativeLabel(regime string) string {
	switch regime {
	case marketRegimeRiskOn:
		return "风险偏好"
	case marketRegimeRiskOff:
		return "避险偏好"
	default:
		return "分化"
	}
}

func extractThemeNames(themes []ThemeCount) []string {
	names := make([]string, 0, len(themes))
	for _, theme := range themes {
		names = append(names, theme.Theme)
	}
	return names
}

func themeIndex(theme string) int {
	for i, item := range aiThemeOrder {
		if item == theme {
			return i
		}
	}
	return len(aiThemeOrder)
}

func containsStringValue(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func containsEmergingTheme(themes []EmergingTheme, target string) bool {
	for _, theme := range themes {
		if theme.Theme == target {
			return true
		}
	}
	return false
}

func moversToSet(movers []MarketMover) map[string]bool {
	set := make(map[string]bool, len(movers))
	for _, mover := range movers {
		set[mover.Symbol] = true
	}
	return set
}

func collectSymbolsInOrder(set map[string]bool, ordered []string) []string {
	values := make([]string, 0, len(ordered))
	for _, symbol := range ordered {
		if set[symbol] {
			values = append(values, symbol)
		}
	}
	return values
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func diffStrings(expected []string, actual []string) []string {
	actualSet := make(map[string]struct{}, len(actual))
	for _, value := range actual {
		actualSet[value] = struct{}{}
	}
	missing := make([]string, 0)
	for _, value := range expected {
		if _, ok := actualSet[value]; ok {
			continue
		}
		missing = append(missing, value)
	}
	return missing
}

func truncateStrings(values []string, limit int) []string {
	if len(values) <= limit {
		return values
	}
	return values[:limit]
}

func truncateOverviewEvidence(values []OverviewEvidenceItem, limit int) []OverviewEvidenceItem {
	if len(values) <= limit {
		return values
	}
	return values[:limit]
}

func roundTo(value float64, places int) float64 {
	pow := math.Pow(10, float64(places))
	return math.Round(value*pow) / pow
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func extractMarketSymbols(series []marketSeriesSnapshot) []string {
	symbols := make([]string, 0, len(series))
	for _, item := range series {
		symbols = append(symbols, item.Symbol)
	}
	return symbols
}

func symbolPositive(series []marketSeriesSnapshot, symbol string) bool {
	for _, item := range series {
		if item.Symbol == symbol {
			return item.ChangePercent > 0
		}
	}
	return false
}

func extractTopSymbols(movers []MarketMover, allowed []string) []string {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, symbol := range allowed {
		allowedSet[symbol] = struct{}{}
	}
	result := make([]string, 0, len(movers))
	for _, mover := range movers {
		if _, ok := allowedSet[mover.Symbol]; ok {
			result = append(result, mover.Symbol)
		}
	}
	return result
}

func extractPositivePriorityMetals(series []marketSeriesSnapshot) []string {
	priority := []string{"XAU", "XAG", "XPT", "XPD"}
	result := make([]string, 0, 2)
	for _, symbol := range priority {
		for _, item := range series {
			if item.Symbol == symbol && item.ChangePercent > 0 {
				result = append(result, symbol)
			}
		}
	}
	return result
}

func combineNotes(parts ...string) string {
	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			filtered = append(filtered, part)
		}
	}
	return strings.Join(filtered, " ")
}

func combineConfidence(left, right string) string {
	order := map[string]int{confidenceLow: 1, confidenceMedium: 2, confidenceHigh: 3}
	if order[left] < order[right] {
		return left
	}
	return right
}
