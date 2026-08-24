package service

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/database"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type AIDailySyncService struct {
	db     *gorm.DB
	config config.AIDailySync
	client *http.Client

	runMu sync.Mutex
}

type AIDailyPayload struct {
	Source        string            `json:"source"`
	Title         string            `json:"title"`
	Slug          string            `json:"slug"`
	SourceURL     string            `json:"sourceUrl"`
	PublishedDate string            `json:"publishedDate"`
	Summary       string            `json:"summary"`
	ReadTime      string            `json:"readTime"`
	Content       string            `json:"content"`
	Sections      []AIDailySection  `json:"sections"`
	Links         []AIDailyLink     `json:"links"`
	Meta          map[string]string `json:"meta"`
	FetchedAt     time.Time         `json:"fetchedAt"`
}

type AIDailySection struct {
	Heading string   `json:"heading"`
	Items   []string `json:"items"`
}

type AIDailyLink struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

type aiDailyListEntry struct {
	Title string
	URL   string
	Slug  string
}

var (
	aiDailyLinkPattern            = regexp.MustCompile(`(?is)<a[^>]+href="([^"]*/docs/[^"]+)"[^>]*>(.*?)</a>`)
	aiDailyTitlePattern           = regexp.MustCompile(`(?is)<h1[^>]*>(.*?)</h1>`)
	aiDailyReadTimePattern        = regexp.MustCompile(`(?is)(\d+\s*min(?:ute)?\s*read|阅读\s*\d+\s*分钟)`)
	aiDailyHeadingPattern         = regexp.MustCompile(`(?is)<h2[^>]*>(.*?)</h2>`)
	aiDailyParaPattern            = regexp.MustCompile(`(?is)<p[^>]*>(.*?)</p>`)
	aiDailyListPattern            = regexp.MustCompile(`(?is)<ul[^>]*>(.*?)</ul>`)
	aiDailyListItemPattern        = regexp.MustCompile(`(?is)<li[^>]*>(.*?)</li>`)
	aiDailyMainPattern            = regexp.MustCompile(`(?is)<main[^>]*>(.*?)</main>`)
	aiDailyArticlePattern         = regexp.MustCompile(`(?is)<article[^>]*>(.*?)</article>`)
	aiDailySectionContainerPatten = regexp.MustCompile(`(?is)<section[^>]*>(.*?)</section>`)
)

func NewAIDailySyncService(db *gorm.DB, cfg config.AIDailySync) *AIDailySyncService {
	return &AIDailySyncService{
		db:     db,
		config: cfg,
		client: &http.Client{Timeout: cfg.RequestTimeout()},
	}
}

func (s *AIDailySyncService) Start(ctx context.Context) {
	if !s.config.IsEnabled() {
		log.Printf("ai daily sync disabled")
		return
	}

	if s.config.InitialRunOnStartup {
		go func() {
			if err := s.SyncOnce(ctx); err != nil {
				log.Printf("initial ai daily sync failed: %v", err)
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
					log.Printf("scheduled ai daily sync failed: %v", err)
				}
			}
		}
	}()
}

func (s *AIDailySyncService) SyncOnce(ctx context.Context) error {
	_, err := s.SyncWithResult(ctx)
	return err
}

func (s *AIDailySyncService) SyncWithResult(ctx context.Context) (*MarketSyncSummary, error) {
	s.runMu.Lock()
	defer s.runMu.Unlock()

	return s.syncWithResult(ctx, s.config.MaxEntries)
}

func (s *AIDailySyncService) SyncArchiveWithResult(ctx context.Context, maxEntries int) (*MarketSyncSummary, error) {
	s.runMu.Lock()
	defer s.runMu.Unlock()

	return s.syncWithResult(ctx, maxEntries)
}

func (s *AIDailySyncService) syncWithResult(ctx context.Context, maxEntries int) (*MarketSyncSummary, error) {
	fetchedAt := time.Now()
	entries, err := s.fetchDailyIndex(ctx)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("no ai daily entries found")
	}

	limit := maxEntries
	if limit <= 0 {
		limit = 7
	}
	if limit > len(entries) {
		limit = len(entries)
	}
	entries = entries[:limit]

	summary := &MarketSyncSummary{
		TargetCount:   len(entries),
		FailedSymbols: make([]string, 0),
		FailedDetails: make([]string, 0),
		FetchedAt:     fetchedAt,
	}

	for _, entry := range entries {
		payload, err := s.fetchDaily(ctx, entry, fetchedAt)
		if err != nil {
			summary.FailedSymbols = append(summary.FailedSymbols, entry.Slug)
			summary.FailedDetails = append(summary.FailedDetails, fmt.Sprintf("%s: %v", entry.Slug, err))
			continue
		}
		if err := s.storeDaily(payload); err != nil {
			summary.FailedSymbols = append(summary.FailedSymbols, entry.Slug)
			summary.FailedDetails = append(summary.FailedDetails, fmt.Sprintf("%s: store failed: %v", entry.Slug, err))
			continue
		}
		summary.SuccessCount++
	}

	if summary.SuccessCount == 0 {
		return summary, fmt.Errorf("all ai daily entries failed: %s", strings.Join(summary.FailedDetails, "; "))
	}

	summary.Partial = len(summary.FailedSymbols) > 0
	if summary.Partial {
		log.Printf("ai daily sync completed with partial failures: %s", strings.Join(summary.FailedDetails, "; "))
	}
	log.Printf("ai daily sync completed at %s", fetchedAt.Format(time.RFC3339))
	return summary, nil
}

func (s *AIDailySyncService) fetchDailyIndex(ctx context.Context) ([]aiDailyListEntry, error) {
	body, err := fetchInvestingPage(ctx, s.client, s.config.EffectiveUserAgent(), s.config.EffectiveSourceBaseURL()+s.config.EffectiveIndexPath())
	if err != nil {
		return nil, fmt.Errorf("fetch ai daily index failed: %w", err)
	}

	matches := aiDailyLinkPattern.FindAllStringSubmatch(body, -1)
	entryMap := make(map[string]aiDailyListEntry)
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}
		href := strings.TrimSpace(match[1])
		if href == "" || !strings.Contains(href, "/docs/") {
			continue
		}
		fullURL := href
		if strings.HasPrefix(fullURL, "/") {
			fullURL = s.config.EffectiveSourceBaseURL() + fullURL
		}
		slug := strings.Trim(strings.TrimPrefix(fullURL, s.config.EffectiveSourceBaseURL()), "/")
		title := cleanHTMLText(match[2])
		if title == "" {
			continue
		}
		entryMap[slug] = aiDailyListEntry{Title: title, URL: fullURL, Slug: slug}
	}

	entries := make([]aiDailyListEntry, 0, len(entryMap))
	for _, entry := range entryMap {
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Slug > entries[j].Slug
	})
	return entries, nil
}

func (s *AIDailySyncService) fetchDaily(ctx context.Context, entry aiDailyListEntry, fetchedAt time.Time) (*AIDailyPayload, error) {
	body, err := fetchInvestingPage(ctx, s.client, s.config.EffectiveUserAgent(), entry.URL)
	if err != nil {
		return nil, err
	}

	title := entry.Title
	if match := aiDailyTitlePattern.FindStringSubmatch(body); len(match) >= 2 {
		parsed := cleanHTMLText(match[1])
		if parsed != "" {
			title = parsed
		}
	}

	contentScope := extractAIDailyContentScope(body)
	paragraphs := aiDailyParaPattern.FindAllStringSubmatch(contentScope, -1)
	summary := ""
	contentParts := make([]string, 0, len(paragraphs))
	for _, match := range paragraphs {
		if len(match) < 2 {
			continue
		}
		text := normalizeAIDailyText(cleanHTMLText(match[1]))
		if !isUsefulAIDailyParagraph(text, title) {
			continue
		}
		if summary == "" {
			summary = text
		}
		contentParts = append(contentParts, text)
	}

	if summary == "" {
		summary = truncateString(normalizeAIDailyText(title), 1000)
	}

	readTime := ""
	if match := aiDailyReadTimePattern.FindString(contentScope); match != "" {
		readTime = cleanHTMLText(match)
	}
	if readTime == "" {
		if match := aiDailyReadTimePattern.FindString(body); match != "" {
			readTime = cleanHTMLText(match)
		}
	}

	sections := extractAIDailySections(contentScope)
	links := extractAIDailyLinks(contentScope, s.config.EffectiveSourceBaseURL())
	publishedDate := extractAIDailyDate(entry.Slug)
	meta := map[string]string{
		"entrySlug": entry.Slug,
	}

	content := truncateString(strings.Join(contentParts, "\n\n"), 65535)
	summary = buildAIDailySummary(summary, content)

	return &AIDailyPayload{
		Source:        "hex2077",
		Title:         title,
		Slug:          entry.Slug,
		SourceURL:     entry.URL,
		PublishedDate: publishedDate,
		Summary:       truncateString(summary, 320),
		ReadTime:      truncateString(readTime, 64),
		Content:       content,
		Sections:      sections,
		Links:         links,
		Meta:          meta,
		FetchedAt:     fetchedAt,
	}, nil
}

func extractAIDailyContentScope(body string) string {
	candidates := make([]string, 0, 4)
	if match := aiDailyMainPattern.FindStringSubmatch(body); len(match) >= 2 {
		candidates = append(candidates, match[1])
	}
	if match := aiDailyArticlePattern.FindStringSubmatch(body); len(match) >= 2 {
		candidates = append(candidates, match[1])
	}
	for _, match := range aiDailySectionContainerPatten.FindAllStringSubmatch(body, -1) {
		if len(match) >= 2 {
			candidates = append(candidates, match[1])
		}
	}

	best := ""
	bestScore := -1
	for _, candidate := range candidates {
		score := scoreAIDailyContentScope(candidate)
		if score > bestScore {
			best = candidate
			bestScore = score
		}
	}
	if best != "" {
		return best
	}
	return body
}

func scoreAIDailyContentScope(segment string) int {
	score := 0
	score += len(aiDailyParaPattern.FindAllStringSubmatch(segment, -1)) * 3
	score += len(aiDailyHeadingPattern.FindAllStringSubmatch(segment, -1)) * 2
	score += len(aiDailyListItemPattern.FindAllStringSubmatch(segment, -1))
	text := strings.ToLower(cleanHTMLText(segment))
	for _, marker := range []string{"ai", "openai", "模型", "融资", "发布", "研究", "芯片", "agent"} {
		if strings.Contains(text, marker) {
			score += 4
		}
	}
	for _, noise := range []string{"导航", "搜索", "ctrl+k", "上一篇", "下一篇", "返回首页", "目录"} {
		if strings.Contains(text, noise) {
			score -= 5
		}
	}
	return score
}

func normalizeAIDailyText(text string) string {
	text = strings.TrimSpace(text)
	text = strings.TrimPrefix(text, "摘要：")
	text = strings.TrimPrefix(text, "今日摘要：")
	for _, marker := range []string{"访问网页版↗️", "进群交流🤙", "AI资讯 | 每日早读 | 全网数据聚合 | 前沿科学探索 | 行业自由发声 | 开源创新力量 | AI与人类未来"} {
		if idx := strings.Index(text, marker); idx >= 0 {
			text = text[:idx]
		}
	}
	text = regexp.MustCompile(`阅读时间\s*\d+\s*分钟`).ReplaceAllString(text, "")
	text = regexp.MustCompile(`AI资讯日报\s*\d{4}/\d{1,2}/\d{1,2}`).ReplaceAllString(text, "")
	text = strings.Trim(text, `"|,，。:： `)
	text = spacePattern.ReplaceAllString(text, " ")
	return strings.TrimSpace(text)
}

func isUsefulAIDailyParagraph(text, title string) bool {
	if text == "" {
		return false
	}
	lower := strings.ToLower(text)
	for _, noise := range []string{
		"导航", "搜索", "ctrl+k", "上一篇", "下一篇", "返回首页", "展开目录", "收起目录", "目录", "ai日报 /", "hex2077", "赞助", "copyright",
		"访问网页版", "进群交流", "全网数据聚合", "前沿科学探索", "行业自由发声", "开源创新力量", "ai与人类未来",
	} {
		if strings.Contains(lower, strings.ToLower(noise)) {
			return false
		}
	}
	if title != "" && text == title {
		return false
	}
	if strings.HasPrefix(lower, strings.ToLower(title+" 阅读时间")) {
		return false
	}
	if len([]rune(text)) < 20 {
		return false
	}
	return true
}

func extractAIDailySections(body string) []AIDailySection {
	headings := aiDailyHeadingPattern.FindAllStringSubmatchIndex(body, -1)
	sections := make([]AIDailySection, 0, len(headings))
	for idx, match := range headings {
		if len(match) < 4 {
			continue
		}
		heading := cleanHTMLText(body[match[2]:match[3]])
		if heading == "" {
			continue
		}
		start := match[1]
		end := len(body)
		if idx+1 < len(headings) {
			end = headings[idx+1][0]
		}
		segment := body[start:end]
		items := make([]string, 0)
		for _, listMatch := range aiDailyListPattern.FindAllStringSubmatch(segment, -1) {
			if len(listMatch) < 2 {
				continue
			}
			for _, itemMatch := range aiDailyListItemPattern.FindAllStringSubmatch(listMatch[1], -1) {
				if len(itemMatch) < 2 {
					continue
				}
				item := normalizeAIDailyText(cleanHTMLText(itemMatch[1]))
				if item != "" {
					items = append(items, item)
				}
			}
		}
		sections = append(sections, AIDailySection{Heading: heading, Items: items})
	}
	return sections
}

func extractAIDailyLinks(body, baseURL string) []AIDailyLink {
	matches := aiDailyLinkPattern.FindAllStringSubmatch(body, -1)
	links := make([]AIDailyLink, 0, len(matches))
	seen := make(map[string]struct{})
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}
		url := strings.TrimSpace(match[1])
		if url == "" {
			continue
		}
		if strings.HasPrefix(url, "/") {
			url = baseURL + url
		}
		title := normalizeAIDailyText(cleanHTMLText(match[2]))
		if title == "" {
			title = url
		}
		key := title + "|" + url
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		links = append(links, AIDailyLink{Title: title, URL: url})
	}
	return links
}

func extractAIDailyDate(slug string) string {
	parts := strings.Split(strings.Trim(slug, "/"), "/")
	for i := len(parts) - 1; i >= 0; i-- {
		part := parts[i]
		if len(part) == len("2006-01-02") {
			if _, err := time.Parse("2006-01-02", part); err == nil {
				return part
			}
		}
	}
	return ""
}

func buildAIDailySummary(summary, content string) string {
	source := strings.TrimSpace(summary)
	if source == "" {
		source = strings.TrimSpace(content)
	}
	if source == "" {
		return ""
	}
	for _, marker := range []string{"产品与功能更新", "今日看点", "重点内容"} {
		if idx := strings.Index(source, marker); idx > 0 {
			source = strings.TrimSpace(source[:idx])
			break
		}
	}

	parts := strings.FieldsFunc(source, func(r rune) bool {
		switch r {
		case '。', '！', '？', '.', '!', '?', '\n', '；', ';':
			return true
		default:
			return false
		}
	})
	cleaned := make([]string, 0, 2)
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if len([]rune(part)) < 12 {
			continue
		}
		cleaned = append(cleaned, part)
		if len(cleaned) >= 2 {
			break
		}
	}
	if len(cleaned) > 0 {
		return strings.Join(cleaned, "。")
	}
	return source
}

func (s *AIDailySyncService) storeDaily(payload *AIDailyPayload) error {
	sectionsJSON, err := json.Marshal(payload.Sections)
	if err != nil {
		return fmt.Errorf("marshal sections failed: %w", err)
	}
	linksJSON, err := json.Marshal(payload.Links)
	if err != nil {
		return fmt.Errorf("marshal links failed: %w", err)
	}
	metaJSON, err := json.Marshal(payload.Meta)
	if err != nil {
		return fmt.Errorf("marshal meta failed: %w", err)
	}

	record := &database.AIDailySnapshot{
		Source:        payload.Source,
		Title:         truncateString(payload.Title, 255),
		Slug:          truncateString(payload.Slug, 255),
		SourceURL:     truncateString(payload.SourceURL, 255),
		PublishedDate: truncateString(payload.PublishedDate, 32),
		Summary:       payload.Summary,
		ReadTime:      payload.ReadTime,
		Content:       payload.Content,
		SectionsJSON:  string(sectionsJSON),
		LinksJSON:     string(linksJSON),
		MetaJSON:      string(metaJSON),
		FetchedAt:     payload.FetchedAt,
	}

	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "source"}, {Name: "slug"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"title",
			"source_url",
			"published_date",
			"summary",
			"read_time",
			"content",
			"sections_json",
			"links_json",
			"meta_json",
			"fetched_at",
		}),
	}).Create(record).Error
}
