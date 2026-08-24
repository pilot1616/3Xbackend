import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { getAIDailies } from '../api/forum';
import type { AIDailyRecord } from '../types/api';

const aiDailyPageSize = 16;

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || '--';
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(
    date.getHours(),
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDailyDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || '--';
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatElapsed(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  const diffMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 1) {
    return '刚刚同步';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前同步`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前同步`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} 天前同步`;
}

function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeBodyText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function buildParagraphs(value: string) {
  const normalized = normalizeBodyText(value);
  if (!normalized) {
    return [] as string[];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphs.length > 1) {
    return paragraphs;
  }

  const lines = normalized
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    return lines;
  }

  return [normalized];
}

function buildSummary(record: AIDailyRecord) {
  const summary = normalizeInlineText(record.summary || '');
  if (summary) {
    return summary;
  }

  const content = normalizeInlineText(record.content || '');
  if (!content) {
    return '--';
  }

  return content.length > 160 ? `${content.slice(0, 160).trim()}...` : content;
}

export function AIDailyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [records, setRecords] = useState<AIDailyRecord[]>([]);
  const [activeSlug, setActiveSlug] = useState(searchParams.get('slug') ?? '');
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const [message, setMessage] = useState('');
  const [copyingLink, setCopyingLink] = useState(false);
  const deferredKeyword = useDeferredValue(searchInput.trim());
  const requestRef = useRef(0);
  const activeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const nextKeyword = searchParams.get('q') ?? '';
    const nextSlug = searchParams.get('slug') ?? '';
    setSearchInput((current) => (current === nextKeyword ? current : nextKeyword));
    setActiveSlug((current) => (current === nextSlug ? current : nextSlug));
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const keyword = searchInput.trim();
    if (keyword) {
      next.set('q', keyword);
    } else {
      next.delete('q');
    }

    if (activeSlug) {
      next.set('slug', activeSlug);
    } else {
      next.delete('slug');
    }

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [searchInput, activeSlug, searchParams, setSearchParams]);

  useEffect(() => {
    setOffset(0);
  }, [deferredKeyword]);

  useEffect(() => {
    void loadDailies();
  }, [offset, deferredKeyword]);

  useEffect(() => {
    if (records.length > 0 && !records.some((record) => record.slug === activeSlug)) {
      setActiveSlug(records[0].slug);
    }
  }, [activeSlug, records]);

  useEffect(() => {
    activeButtonRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeSlug]);

  async function loadDailies() {
    const requestID = requestRef.current + 1;
    requestRef.current = requestID;

    const isLoadingMore = offset > 0;
    if (isLoadingMore) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setMessage('');

    try {
      const result = await getAIDailies(aiDailyPageSize, deferredKeyword, offset);
      if (requestID !== requestRef.current) {
        return;
      }

      setRecords((current) => {
        const merged = offset > 0 ? [...current, ...result.records] : result.records;
        const deduped = new Map<string, AIDailyRecord>();
        merged.forEach((record) => deduped.set(record.slug, record));
        return [...deduped.values()].sort(
          (a, b) => b.publishedDate.localeCompare(a.publishedDate) || b.fetchedAt.localeCompare(a.fetchedAt),
        );
      });
      setTotal(result.total);
      setHasMore(result.hasMore);
      setUpdatedAt(result.updatedAt);

      if (offset === 0 && result.records.length > 0) {
        setActiveSlug((current) => current || result.records[0].slug);
      }
    } catch (error) {
      if (requestID !== requestRef.current) {
        return;
      }
      setMessage(error instanceof Error ? error.message : '加载 AI 日报失败');
    } finally {
      if (requestID === requestRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  async function handleCopyLink() {
    if (typeof window === 'undefined') {
      return;
    }

    setCopyingLink(true);
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage('当前 AI 日报链接已复制');
    } catch {
      setMessage('复制链接失败，请手动复制地址栏');
    } finally {
      setCopyingLink(false);
    }
  }

  const activeRecord = useMemo(() => records.find((record) => record.slug === activeSlug) ?? records[0] ?? null, [activeSlug, records]);
  const activeIndex = useMemo(() => (activeRecord ? records.findIndex((record) => record.slug === activeRecord.slug) : -1), [activeRecord, records]);
  const previousRecord = activeIndex > 0 ? records[activeIndex - 1] ?? null : null;
  const nextRecord = activeIndex >= 0 && activeIndex < records.length - 1 ? records[activeIndex + 1] ?? null : null;
  const summaryText = activeRecord ? buildSummary(activeRecord) : '--';
  const bodyParagraphs = buildParagraphs(activeRecord?.content || activeRecord?.summary || '');

  return (
    <section className="content whisper-content ai-daily-page">
      <div className="cont w1000 ai-daily-page-shell">
        <section className="ai-daily-hero ai-daily-hero-minimal">
          <div className="ai-daily-hero-copy">
            <span className="ai-daily-hero-kicker">AI Daily</span>
            <h1>AI 日报</h1>
            <p>保持简单。左边选日期，右边直接阅读摘要和全文，不跳转外部页面。</p>
          </div>

          <div className="ai-daily-hero-actions">
            <div className="ai-daily-search-row ai-daily-search-row-minimal">
              <input
                id="ai-daily-search"
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="搜索标题、摘要、正文、日期"
                type="search"
                value={searchInput}
              />
              {searchInput ? (
                <button className="ai-daily-secondary-button" onClick={() => setSearchInput('')} type="button">
                  清空
                </button>
              ) : null}
            </div>

            <div className="ai-daily-hero-meta">
              <span>更新于 {formatDateTime(updatedAt)}</span>
              <span>已载入 {records.length} / {total || records.length}</span>
              {activeRecord ? <span>{formatElapsed(activeRecord.fetchedAt)}</span> : null}
            </div>

            <div className="ai-daily-sync-actions ai-daily-sync-actions-minimal">
              <button className="ai-daily-secondary-button" disabled={copyingLink} onClick={() => void handleCopyLink()} type="button">
                {copyingLink ? '复制中...' : '复制链接'}
              </button>
              <span className="legacy-summary-chip">后台定时更新</span>
            </div>
          </div>
        </section>

        {message ? <div className="legacy-feedback market-feedback">{message}</div> : null}
        {loading ? <div className="legacy-feedback market-feedback">正在加载 AI 日报...</div> : null}

        {!loading && records.length > 0 ? (
          <section className="ai-daily-workbench ai-daily-workbench-minimal">
            <aside className="ai-daily-archive-column">
              <section className="ai-daily-panel ai-daily-archive-panel-minimal">
                <div className="ai-daily-panel-head ai-daily-panel-head-minimal">
                  <div>
                    <h2>归档</h2>
                    <p>{deferredKeyword ? `关键词：${deferredKeyword}` : '按时间浏览，点击左侧条目直接阅读。'}</p>
                  </div>
                </div>

                <div className="ai-daily-archive-list">
                  {records.map((record, index) => (
                    <button
                      className={`ai-daily-archive-item${record.slug === activeRecord?.slug ? ' is-active' : ''}`}
                      key={record.slug}
                      onClick={() => setActiveSlug(record.slug)}
                      ref={record.slug === activeRecord?.slug ? activeButtonRef : undefined}
                      type="button"
                    >
                      <div className="ai-daily-archive-item-top">
                        <span className="ai-daily-archive-order">{String(index + 1).padStart(2, '0')}</span>
                        <span className="ai-daily-archive-date">{formatDailyDate(record.publishedDate)}</span>
                      </div>
                      <strong>{record.title}</strong>
                      <p>{buildSummary(record)}</p>
                    </button>
                  ))}

                  {hasMore ? (
                    <button className="ai-daily-load-more" disabled={loadingMore} onClick={() => setOffset(records.length)} type="button">
                      {loadingMore ? '加载中...' : '加载更多'}
                    </button>
                  ) : (
                    <div className="ai-daily-load-finished">归档已全部载入</div>
                  )}
                </div>
              </section>
            </aside>

            <main className="ai-daily-reader-column">
              {activeRecord ? (
                <section className="ai-daily-panel ai-daily-reader-panel-minimal">
                  <div className="ai-daily-reader-header">
                    <div>
                      <span className="ai-daily-reader-label">阅读</span>
                      <h2>{activeRecord.title}</h2>
                      <p>直接在页面内查看摘要和全文。</p>
                    </div>
                    <div className="ai-daily-reader-badges">
                      <span>{formatDailyDate(activeRecord.publishedDate)}</span>
                      <span>{activeRecord.readTime || '--'}</span>
                      <span>{activeIndex >= 0 ? `${activeIndex + 1} / ${records.length}` : '--'}</span>
                    </div>
                  </div>

                  <div className="ai-daily-nav-actions ai-daily-reader-nav-minimal">
                    <button
                      className="ai-daily-secondary-button"
                      disabled={!previousRecord}
                      onClick={() => previousRecord && setActiveSlug(previousRecord.slug)}
                      type="button"
                    >
                      上一篇
                    </button>
                    <button className="ai-daily-secondary-button" disabled={!nextRecord} onClick={() => nextRecord && setActiveSlug(nextRecord.slug)} type="button">
                      下一篇
                    </button>
                  </div>

                  <section className="ai-daily-summary-panel ai-daily-summary-panel-minimal">
                    <div className="ai-daily-summary-head">
                      <strong>摘要</strong>
                    </div>
                    <div className="ai-daily-summary-text">{summaryText}</div>
                  </section>

                  <section className="ai-daily-fulltext-panel ai-daily-fulltext-panel-minimal">
                    <div className="ai-daily-panel-head ai-daily-panel-head-minimal">
                      <div>
                        <h2>全文</h2>
                        <p>以下内容直接在页面中完整展示。</p>
                      </div>
                      <div className="ai-daily-panel-note">
                        <span>{bodyParagraphs.length} 段</span>
                        <span>{activeRecord.content ? `${activeRecord.content.length} 字` : '仅摘要'}</span>
                      </div>
                    </div>

                    <div className="ai-daily-fulltext-list">
                      {bodyParagraphs.length > 0 ? (
                        bodyParagraphs.map((paragraph, index) => (
                          <article className="ai-daily-fulltext-block" key={`${index}-${paragraph.slice(0, 18)}`}>
                            <p>{paragraph}</p>
                          </article>
                        ))
                      ) : (
                        <div className="legacy-empty-inline">当前这期日报还没有同步出可阅读的正文内容。</div>
                      )}
                    </div>
                  </section>
                </section>
              ) : null}
            </main>
          </section>
        ) : null}

        {!loading && records.length === 0 && !message ? (
          <div className="legacy-feedback market-feedback">
            <p>当前还没有同步到 AI 日报数据。</p>
            <p>后台日报任务完成后会自动出现在这里。</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
