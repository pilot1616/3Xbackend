package service

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/database"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
)

type PreciousMetalSyncService struct {
	db     *gorm.DB
	config config.PreciousMetalsSync
	client *http.Client

	runMu sync.Mutex
}

type MarketSyncSummary struct {
	TargetCount   int       `json:"targetCount"`
	SuccessCount  int       `json:"successCount"`
	FailedSymbols []string  `json:"failedSymbols"`
	FailedDetails []string  `json:"failedDetails"`
	FetchedAt     time.Time `json:"fetchedAt"`
	Partial       bool      `json:"partial"`
}

type preciousMetalTarget struct {
	Symbol string
	Name   string
	Path   string
}

type PreciousMetalSnapshotPayload struct {
	Source         string            `json:"source"`
	Symbol         string            `json:"symbol"`
	Name           string            `json:"name"`
	SourceURL      string            `json:"sourceUrl"`
	Price          string            `json:"price"`
	Change         string            `json:"change"`
	ChangePercent  string            `json:"changePercent"`
	PrevClose      string            `json:"prevClose"`
	Open           string            `json:"open"`
	Bid            string            `json:"bid"`
	Ask            string            `json:"ask"`
	DayRange       string            `json:"dayRange"`
	Week52Range    string            `json:"week52Range"`
	Volume         string            `json:"volume"`
	AvgVolume      string            `json:"avgVolume"`
	LastUpdateText string            `json:"lastUpdateText"`
	ContractMonth  string            `json:"contractMonth"`
	SettlementDate string            `json:"settlementDate"`
	TickSize       string            `json:"tickSize"`
	ContractSize   string            `json:"contractSize"`
	TickValue      string            `json:"tickValue"`
	BaseUnit       string            `json:"baseUnit"`
	Overview       map[string]string `json:"overview"`
	FetchedAt      time.Time         `json:"fetchedAt"`
}

var preciousMetalTargets = []preciousMetalTarget{
	{Symbol: "XAU", Name: "Gold", Path: "/commodities/gold"},
	{Symbol: "XAG", Name: "Silver", Path: "/commodities/silver"},
	{Symbol: "XPT", Name: "Platinum", Path: "/commodities/platinum"},
	{Symbol: "XPD", Name: "Palladium", Path: "/commodities/palladium"},
}

var (
	textValuePattern = regexp.MustCompile(`(?is)<span[^>]*>([^<]+)</span>`)
	tagPattern       = regexp.MustCompile(`(?s)<[^>]+>`)
	spacePattern     = regexp.MustCompile(`\s+`)
)

func NewPreciousMetalSyncService(db *gorm.DB, cfg config.PreciousMetalsSync) *PreciousMetalSyncService {
	return &PreciousMetalSyncService{
		db:     db,
		config: cfg,
		client: &http.Client{Timeout: cfg.RequestTimeout()},
	}
}

func (s *PreciousMetalSyncService) Start(ctx context.Context) {
	if !s.config.IsEnabled() {
		log.Printf("precious metal sync disabled")
		return
	}

	if s.config.InitialRunOnStartup {
		go func() {
			if err := s.SyncOnce(ctx); err != nil {
				log.Printf("initial precious metal sync failed: %v", err)
			}
		}()
	}

	go func() {
		ticker := time.NewTicker(s.config.Interval())
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.SyncOnce(ctx); err != nil {
					log.Printf("scheduled precious metal sync failed: %v", err)
				}
			}
		}
	}()
}

func (s *PreciousMetalSyncService) SyncOnce(ctx context.Context) error {
	_, err := s.SyncWithResult(ctx)
	return err
}

func (s *PreciousMetalSyncService) SyncWithResult(ctx context.Context) (*MarketSyncSummary, error) {
	s.runMu.Lock()
	defer s.runMu.Unlock()

	fetchedAt := time.Now()
	summary := &MarketSyncSummary{
		TargetCount:   len(preciousMetalTargets),
		FailedSymbols: make([]string, 0),
		FailedDetails: make([]string, 0),
		FetchedAt:     fetchedAt,
	}
	for _, target := range preciousMetalTargets {
		payload, err := s.fetchTarget(ctx, target, fetchedAt)
		if err != nil {
			summary.FailedSymbols = append(summary.FailedSymbols, target.Symbol)
			summary.FailedDetails = append(summary.FailedDetails, fmt.Sprintf("%s: %v", target.Symbol, err))
			continue
		}
		if err := s.storeSnapshot(payload); err != nil {
			summary.FailedSymbols = append(summary.FailedSymbols, target.Symbol)
			summary.FailedDetails = append(summary.FailedDetails, fmt.Sprintf("%s: store failed: %v", target.Symbol, err))
			continue
		}
		summary.SuccessCount++
	}

	if summary.SuccessCount == 0 {
		return summary, fmt.Errorf("all precious metal targets failed: %s", strings.Join(summary.FailedDetails, "; "))
	}

	summary.Partial = len(summary.FailedSymbols) > 0
	if summary.Partial {
		log.Printf("precious metal sync completed with partial failures: %s", strings.Join(summary.FailedDetails, "; "))
	}
	log.Printf("precious metal sync completed at %s", fetchedAt.Format(time.RFC3339))
	return summary, nil
}

func (s *PreciousMetalSyncService) fetchTarget(ctx context.Context, target preciousMetalTarget, fetchedAt time.Time) (*PreciousMetalSnapshotPayload, error) {
	body, err := s.fetchPage(ctx, s.config.EffectiveSourceBaseURL()+target.Path)
	if err != nil {
		return nil, err
	}

	overview := extractOverviewMap(body)
	payload := &PreciousMetalSnapshotPayload{
		Source:         "investing",
		Symbol:         target.Symbol,
		Name:           target.Name,
		SourceURL:      s.config.EffectiveSourceBaseURL() + target.Path,
		Price:          firstNonEmpty(extractByDataTest(body, "instrument-price-last"), overview["Last"], overview["Price"]),
		Change:         firstNonEmpty(extractByDataTest(body, "instrument-price-change"), overview["Change"]),
		ChangePercent:  firstNonEmpty(extractByDataTest(body, "instrument-price-change-percent"), overview["Change %"]),
		PrevClose:      overview["Prev. Close"],
		Open:           overview["Open"],
		Bid:            overview["Bid"],
		Ask:            overview["Ask"],
		DayRange:       firstNonEmpty(overview["Day's Range"], overview["Day Range"]),
		Week52Range:    firstNonEmpty(overview["52 wk Range"], overview["52 Week Range"]),
		Volume:         overview["Volume"],
		AvgVolume:      firstNonEmpty(overview["Average Vol. (3m)"], overview["Average Volume"]),
		LastUpdateText: extractLastUpdate(body),
		ContractMonth:  firstNonEmpty(overview["Contract Month"], overview["Month"]),
		SettlementDate: firstNonEmpty(overview["Settlement Date"], overview["Settlement"]),
		TickSize:       firstNonEmpty(overview["Tick Size"], overview["Point Value"]),
		ContractSize:   overview["Contract Size"],
		TickValue:      overview["Tick Value"],
		BaseUnit:       firstNonEmpty(overview["Base Unit"], overview["1 Troy Ounce"]),
		Overview:       overview,
		FetchedAt:      fetchedAt,
	}

	return payload, nil
}

func (s *PreciousMetalSyncService) storeSnapshot(payload *PreciousMetalSnapshotPayload) error {
	overviewJSON, err := json.Marshal(payload.Overview)
	if err != nil {
		return fmt.Errorf("marshal overview failed: %w", err)
	}

	record := &database.PreciousMetalSnapshot{
		Source:         payload.Source,
		Symbol:         payload.Symbol,
		Name:           payload.Name,
		SourceURL:      payload.SourceURL,
		Price:          payload.Price,
		Change:         payload.Change,
		ChangePercent:  payload.ChangePercent,
		PrevClose:      payload.PrevClose,
		Open:           payload.Open,
		Bid:            payload.Bid,
		Ask:            payload.Ask,
		DayRange:       payload.DayRange,
		Week52Range:    payload.Week52Range,
		Volume:         payload.Volume,
		AvgVolume:      payload.AvgVolume,
		LastUpdateText: truncateString(payload.LastUpdateText, 255),
		ContractMonth:  payload.ContractMonth,
		SettlementDate: payload.SettlementDate,
		TickSize:       payload.TickSize,
		ContractSize:   payload.ContractSize,
		TickValue:      payload.TickValue,
		BaseUnit:       payload.BaseUnit,
		OverviewJSON:   string(overviewJSON),
		FetchedAt:      payload.FetchedAt,
	}

	return s.db.Create(record).Error
}

func fetchInvestingPage(ctx context.Context, client *http.Client, userAgent, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("create request failed: %w", err)
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("request page failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read body failed: %w", err)
	}
	return string(body), nil
}

func (s *PreciousMetalSyncService) fetchPage(ctx context.Context, url string) (string, error) {
	return fetchInvestingPage(ctx, s.client, s.config.EffectiveUserAgent(), url)
}

func extractByDataTest(body, dataTest string) string {
	marker := fmt.Sprintf(`data-test="%s"`, dataTest)
	idx := strings.Index(body, marker)
	if idx < 0 {
		return ""
	}

	tagEndOffset := strings.Index(body[idx:], ">")
	if tagEndOffset < 0 {
		return ""
	}

	contentStart := idx + tagEndOffset + 1
	if contentStart < len(body) {
		contentEndOffset := strings.Index(body[contentStart:], "<")
		if contentEndOffset >= 0 {
			value := cleanHTMLText(body[contentStart : contentStart+contentEndOffset])
			if value != "" {
				return value
			}
		}
	}

	segment := body[idx:]
	match := textValuePattern.FindStringSubmatch(segment)
	if len(match) < 2 {
		return ""
	}
	return cleanHTMLText(match[1])
}

func extractOverviewMap(body string) map[string]string {
	result := make(map[string]string)
	rows := strings.Split(body, "<dt")
	for _, row := range rows {
		if !strings.Contains(row, "</dt>") || !strings.Contains(row, "</dd>") {
			continue
		}
		labelStart := strings.Index(row, ">")
		labelEnd := strings.Index(row, "</dt>")
		valueStart := strings.Index(row, "<dd")
		valueEnd := strings.Index(row, "</dd>")
		if labelStart < 0 || labelEnd < 0 || valueStart < 0 || valueEnd < 0 || valueStart >= valueEnd {
			continue
		}
		valueSegment := row[valueStart:]
		valueSegment = valueSegment[strings.Index(valueSegment, ">")+1 : valueEnd-valueStart]
		label := cleanHTMLText(row[labelStart+1 : labelEnd])
		value := cleanHTMLText(valueSegment)
		if label != "" && value != "" {
			result[label] = value
		}
	}
	return result
}

func extractLastUpdate(body string) string {
	markers := []string{"Last Update:", "As of", "Updated"}
	for _, marker := range markers {
		idx := strings.Index(body, marker)
		if idx < 0 {
			continue
		}
		segment := body[idx:]
		if len(segment) > 180 {
			segment = segment[:180]
		}
		segment = cleanHTMLText(segment)
		if segment != "" {
			return segment
		}
	}
	return ""
}

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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func truncateString(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit]
}
