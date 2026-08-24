import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { askAgentAnalysis, getAITrend, getMarketTrend, getOverview } from '../api/forum';
import { ApiError } from '../api/client';
import type {
  AgentPromptResponse,
  AITrendAnalysisResponse,
  AnalysisConfidence,
  AnalysisWindow,
  MarketTrendAnalysisResponse,
  OverviewAnalysisResponse,
} from '../types/api';

const analysisWindows: AnalysisWindow[] = ['1d', '7d', '30d'];
const agentCacheTTL = 60 * 60 * 1000;
const agentCachePrefix = '3x-analysis-agent-cache-v2';

type ModuleError = {
  title: string;
  detail: string;
  status: number | null;
};

type AgentAnalysisCacheRecord = {
  generatedAt: string;
  value: AgentPromptResponse;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || '--';
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(
    2,
    '0',
  )}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatWindowLabel(value: AnalysisWindow) {
  if (value === '1d') {
    return '近 1 天';
  }
  if (value === '7d') {
    return '近 7 天';
  }
  return '近 30 天';
}

function formatConfidenceLabel(value: AnalysisConfidence) {
  if (value === 'high') {
    return '高置信';
  }
  if (value === 'medium') {
    return '中置信';
  }
  return '低置信';
}

function formatAlignmentLabel(value: OverviewAnalysisResponse['alignment']) {
  if (value === 'aligned') {
    return '一致';
  }
  if (value === 'diverging') {
    return '背离';
  }
  return '分化';
}

function formatMarketRegimeLabel(value: MarketTrendAnalysisResponse['marketRegime']) {
  if (value === 'risk-on') {
    return '风险偏好';
  }
  if (value === 'risk-off') {
    return '避险偏好';
  }
  return '分化';
}

function formatThemeLabel(value: string) {
  switch (value) {
    case 'infra':
      return '基础设施';
    case 'model-capability':
      return '模型能力';
    case 'agent':
      return '智能体';
    case 'enterprise-app':
      return '企业应用';
    case 'open-source':
      return '开源生态';
    case 'regulation':
      return '监管政策';
    default:
      return value;
  }
}

function formatEmergingReason(value: string) {
  if (value === 'clustered-in-recent-days') {
    return '最近几天集中出现';
  }
  return value;
}

function formatLinkageTag(value: string) {
  switch (value) {
    case 'infra-chip-alignment':
      return '基础设施与芯片共振';
    case 'app-pricing-gap':
      return '应用叙事与定价落差';
    case 'policy-overhang':
      return '监管压力抬头';
    case 'speculative-risk-on':
      return '风险偏好推动投机升温';
    case 'defensive-rotation':
      return '防御性轮动';
    case 'mixed-conviction':
      return '信号分歧';
    default:
      return value;
  }
}

function formatChangePercent(value: number) {
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toFixed(2)}%`;
}

function buildModuleError(error: unknown, fallbackTitle: string, fallbackDetail: string): ModuleError {
  if (error instanceof ApiError) {
    if (error.status === 400) {
      return {
        title: '分析窗口无效',
        detail: '分析窗口无效，请刷新后重试。',
        status: 400,
      };
    }

    if (error.status === 422) {
      return {
        title: fallbackTitle,
        detail: '当前窗口数据不足，建议切换到更长窗口后重试。',
        status: 422,
      };
    }

    if (error.status === 500) {
      return {
        title: '分析计算失败',
        detail: '服务端未能完成本次分析，请稍后重试。',
        status: 500,
      };
    }

    return {
      title: fallbackTitle,
      detail: error.message || fallbackDetail,
      status: error.status,
    };
  }

  if (error instanceof Error) {
    return {
      title: fallbackTitle,
      detail: error.message || fallbackDetail,
      status: null,
    };
  }

  return {
    title: fallbackTitle,
    detail: fallbackDetail,
    status: null,
  };
}

function getAgentCacheKey(window: AnalysisWindow) {
  return `${agentCachePrefix}:${window}`;
}

function readAgentAnalysisCache(window: AnalysisWindow): AgentAnalysisCacheRecord | null {
  if (typeof globalThis.localStorage === 'undefined') {
    return null;
  }

  try {
    const raw = globalThis.localStorage.getItem(getAgentCacheKey(window));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<AgentAnalysisCacheRecord>;
    if (!parsed.generatedAt || !parsed.value) {
      return null;
    }
    const generatedAt = new Date(parsed.generatedAt).getTime();
    if (Number.isNaN(generatedAt) || Date.now() - generatedAt > agentCacheTTL) {
      globalThis.localStorage.removeItem(getAgentCacheKey(window));
      return null;
    }
    return parsed as AgentAnalysisCacheRecord;
  } catch {
    return null;
  }
}

function writeAgentAnalysisCache(window: AnalysisWindow, value: AgentPromptResponse) {
  if (typeof globalThis.localStorage === 'undefined') {
    return;
  }

  const record: AgentAnalysisCacheRecord = {
    generatedAt: new Date().toISOString(),
    value,
  };
  try {
    globalThis.localStorage.setItem(getAgentCacheKey(window), JSON.stringify(record));
  } catch {
    // 缓存失败不影响页面主流程。
  }
}

function removeAgentAnalysisCache(window: AnalysisWindow) {
  if (typeof globalThis.localStorage === 'undefined') {
    return;
  }
  try {
    globalThis.localStorage.removeItem(getAgentCacheKey(window));
  } catch {
    // 缓存删除失败不影响手动刷新。
  }
}

function buildAgentPrompt(window: AnalysisWindow) {
  return [
    `请分析近 ${formatWindowLabel(window)} 的 AI 主题与金融市场联动。`,
    '必须同时使用 ai_daily_snapshots、precious_metal_snapshots、tech_market_snapshots 三类数据。',
    '请输出结论、依据、异常点和建议。',
  ].join('\n');
}

export function AnalysisPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialWindow = (() => {
    const value = searchParams.get('window');
    return value === '1d' || value === '7d' || value === '30d' ? value : '7d';
  })();
  const [selectedWindow, setSelectedWindow] = useState<AnalysisWindow>(initialWindow);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [copyingLink, setCopyingLink] = useState(false);
  const [aiTrend, setAITrend] = useState<AITrendAnalysisResponse | null>(null);
  const [marketTrend, setMarketTrend] = useState<MarketTrendAnalysisResponse | null>(null);
  const [overview, setOverview] = useState<OverviewAnalysisResponse | null>(null);
  const [aiTrendError, setAITrendError] = useState<ModuleError | null>(null);
  const [marketTrendError, setMarketTrendError] = useState<ModuleError | null>(null);
  const [overviewError, setOverviewError] = useState<ModuleError | null>(null);
  const [agentAnalysis, setAgentAnalysis] = useState<AgentPromptResponse | null>(null);
  const [agentError, setAgentError] = useState<ModuleError | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);
  const [agentRefreshing, setAgentRefreshing] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const value = searchParams.get('window');
    const nextWindow: AnalysisWindow = value === '1d' || value === '7d' || value === '30d' ? value : '7d';
    setSelectedWindow((current) => (current === nextWindow ? current : nextWindow));
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selectedWindow === '7d') {
      next.delete('window');
    } else {
      next.set('window', selectedWindow);
    }

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [selectedWindow, searchParams, setSearchParams]);

  useEffect(() => {
    void loadAnalysis(selectedWindow, false);
  }, [selectedWindow]);

  async function loadAnalysis(nextWindow: AnalysisWindow, isRefresh: boolean) {
    const requestID = requestRef.current + 1;
    requestRef.current = requestID;

    setMessage('');
    setAITrendError(null);
    setMarketTrendError(null);
    setOverviewError(null);
    setAgentError(null);

    const cachedAgentAnalysis = readAgentAnalysisCache(nextWindow);
    if (cachedAgentAnalysis) {
      setAgentAnalysis(cachedAgentAnalysis.value);
      setAgentLoading(false);
    } else {
      setAgentLoading(true);
    }

    if (!isRefresh) {
      setOverview(null);
      setAITrend(null);
      setMarketTrend(null);
      if (!cachedAgentAnalysis) {
        setAgentAnalysis(null);
      }
    }

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const agentRequest = cachedAgentAnalysis
        ? Promise.resolve(cachedAgentAnalysis.value)
        : askAgentAnalysis({
          prompt: buildAgentPrompt(nextWindow),
          context: {
            window: nextWindow,
            source: 'analysis-page',
          },
          db_scope: 'auto',
        });
      const [overviewResult, aiTrendResult, marketTrendResult, agentResult] = await Promise.allSettled([
        getOverview(nextWindow),
        getAITrend(nextWindow),
        getMarketTrend(nextWindow),
        agentRequest,
      ]);

      if (requestID !== requestRef.current) {
        return;
      }

      let failedCount = 0;

      if (overviewResult.status === 'fulfilled') {
        setOverview(overviewResult.value);
      } else {
        failedCount += 1;
        setOverview(null);
        setOverviewError(buildModuleError(overviewResult.reason, '综合结论暂不可用', '综合分析加载失败。'));
      }

      if (aiTrendResult.status === 'fulfilled') {
        setAITrend(aiTrendResult.value);
      } else {
        failedCount += 1;
        setAITrend(null);
        setAITrendError(buildModuleError(aiTrendResult.reason, 'AI 趋势数据不足', 'AI 趋势加载失败。'));
      }

      if (marketTrendResult.status === 'fulfilled') {
        setMarketTrend(marketTrendResult.value);
      } else {
        failedCount += 1;
        setMarketTrend(null);
        setMarketTrendError(buildModuleError(marketTrendResult.reason, '市场趋势数据不足', '市场趋势加载失败。'));
      }

      if (agentResult.status === 'fulfilled') {
        setAgentAnalysis(agentResult.value);
        if (!cachedAgentAnalysis) {
          writeAgentAnalysisCache(nextWindow, agentResult.value);
        }
      } else {
        failedCount += 1;
        setAgentAnalysis(null);
        setAgentError(buildModuleError(agentResult.reason, 'Agent 分析暂不可用', 'Agent 分析加载失败。'));
      }

      if (failedCount === 4) {
        setMessage('当前分析模块都未返回可用结果，请稍后重试或切换到更长窗口。');
      }
    } finally {
      if (requestID === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
        setAgentLoading(false);
      }
    }
  }

  async function handleRefreshAgentAnalysis() {
    if (agentRefreshing) {
      return;
    }
    removeAgentAnalysisCache(selectedWindow);
    setAgentLoading(true);
    setAgentRefreshing(true);
    setAgentError(null);
    setAgentAnalysis(null);
    setMessage('正在重新请求 LLM 回答...');
    try {
      const result = await askAgentAnalysis({
        prompt: buildAgentPrompt(selectedWindow),
        context: {
          window: selectedWindow,
          source: 'analysis-page',
          refresh: true,
        },
        db_scope: 'auto',
      });
      if (result.error) {
        throw new Error(result.error);
      }
      setAgentAnalysis(result);
      writeAgentAnalysisCache(selectedWindow, result);
      setMessage('LLM 回答已刷新');
    } catch (error) {
      setAgentError(buildModuleError(error, 'Agent 分析暂不可用', 'Agent 分析刷新失败。'));
      setMessage('');
    } finally {
      setAgentLoading(false);
      setAgentRefreshing(false);
    }
  }

  const generatedAt = useMemo(() => {
    return [overview?.generatedAt, aiTrend?.generatedAt, marketTrend?.generatedAt].filter((value): value is string => Boolean(value)).sort().reverse()[0] ?? '';
  }, [overview?.generatedAt, aiTrend?.generatedAt, marketTrend?.generatedAt]);

  const pageBusy = loading || refreshing;
  const overviewEvidence = overview?.evidence ?? [];
  const overviewHighlights = overview
    ? [
        ...overview.keyAgreements.slice(0, 2).map((item) => ({ label: '一致', text: item, tone: 'positive' as const })),
        ...overview.keyTensions.slice(0, 2).map((item) => ({ label: '张力', text: item, tone: 'warning' as const })),
      ].slice(0, 4)
    : [];
  const overviewWatchItems = overview ? [...overviewEvidence.slice(0, 1).map((item) => item.note), ...overview.risks].slice(0, 3) : [];
  const overviewTagSummary = overview?.linkageTags.slice(0, 2).map(formatLinkageTag).join(' · ') ?? '';
  const overviewStatusNote = overview
    ? [
        overviewTagSummary ? `联动标签：${overviewTagSummary}` : '',
        overview.dataStatus.partial ? '当前为部分降级模式' : '',
      ]
        .filter(Boolean)
        .join('，') || '当前没有额外的联动标签或降级提示。'
    : '';
  const overviewAISummary = overview
    ? `${overview.aiTrend.summary}${overview.aiTrend.dominantThemes.length > 0 ? ` · ${overview.aiTrend.dominantThemes.map(formatThemeLabel).slice(0, 2).join(' / ')}` : ''}`
    : '--';
  const overviewMarketSummary = overview
    ? `${formatMarketRegimeLabel(overview.marketTrend.marketRegime)} · ${overview.marketTrend.summary}`
    : '--';
  const aiTopThemes = aiTrend?.dominantThemes.slice(0, 2) ?? [];
  const aiEmergingTheme = aiTrend?.emergingThemes[0] ?? null;
  const aiSignalSummary = aiTrend?.headlineSignals.slice(0, 2) ?? [];
  const aiWatchItems = aiTrend ? [...aiTrend.risks, aiTrend.dataStatus.note].filter(Boolean).slice(0, 2) : [];
  const marketLeaderHighlights = marketTrend?.leaders.slice(0, 2) ?? [];
  const marketLaggingHighlights = marketTrend?.laggards.slice(0, 2) ?? [];
  const marketDirectionHighlights = [
    ...marketLeaderHighlights.map((item) => ({ label: '领涨', symbol: item.symbol, change: formatChangePercent(item.changePercent), tone: 'positive' as const })),
    ...marketLaggingHighlights.map((item) => ({ label: '偏弱', symbol: item.symbol, change: formatChangePercent(item.changePercent), tone: 'warning' as const })),
  ].slice(0, 4);
  const marketWatchItems = marketTrend ? [...marketTrend.risks, marketTrend.dataStatus.note].filter(Boolean).slice(0, 2) : [];
  const agentSources = agentAnalysis?.sources ?? [];
  const agentSummary = agentAnalysis?.answer?.trim() || '';
  const agentQuerySummary = agentAnalysis?.query_summary?.trim() || '';
  const heroSummary = useMemo(() => {
    if (overview) {
      const state = overview.dataStatus.sufficient ? '样本相对充分' : '样本偏少';
      const partial = overview.dataStatus.partial ? '，当前为部分降级模式。' : '。';
      return `${state}，AI 样本 ${overview.dataStatus.aiSampleCount} 篇，市场覆盖 ${overview.dataStatus.coveredSymbols.length} / ${overview.dataStatus.expectedSymbols.length}${partial}`;
    }

    if (aiTrend || marketTrend) {
      const aiPart = aiTrend ? `AI 样本 ${aiTrend.dataStatus.sampleCount} 篇` : '';
      const marketPart = marketTrend ? `市场覆盖 ${marketTrend.dataStatus.coveredSymbols.length} / ${marketTrend.dataStatus.expectedSymbols.length}` : '';
      return [aiPart, marketPart].filter(Boolean).join('，');
    }

    return '当前暂无可展示的分析摘要。';
  }, [overview, aiTrend, marketTrend]);

  function handleRetry() {
    void loadAnalysis(selectedWindow, true);
  }

  async function handleCopyLink() {
    if (typeof window === 'undefined') {
      return;
    }

    setCopyingLink(true);
    try {
      await navigator.clipboard.writeText(globalThis.location.href);
      setMessage('当前分析链接已复制');
    } catch {
      setMessage('复制链接失败，请手动复制地址栏');
    } finally {
      setCopyingLink(false);
    }
  }

  return (
    <section className="content whisper-content analysis-page-shell">
      <div className="cont w1000 analysis-page-container">
        <section className="analysis-hero-panel">
          <div className="analysis-hero-copy">
            <span className="analysis-hero-kicker">分析摘要</span>
            <h1>AI 联动判断</h1>
            <p>只保留结论、关键线索和少量提醒。</p>
          </div>

          <div className="analysis-hero-controls">
            <div className="analysis-hero-meta">
              <div className="analysis-hero-meta-row">
                <span>当前窗口：{formatWindowLabel(selectedWindow)}</span>
                <span>最近生成：{generatedAt ? formatDateTime(generatedAt) : '--'}</span>
              </div>
              <p>{heroSummary}</p>
            </div>

            <div className="analysis-hero-actions">
              <div className="analysis-window-switcher" aria-label="分析窗口切换">
                {analysisWindows.map((option) => (
                  <button
                    className={`analysis-window-button${option === selectedWindow ? ' is-active' : ''}`}
                    disabled={pageBusy && option === selectedWindow}
                    key={formatWindowLabel(option)}
                    onClick={() => setSelectedWindow(option)}
                    type="button"
                  >
                    {formatWindowLabel(option)}
                  </button>
                ))}
              </div>

              <div className="analysis-hero-action-row">
                <button className="legacy-action-button secondary" disabled={pageBusy} onClick={() => void loadAnalysis(selectedWindow, true)} type="button">
                  {refreshing ? '刷新中...' : '刷新分析'}
                </button>
                <button className="legacy-action-button secondary" disabled={copyingLink} onClick={() => void handleCopyLink()} type="button">
                  {copyingLink ? '复制中...' : '复制链接'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {message ? <div className="legacy-feedback analysis-page-feedback">{message}</div> : null}
        {loading ? <div className="legacy-feedback analysis-page-feedback">正在加载分析结果...</div> : null}

        <section className="analysis-panel analysis-panel-agent">
          <div className="analysis-panel-head">
            <div>
              <span className="analysis-panel-kicker">Agent 智能分析</span>
              <h2>数据库驱动判断</h2>
              <p>1 小时内复用上次结果，也可以手动刷新 LLM 回答。</p>
            </div>
            <div className="analysis-panel-badges">
              <span className="analysis-chip-badge is-confidence">{agentRefreshing ? '刷新中' : agentLoading ? '加载中' : agentAnalysis ? '已生成' : '未生成'}</span>
              {agentSources.length > 0 ? <span className="analysis-chip-badge is-mixed">{agentSources.length} 个来源</span> : null}
            </div>
          </div>

          <div className="analysis-panel-action-row">
            <button className="legacy-action-button secondary small" disabled={agentRefreshing} onClick={() => void handleRefreshAgentAnalysis()} type="button">
              {agentRefreshing ? '刷新中...' : '刷新 LLM 回答'}
            </button>
          </div>

          {agentError ? (
            <div className="analysis-panel-error">
              <strong>{agentError.title}</strong>
              <p>{agentError.detail}</p>
              <button className="legacy-action-button secondary small" disabled={pageBusy} onClick={handleRetry} type="button">
                {refreshing ? '重试中...' : '重试'}
              </button>
            </div>
          ) : null}

          {agentAnalysis ? (
            <div className="analysis-panel-body">
              <p className="analysis-panel-summary">{agentSummary || 'Agent 未返回可读结论。'}</p>
              {agentQuerySummary ? (
                <div className="analysis-risk-block">
                  <span className="analysis-list-label">查询摘要</span>
                  <p className="analysis-inline-note">{agentQuerySummary}</p>
                </div>
              ) : null}
              {agentSources.length > 0 ? (
                <div className="analysis-risk-block">
                  <span className="analysis-list-label">来源表</span>
                  <ul className="analysis-list analysis-list-muted">
                    {agentSources.map((item) => (
                      <li key={item.table ?? item.sql ?? item.columns.join(',')}>
                        {item.table ?? item.sql ?? '查询结果'} · {item.columns.length} 列 · {item.rows.length} 行结果
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <div className="analysis-page-grid">
          <section className="analysis-panel analysis-panel-overview">
            <div className="analysis-panel-head">
              <div>
                <span className="analysis-panel-kicker">综合判断</span>
                <h2>综合结论</h2>
                <p>判断 AI 叙事与市场风险偏好是否同向。</p>
              </div>
              {overview ? (
                <div className="analysis-panel-badges">
                  <span className={`analysis-chip-badge is-${overview.alignment}`}>{formatAlignmentLabel(overview.alignment)}</span>
                  <span className="analysis-chip-badge is-confidence">{formatConfidenceLabel(overview.confidence)}</span>
                  {overview.dataStatus.partial ? <span className="analysis-chip-badge is-warning">部分降级</span> : null}
                </div>
              ) : null}
            </div>

            {overviewError ? (
              <div className="analysis-panel-error">
                <strong>{overviewError.title}</strong>
                <p>{overviewError.detail}</p>
                {overviewError.status === 422 ? <span className="analysis-panel-hint">尝试切换到近 7 天或近 30 天观察更完整的样本。</span> : null}
                <button className="legacy-action-button secondary small" disabled={pageBusy} onClick={handleRetry} type="button">
                  {refreshing ? '重试中...' : '重试'}
                </button>
                {overviewError.status === 422 ? <span className="analysis-panel-hint">后台同步补齐 AI 日报和市场数据后，这里会自动恢复。</span> : null}
              </div>
            ) : null}

            {overview ? (
              <div className="analysis-panel-body">
                <p className="analysis-panel-summary">{overview.summary}</p>

                <div className="analysis-copy-block">
                  <span className="analysis-list-label">四条判断线索</span>
                  {overviewHighlights.length > 0 ? (
                    <div className="analysis-signal-list">
                      {overviewHighlights.map((item) => (
                        <article className={`analysis-signal-item is-${item.tone}`} key={`${item.label}-${item.text}`}>
                          <span>{item.label}</span>
                          <strong>{item.text}</strong>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="analysis-list-empty">当前还没有足够明确的同向或张力线索。</p>
                  )}
                </div>

                <div className="analysis-summary-pairs analysis-summary-pairs-compact">
                  <article className="analysis-summary-card">
                    <span>AI 面</span>
                    <strong>{overviewAISummary}</strong>
                  </article>
                  <article className="analysis-summary-card">
                    <span>市场面</span>
                    <strong>{overviewMarketSummary}</strong>
                  </article>
                </div>

                <div className="analysis-risk-block">
                  <span className="analysis-list-label">需要注意</span>
                  <p className="analysis-inline-note">{overviewStatusNote}</p>
                  {overviewWatchItems.length > 0 ? (
                    <ul className="analysis-list analysis-list-muted">
                      {overviewWatchItems.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className="analysis-panel">
            <div className="analysis-panel-head">
              <div>
                <span className="analysis-panel-kicker">AI 主题</span>
                <h2>AI 摘要</h2>
                <p>只保留主题重心、升温方向和少量提醒。</p>
              </div>
              {aiTrend ? (
                <div className="analysis-panel-badges">
                  <span className="analysis-chip-badge is-confidence">{formatConfidenceLabel(aiTrend.confidence)}</span>
                  {aiTrend.dataStatus.partial ? <span className="analysis-chip-badge is-warning">存在回退</span> : null}
                </div>
              ) : null}
            </div>

            {aiTrendError ? (
              <div className="analysis-panel-error">
                <strong>{aiTrendError.title}</strong>
                <p>{aiTrendError.detail}</p>
                {aiTrendError.status === 422 ? <span className="analysis-panel-hint">当前窗口样本偏少，可以直接切换到更长窗口。</span> : null}
                <button className="legacy-action-button secondary small" disabled={pageBusy} onClick={handleRetry} type="button">
                  {refreshing ? '重试中...' : '重试'}
                </button>
                {aiTrendError.status === 422 ? <span className="analysis-panel-hint">后台 AI 日报同步完成后，这里会自动恢复。</span> : null}
              </div>
            ) : null}

            {aiTrend ? (
              <div className="analysis-panel-body">
                <p className="analysis-panel-summary">{aiTrend.summary}</p>

                <div className="analysis-summary-pairs analysis-summary-pairs-compact">
                  <article className="analysis-summary-card">
                    <span>主导主题</span>
                    <strong>{aiTopThemes.map((item) => formatThemeLabel(item.theme)).join(' / ') || '--'}</strong>
                    <p>{aiTopThemes.length > 0 ? `合计 ${aiTopThemes.reduce((sum, item) => sum + item.count, 0)} 篇命中` : '当前没有明显集中的主导主题。'}</p>
                  </article>

                  <article className="analysis-summary-card">
                    <span>升温主题</span>
                    <strong>{aiEmergingTheme ? formatThemeLabel(aiEmergingTheme.theme) : '暂无明显升温'}</strong>
                    <p>{aiEmergingTheme ? `${aiEmergingTheme.count} 篇命中，${formatEmergingReason(aiEmergingTheme.reason)}` : '当前窗口后半段未形成明显升温。'}</p>
                  </article>
                </div>

                <div className="analysis-risk-block">
                  <span className="analysis-list-label">需要注意</span>
                  <p className="analysis-inline-note">
                    样本数 {aiTrend.dataStatus.sampleCount}，观察窗口 {aiTrend.dataStatus.windowStart} - {aiTrend.dataStatus.windowEnd}。
                  </p>
                  {aiSignalSummary.length > 0 ? (
                    <ul className="analysis-list">
                      {aiSignalSummary.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                  {aiWatchItems.length > 0 ? (
                    <ul className="analysis-list analysis-list-muted">
                      {aiWatchItems.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className="analysis-panel">
            <div className="analysis-panel-head">
              <div>
                <span className="analysis-panel-kicker">市场信号</span>
                <h2>市场摘要</h2>
                <p>只看方向、强弱和少量提醒。</p>
              </div>
              {marketTrend ? (
                <div className="analysis-panel-badges">
                  <span className={`analysis-chip-badge is-${marketTrend.marketRegime}`}>{formatMarketRegimeLabel(marketTrend.marketRegime)}</span>
                  <span className="analysis-chip-badge is-confidence">{formatConfidenceLabel(marketTrend.confidence)}</span>
                  {marketTrend.dataStatus.partial ? <span className="analysis-chip-badge is-warning">部分成功</span> : null}
                </div>
              ) : null}
            </div>

            {marketTrendError ? (
              <div className="analysis-panel-error">
                <strong>{marketTrendError.title}</strong>
                <p>{marketTrendError.detail}</p>
                {marketTrendError.status === 422 ? <span className="analysis-panel-hint">如果窗口过短，科技或贵金属快照可能不足以形成可比较区间。</span> : null}
                <button className="legacy-action-button secondary small" disabled={pageBusy} onClick={handleRetry} type="button">
                  {refreshing ? '重试中...' : '重试'}
                </button>
                {marketTrendError.status === 422 ? <span className="analysis-panel-hint">后台市场同步完成后，这里会自动恢复。</span> : null}
              </div>
            ) : null}

            {marketTrend ? (
              <div className="analysis-panel-body">
                <p className="analysis-panel-summary">{marketTrend.summary}</p>

                <div className="analysis-summary-pairs analysis-summary-pairs-compact">
                  <article className="analysis-summary-card">
                    <span>科技动量</span>
                    <strong>{formatChangePercent(marketTrend.techMomentum.averageChangePercent)}</strong>
                    <p>上涨 {marketTrend.techMomentum.advancers} / 下跌 {marketTrend.techMomentum.decliners}</p>
                  </article>

                  <article className="analysis-summary-card">
                    <span>避险动量</span>
                    <strong>{formatChangePercent(marketTrend.safeHavenMomentum.averageChangePercent)}</strong>
                    <p>上涨 {marketTrend.safeHavenMomentum.advancers} / 下跌 {marketTrend.safeHavenMomentum.decliners}</p>
                  </article>
                </div>

                <div className="analysis-risk-block">
                  <span className="analysis-list-label">需要注意</span>
                  <p className="analysis-inline-note">
                    科技覆盖 {marketTrend.dataStatus.techCoveredSymbolCount}，贵金属覆盖 {marketTrend.dataStatus.metalCoveredSymbolCount}，总覆盖 {marketTrend.dataStatus.coveredSymbols.length} / {marketTrend.dataStatus.expectedSymbols.length}。
                  </p>
                  {marketDirectionHighlights.length > 0 ? (
                    <div className="analysis-signal-list analysis-signal-list-compact">
                      {marketDirectionHighlights.map((item) => (
                        <article className={`analysis-signal-item is-${item.tone}`} key={`${item.label}-${item.symbol}-${item.change}`}>
                          <span>{item.label}</span>
                          <strong>{item.symbol}</strong>
                          <p>{item.change}</p>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  {marketWatchItems.length > 0 ? (
                    <ul className="analysis-list analysis-list-muted">
                      {marketWatchItems.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </section>
  );
}
