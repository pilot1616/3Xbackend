package service

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/database"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
)

type TechMarketSyncService struct {
	db     *gorm.DB
	config config.AITechSync
	client *http.Client

	runMu sync.Mutex
}

type techMarketTarget struct {
	Category string
	Symbol   string
	Name     string
	Paths    []string
}

type TechMarketSnapshotPayload struct {
	Source         string            `json:"source"`
	Category       string            `json:"category"`
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
	MarketCap      string            `json:"marketCap"`
	PERatio        string            `json:"peRatio"`
	Beta           string            `json:"beta"`
	EPS            string            `json:"eps"`
	Dividend       string            `json:"dividend"`
	Yield          string            `json:"yield"`
	LastUpdateText string            `json:"lastUpdateText"`
	Overview       map[string]string `json:"overview"`
	FetchedAt      time.Time         `json:"fetchedAt"`
}

var techMarketTargets = []techMarketTarget{
	{Category: "index", Symbol: "NDX", Name: "Nasdaq 100", Paths: []string{"/indices/nq-100"}},
	{Category: "etf", Symbol: "QQQ", Name: "Invesco QQQ Trust", Paths: []string{"/etfs/powershares-qqqq"}},
	{Category: "etf", Symbol: "XLK", Name: "Technology Select Sector SPDR Fund", Paths: []string{"/etfs/spdr-select-sector---technology"}},
	{Category: "etf", Symbol: "SMH", Name: "VanEck Semiconductor ETF", Paths: []string{"/etfs/holdrs-merrill-lynch-semiconductor", "/etfs/market-vectors-semiconductor-etf"}},
	{Category: "etf", Symbol: "IGV", Name: "iShares Expanded Tech-Software Sector ETF", Paths: []string{"/etfs/ishares-goldman-sachs-software"}},
}

func NewTechMarketSyncService(db *gorm.DB, cfg config.AITechSync) *TechMarketSyncService {
	return &TechMarketSyncService{
		db:     db,
		config: cfg,
		client: &http.Client{Timeout: cfg.RequestTimeout()},
	}
}

func (s *TechMarketSyncService) Start(ctx context.Context) {
	if !s.config.IsEnabled() {
		log.Printf("ai tech market sync disabled")
		return
	}

	if s.config.InitialRunOnStartup {
		go func() {
			if err := s.SyncOnce(ctx); err != nil {
				log.Printf("initial ai tech market sync failed: %v", err)
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
					log.Printf("scheduled ai tech market sync failed: %v", err)
				}
			}
		}
	}()
}

func (s *TechMarketSyncService) SyncOnce(ctx context.Context) error {
	_, err := s.SyncWithResult(ctx)
	return err
}

func (s *TechMarketSyncService) SyncWithResult(ctx context.Context) (*MarketSyncSummary, error) {
	s.runMu.Lock()
	defer s.runMu.Unlock()

	fetchedAt := time.Now()
	summary := &MarketSyncSummary{
		TargetCount:   len(techMarketTargets),
		FailedSymbols: make([]string, 0),
		FailedDetails: make([]string, 0),
		FetchedAt:     fetchedAt,
	}
	for _, target := range techMarketTargets {
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
		return summary, fmt.Errorf("all ai tech targets failed: %s", strings.Join(summary.FailedDetails, "; "))
	}

	summary.Partial = len(summary.FailedSymbols) > 0
	if summary.Partial {
		log.Printf("ai tech market sync completed with partial failures: %s", strings.Join(summary.FailedDetails, "; "))
	}

	log.Printf("ai tech market sync completed at %s", fetchedAt.Format(time.RFC3339))
	return summary, nil
}

func (s *TechMarketSyncService) fetchTarget(ctx context.Context, target techMarketTarget, fetchedAt time.Time) (*TechMarketSnapshotPayload, error) {
	var lastErr error
	for _, path := range target.Paths {
		body, err := fetchInvestingPage(ctx, s.client, s.config.EffectiveUserAgent(), s.config.EffectiveSourceBaseURL()+path)
		if err != nil {
			lastErr = err
			continue
		}

		overview := extractOverviewMap(body)
		price := firstNonEmpty(extractByDataTest(body, "instrument-price-last"), overview["Last"], overview["Price"])
		if price == "" {
			lastErr = fmt.Errorf("price not found on page %s", path)
			continue
		}

		return &TechMarketSnapshotPayload{
			Source:         "investing",
			Category:       target.Category,
			Symbol:         target.Symbol,
			Name:           target.Name,
			SourceURL:      s.config.EffectiveSourceBaseURL() + path,
			Price:          price,
			Change:         firstNonEmpty(extractByDataTest(body, "instrument-price-change"), overview["Change"]),
			ChangePercent:  firstNonEmpty(extractByDataTest(body, "instrument-price-change-percent"), overview["Change %"]),
			PrevClose:      overview["Prev. Close"],
			Open:           firstNonEmpty(overview["Open"], overview["Price Open"]),
			Bid:            overview["Bid"],
			Ask:            overview["Ask"],
			DayRange:       firstNonEmpty(overview["Day's Range"], overview["Day Range"], overview["Day’s Range"]),
			Week52Range:    firstNonEmpty(overview["52 wk Range"], overview["52 Week Range"], overview["52-Week Range"]),
			Volume:         overview["Volume"],
			AvgVolume:      firstNonEmpty(overview["Average Vol. (3m)"], overview["Average Volume"], overview["Average Vol. (30 day)"], overview["Average Vol. (3m)"]),
			MarketCap:      firstNonEmpty(overview["Market Cap"], overview["Mkt Cap"], overview["Capitalization"]),
			PERatio:        firstNonEmpty(overview["P/E Ratio"], overview["PE Ratio"], overview["PER"]),
			Beta:           overview["Beta"],
			EPS:            overview["EPS"],
			Dividend:       firstNonEmpty(overview["Dividend"], overview["Dividend (Yield)"], overview["Dividends (TTM)"]),
			Yield:          firstNonEmpty(overview["Yield"], overview["Dividend Yield"], overview["Dividend Yield %"]),
			LastUpdateText: extractLastUpdate(body),
			Overview:       overview,
			FetchedAt:      fetchedAt,
		}, nil
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("all candidate paths failed")
	}
	return nil, lastErr
}

func (s *TechMarketSyncService) storeSnapshot(payload *TechMarketSnapshotPayload) error {
	overviewJSON, err := json.Marshal(payload.Overview)
	if err != nil {
		return fmt.Errorf("marshal overview failed: %w", err)
	}

	record := &database.TechMarketSnapshot{
		Source:         payload.Source,
		Category:       payload.Category,
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
		MarketCap:      payload.MarketCap,
		PERatio:        payload.PERatio,
		Beta:           payload.Beta,
		EPS:            payload.EPS,
		Dividend:       payload.Dividend,
		Yield:          payload.Yield,
		LastUpdateText: truncateString(payload.LastUpdateText, 255),
		OverviewJSON:   string(overviewJSON),
		FetchedAt:      payload.FetchedAt,
	}

	return s.db.Create(record).Error
}
