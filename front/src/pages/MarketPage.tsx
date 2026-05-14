import { useEffect, useMemo, useState } from 'react';

import { getPreciousMetalMarket, getTechMarket, syncPreciousMetalMarket, syncTechMarket } from '../api/forum';
import { useSession } from '../lib/session';
import type { PreciousMetalMarketRecord, PreciousMetalPoint, TechMarketPoint, TechMarketRecord } from '../types/api';

const historyRangeOptions = [12, 24, 48, 96, 192] as const;

type HistoryRangeOption = (typeof historyRangeOptions)[number];

type MarketConsoleType = 'precious-metals' | 'ai-tech';

type TechCategoryFilter = 'all' | 'equity' | 'index' | 'etf';

type UnifiedMarketRecord = {
  category?: string;
  symbol: string;
  name: string;
  sourceUrl: string;
  price: string;
  change: string;
  changePercent: string;
  prevClose: string;
  open: string;
  bid: string;
  ask: string;
  dayRange: string;
  week52Range: string;
  volume: string;
  avgVolume: string;
  lastUpdateText: string;
  fetchedAt: string;
  history: Array<PreciousMetalPoint | TechMarketPoint>;
  contractMonth?: string;
  settlementDate?: string;
  tickSize?: string;
  contractSize?: string;
  tickValue?: string;
  baseUnit?: string;
  marketCap?: string;
  peRatio?: string;
  beta?: string;
  eps?: string;
  dividend?: string;
  yield?: string;
};

type ChartPoint = {
  x: number;
  y: number;
  price: number;
  fetchedAt: string;
};

type ChartModel = {
  path: string;
  areaPath: string;
  min: number | null;
  max: number | null;
  first: number | null;
  latest: number | null;
  markers: ChartPoint[];
  points: ChartPoint[];
};

const emptyChartModel: ChartModel = {
  path: '',
  areaPath: '',
  min: null,
  max: null,
  first: null,
  latest: null,
  markers: [],
  points: [],
};

function toNumericPrice(value: string) {
  const normalized = value.replace(/,/g, '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatChartTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || '--';
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(
    2,
    '0',
  )}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function formatElapsedTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 1) {
    return '刚刚同步';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前同步`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前同步`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} 天前同步`;
}

function formatSignedNumber(value: number | null, digits = 2) {
  if (value === null || Number.isNaN(value)) {
    return '--';
  }
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toFixed(digits)}`;
}

function formatSignedPercent(value: number | null, digits = 2) {
  if (value === null || Number.isNaN(value)) {
    return '--';
  }
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toFixed(digits)}%`;
}

function parseSignedPercent(value: string) {
  const normalized = value.replace(/%/g, '').replace(/,/g, '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRange(value: string) {
  const parts = value
    .split('-')
    .map((part) => toNumericPrice(part))
    .filter((part): part is number => part !== null);

  if (parts.length !== 2) {
    return null;
  }

  const min = Math.min(parts[0], parts[1]);
  const max = Math.max(parts[0], parts[1]);
  return { min, max, span: max - min };
}

function buildLinePath(history: Array<PreciousMetalPoint | TechMarketPoint>): ChartModel {
  const numericHistory = history
    .map((point) => ({ ...point, numericPrice: toNumericPrice(point.price) }))
    .filter((point): point is PreciousMetalPoint & { numericPrice: number } => point.numericPrice !== null);

  if (numericHistory.length < 2) {
    return emptyChartModel;
  }

  const width = 760;
  const height = 280;
  const min = Math.min(...numericHistory.map((point) => point.numericPrice));
  const max = Math.max(...numericHistory.map((point) => point.numericPrice));
  const diff = Math.max(1e-6, max - min);

  const points = numericHistory.map((point, index) => {
    const x = (index / Math.max(1, numericHistory.length - 1)) * width;
    const y = height - ((point.numericPrice - min) / diff) * height;
    return { x, y, price: point.numericPrice, fetchedAt: point.fetchedAt };
  });

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const areaPath = `${path} L ${width} ${height} L 0 ${height} Z`;
  const markerIndexes = Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));

  return {
    path,
    areaPath,
    min,
    max,
    first: numericHistory[0]?.numericPrice ?? null,
    latest: numericHistory[numericHistory.length - 1]?.numericPrice ?? null,
    markers: markerIndexes.map((index) => points[index]),
    points,
  };
}

export function MarketPage() {
  const session = useSession();
  const [marketType, setMarketType] = useState<MarketConsoleType>('precious-metals');
  const [records, setRecords] = useState<UnifiedMarketRecord[]>([]);
  const [activeSymbol, setActiveSymbol] = useState('XAU');
  const [techCategoryFilter, setTechCategoryFilter] = useState<TechCategoryFilter>('all');
  const [historyLimit, setHistoryLimit] = useState<HistoryRangeOption>(48);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [priming, setPriming] = useState(false);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);

  useEffect(() => {
    void loadMarket();
  }, [historyLimit, marketType]);

  async function loadMarket() {
    setLoading(true);
    setMessage('');
    try {
      const result = marketType === 'precious-metals' ? await getPreciousMetalMarket(historyLimit) : await getTechMarket(historyLimit);
      setRecords(result.records);
      setUpdatedAt(result.updatedAt);
      if (result.records.length > 0 && !result.records.some((record) => record.symbol === activeSymbol)) {
        setActiveSymbol(result.records[0].symbol);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载市场动态失败');
    } finally {
      setLoading(false);
    }
  }

  const visibleRecords = useMemo(() => {
    if (marketType !== 'ai-tech' || techCategoryFilter === 'all') {
      return records;
    }
    return records.filter((record) => record.category === techCategoryFilter);
  }, [marketType, records, techCategoryFilter]);

  const activeRecord = useMemo(() => visibleRecords.find((record) => record.symbol === activeSymbol) ?? visibleRecords[0] ?? null, [activeSymbol, visibleRecords]);

  const chartModel = useMemo(() => (activeRecord ? buildLinePath(activeRecord.history) : emptyChartModel), [activeRecord]);

  useEffect(() => {
    setHoveredPointIndex(null);
  }, [activeSymbol, historyLimit, updatedAt]);

  const trendSummary = useMemo(() => {
    if (!activeRecord) {
      return null;
    }

    const numericHistory = activeRecord.history.map((point) => toNumericPrice(point.price)).filter((value): value is number => value !== null);
    if (numericHistory.length === 0) {
      return {
        direction: 'flat' as const,
        delta: null,
        deltaPercent: null,
        amplitude: null,
      };
    }

    const first = numericHistory[0];
    const latest = numericHistory[numericHistory.length - 1];
    const delta = latest - first;
    const deltaPercent = Math.abs(first) > 1e-6 ? (delta / first) * 100 : null;
    const amplitude = Math.max(...numericHistory) - Math.min(...numericHistory);

    return {
      direction: delta > 0 ? ('up' as const) : delta < 0 ? ('down' as const) : ('flat' as const),
      delta,
      deltaPercent,
      amplitude,
    };
  }, [activeRecord]);

  const trendCopy =
    trendSummary?.direction === 'up'
      ? '走势抬升，价格曲线正在向上推进。'
      : trendSummary?.direction === 'down'
        ? '走势回撤，价格曲线处在回落通道。'
        : '走势横盘，当前价格保持相对平稳。';

  const focusPoint = hoveredPointIndex !== null ? chartModel.points[hoveredPointIndex] ?? null : chartModel.points[chartModel.points.length - 1] ?? null;

  const stageRecords = visibleRecords.slice(0, 4);

  const bidPrice = activeRecord ? toNumericPrice(activeRecord.bid) : null;
  const askPrice = activeRecord ? toNumericPrice(activeRecord.ask) : null;
  const spreadValue = bidPrice !== null && askPrice !== null ? askPrice - bidPrice : null;
  const dayRange = activeRecord ? parseRange(activeRecord.dayRange) : null;
  const rangePosition = activeRecord && dayRange ? (() => {
    const current = toNumericPrice(activeRecord.price);
    if (current === null || dayRange.span <= 1e-6) {
      return null;
    }
    return Math.max(0, Math.min(100, ((current - dayRange.min) / dayRange.span) * 100));
  })() : null;
  const spotlightMeta = marketType === 'precious-metals'
    ? [
        { label: '当前合约', value: activeRecord?.contractMonth || '--' },
        { label: '同步状态', value: activeRecord ? formatElapsedTime(activeRecord.fetchedAt) : '--' },
        { label: '买卖差', value: spreadValue !== null ? spreadValue.toFixed(3) : '--' },
        { label: '基础单位', value: activeRecord?.baseUnit || '--' },
      ]
    : [
        { label: '市场分类', value: activeRecord?.category || '--' },
        { label: '同步状态', value: activeRecord ? formatElapsedTime(activeRecord.fetchedAt) : '--' },
        { label: '市值', value: activeRecord?.marketCap || '--' },
        { label: '市盈率', value: activeRecord?.peRatio || '--' },
      ];

  const marketOverview = useMemo(() => {
    if (visibleRecords.length === 0) {
      return [] as Array<{ label: string; primary: string; secondary: string; tone?: 'up' | 'down' | 'flat' }>;
    }

    const enriched = visibleRecords.map((record) => {
      const numericChangePercent = parseSignedPercent(record.changePercent);
      const numericPrice = toNumericPrice(record.price);
      const numericHistory = record.history.map((point) => toNumericPrice(point.price)).filter((value): value is number => value !== null);
      const amplitude = numericHistory.length > 0 ? Math.max(...numericHistory) - Math.min(...numericHistory) : null;
      return {
        record,
        numericChangePercent,
        numericPrice,
        amplitude,
      };
    });

    const strongest = [...enriched].sort((a, b) => Math.abs(b.numericChangePercent ?? -1) - Math.abs(a.numericChangePercent ?? -1))[0];
    const highestPrice = [...enriched].sort((a, b) => (b.numericPrice ?? -1) - (a.numericPrice ?? -1))[0];
    const widestSwing = [...enriched].sort((a, b) => (b.amplitude ?? -1) - (a.amplitude ?? -1))[0];
    const freshest = [...visibleRecords].sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime())[0];

    return [
      {
        label: '波动最强',
        primary: strongest ? `${strongest.record.name} ${strongest.record.changePercent || '--'}` : '--',
        secondary: strongest?.record.change || '当前无变化数据',
        tone:
          (strongest?.numericChangePercent ?? 0) > 0 ? 'up' : (strongest?.numericChangePercent ?? 0) < 0 ? 'down' : 'flat',
      },
      {
        label: '价格最高',
        primary: highestPrice ? `${highestPrice.record.name} ${highestPrice.record.price || '--'}` : '--',
        secondary: marketType === 'precious-metals' ? highestPrice?.record.baseUnit || '暂无基础单位' : highestPrice?.record.marketCap || '暂无市值信息',
      },
      {
        label: '区间最宽',
        primary: widestSwing ? `${widestSwing.record.name} ${widestSwing.amplitude?.toFixed(3) ?? '--'}` : '--',
        secondary: widestSwing ? `观察窗口 ${historyLimit} 点` : '暂无窗口数据',
      },
      {
        label: '最新同步',
        primary: freshest ? `${freshest.name} ${formatElapsedTime(freshest.fetchedAt)}` : '--',
        secondary: freshest ? formatUpdatedAt(freshest.fetchedAt) : '暂无同步时间',
      },
    ];
  }, [historyLimit, marketType, visibleRecords]);

  useEffect(() => {
    if (marketType !== 'ai-tech') {
      return;
    }
    if (visibleRecords.length > 0 && !visibleRecords.some((record) => record.symbol === activeSymbol)) {
      setActiveSymbol(visibleRecords[0].symbol);
    }
  }, [activeSymbol, marketType, visibleRecords]);

  function handleChartPointerMove(clientX: number, svgWidth: number) {
    if (chartModel.points.length === 0 || svgWidth <= 0) {
      return;
    }
    const ratio = Math.max(0, Math.min(1, clientX / svgWidth));
    const index = Math.round(ratio * (chartModel.points.length - 1));
    setHoveredPointIndex(index);
  }

  async function runManualSync(rounds = 1, intervalMs = 800) {
    if (marketType === 'precious-metals') {
      return syncPreciousMetalMarket(rounds, intervalMs);
    }
    return syncTechMarket(rounds, intervalMs);
  }

  async function handleManualSync() {
    if (!session || syncing || priming) {
      return;
    }

    setSyncing(true);
    setMessage('');
    try {
      const result = await runManualSync();
      const failedCopy = result.partial && result.failedSymbols.length > 0 ? `；未完成：${result.failedSymbols.join('、')}` : '';
      setMessage((result.message || (marketType === 'precious-metals' ? '贵金属数据拉取完成' : 'AI / 科技市场数据拉取完成')) + failedCopy);
      await loadMarket();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : marketType === 'precious-metals' ? '贵金属数据拉取失败' : 'AI / 科技市场数据拉取失败');
    } finally {
      setSyncing(false);
    }
  }

  async function handlePrimeHistory() {
    if (!session || syncing || priming) {
      return;
    }

    setPriming(true);
    setMessage('');
    try {
      const result = await runManualSync(6, 1200);
      const failedCopy = result.partial && result.failedSymbols.length > 0 ? `；未完成：${result.failedSymbols.join('、')}` : '';
      setMessage((result.message || '历史点位补齐完成') + failedCopy);
      await loadMarket();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '历史点位补齐失败');
    } finally {
      setPriming(false);
    }
  }

  return (
    <section className="content whisper-content market-scene">
      <div className="cont w1000 market-shell">
        <div className="market-route-banner">
          <span className="market-route-badge">Market Console</span>
          <div className="market-route-copy">
            <strong>{marketType === 'precious-metals' ? '贵金属监控台' : 'AI / 科技行情台'}</strong>
            <span>
              {marketType === 'precious-metals'
                ? '从社区站内切到市场视图时，保留同一套 3D 控制台语义，但把内容层聚焦到贵金属行情观察与波动追踪。'
                : '这里集中展示与人工智能热度高度相关的高市值科技标的、指数和 ETF，方便从社区站内直接切到科技市场观察视图。'}
            </span>
          </div>
          <div className="market-route-actions">
            <div className="market-console-switch" role="tablist" aria-label="市场分类切换">
              <button className={marketType === 'precious-metals' ? 'is-active' : ''} onClick={() => setMarketType('precious-metals')} type="button">
                贵金属
              </button>
              <button className={marketType === 'ai-tech' ? 'is-active' : ''} onClick={() => setMarketType('ai-tech')} type="button">
                AI / 科技
              </button>
            </div>
            {session ? (
              <>
                <button className="legacy-action-button secondary small" disabled={syncing || priming} onClick={() => void handlePrimeHistory()} type="button">
                  {priming ? '补点中...' : '快速补历史'}
                </button>
                <button className="legacy-action-button" disabled={syncing || priming} onClick={() => void handleManualSync()} type="button">
                {syncing ? '拉取中...' : '立即拉取 / 更新'}
                </button>
              </>
            ) : (
              <span className="legacy-summary-chip">登录后可手动触发首次拉取</span>
            )}
          </div>
        </div>

        <div className="market-stage">
          <div className="market-stage-copy">
            <span className="legacy-home-stage-kicker">3X Market Deck</span>
            <h2>市场动态</h2>
            <p>
              {marketType === 'precious-metals'
                ? '这里集中展示后端定时同步下来的贵金属数据，用价格轨迹、区间波动、合约参数和关键快照把行情整理成一块可持续观察的立体监控台。'
                : '这里集中展示后端从 Investing 抓取回来的 AI / 科技市场数据，用价格曲线、波动摘要和核心估值字段整理出一块偏科技主题的市场观察面板。'}
            </p>
            <div className="legacy-summary-strip market-stage-actions">
              <span className="legacy-summary-chip">数据源：Investing</span>
              <span className="legacy-summary-chip">品种数：{visibleRecords.length}</span>
              <span className="legacy-summary-chip">观察窗口：最近 {historyLimit} 个点位</span>
              <span className="legacy-summary-chip">更新时间：{formatUpdatedAt(updatedAt)}</span>
            </div>
          </div>
          <div className="market-stage-metrics">
            <article className="legacy-home-stage-card">
              <strong>{activeRecord?.price ?? '--'}</strong>
              <span>当前价格</span>
            </article>
            <article className="legacy-home-stage-card">
              <strong>{trendSummary ? formatSignedPercent(trendSummary.deltaPercent, 2) : '--'}</strong>
              <span>窗口涨跌幅</span>
            </article>
            <article className="legacy-home-stage-card">
              <strong>{trendSummary ? formatSignedNumber(trendSummary.amplitude, 3) : '--'}</strong>
              <span>窗口振幅</span>
            </article>
          </div>
        </div>

        {!loading && stageRecords.length > 0 ? (
          <div className="market-ticker-strip">
            {stageRecords.map((record) => (
              <button
                className={`market-ticker-card${record.symbol === activeRecord?.symbol ? ' is-active' : ''}`}
                key={record.symbol}
                onClick={() => setActiveSymbol(record.symbol)}
                type="button"
              >
                <span>{record.name}</span>
                <strong>{record.price || '--'}</strong>
                <em>{record.changePercent || '--'}</em>
              </button>
            ))}
          </div>
        ) : null}

        {!loading && marketOverview.length > 0 ? (
          <div className="market-overview-grid">
            {marketOverview.map((item) => (
              <article className={`market-overview-card${item.tone ? ` market-overview-card-${item.tone}` : ''}`} key={item.label}>
                <span>{item.label}</span>
                <strong>{item.primary}</strong>
                <em>{item.secondary}</em>
              </article>
            ))}
          </div>
        ) : null}

        {message ? <div className="legacy-feedback market-feedback">{message}</div> : null}
        {loading ? <div className="legacy-feedback market-feedback">正在加载市场动态...</div> : null}

        {!loading && visibleRecords.length > 0 ? (
          <div className="market-deck">
            <aside className="market-sidebar">
              <div className="market-panel market-symbol-panel">
                <div className="market-panel-head">
                  <h3>{marketType === 'precious-metals' ? '贵金属清单' : 'AI / 科技标的清单'}</h3>
                  {marketType === 'ai-tech' ? (
                    <div className="legacy-summary-strip market-range-strip">
                      {(['all', 'equity', 'index', 'etf'] as const).map((option) => (
                        <button
                          className={`legacy-summary-chip legacy-summary-chip-button market-range-chip${techCategoryFilter === option ? ' is-active' : ''}`}
                          key={option}
                          onClick={() => setTechCategoryFilter(option)}
                          type="button"
                        >
                          {option === 'all' ? '全部' : option === 'equity' ? '个股' : option === 'index' ? '指数' : 'ETF'}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button className="legacy-action-button secondary small" onClick={() => void loadMarket()} type="button">
                      刷新展示
                    </button>
                  )}
                </div>
                <div className="market-symbol-list">
                  {visibleRecords.map((record) => (
                    <button
                      className={`market-symbol-card${record.symbol === activeRecord?.symbol ? ' is-active' : ''}`}
                      key={record.symbol}
                      onClick={() => setActiveSymbol(record.symbol)}
                      type="button"
                    >
                      <div className="market-symbol-card-head">
                        <strong>{record.name}</strong>
                        <span>{record.symbol}</span>
                      </div>
                      <div className="market-symbol-card-price">{record.price || '--'}</div>
                      <div className="market-symbol-card-meta">
                        <span>{record.change || '--'}</span>
                        <span>{record.changePercent || '--'}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </aside>

            <div className="market-main">
              {activeRecord ? (
                <>
                  <div className="market-panel market-spotlight-panel">
                    <div className="market-panel-head">
                      <div>
                        <h3>{activeRecord.name} 聚焦视图</h3>
                        <p>把当前选中品种的主状态抽离出来，先看价格位置和同步状态，再往下看曲线与合约明细。</p>
                      </div>
                      <div className="legacy-summary-strip market-spotlight-tags">
                        <span className="legacy-summary-chip">{activeRecord.symbol}</span>
                        <span className={`legacy-summary-chip market-trend-chip market-trend-chip-${trendSummary?.direction ?? 'flat'}`}>{activeRecord.changePercent || '--'}</span>
                      </div>
                    </div>
                    <div className="market-spotlight-grid">
                      <div className="market-spotlight-pricebox">
                        <strong>{activeRecord.price || '--'}</strong>
                        <span>{activeRecord.change || '--'}</span>
                        <em>{trendCopy}</em>
                        {dayRange ? (
                          <div className="market-range-meter">
                            <div className="market-range-meter-track">
                              <span className="market-range-meter-fill" style={{ width: `${rangePosition ?? 0}%` }}></span>
                            </div>
                            <div className="market-range-meter-meta">
                              <small>{dayRange.min.toFixed(3)}</small>
                              <small>日内位置 {rangePosition !== null ? `${rangePosition.toFixed(1)}%` : '--'}</small>
                              <small>{dayRange.max.toFixed(3)}</small>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="market-spotlight-meta">
                        {spotlightMeta.map((item) => (
                          <article className="market-spotlight-meta-card" key={item.label}>
                            <span>{item.label}</span>
                            <strong>{item.value}</strong>
                          </article>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="market-panel market-chart-panel">
                    <div className="market-panel-head">
                      <div>
                        <h3>{activeRecord.name} 价格走势</h3>
                        <p>{trendCopy}</p>
                      </div>
                      <div className="market-panel-tools">
                        <div className="legacy-summary-strip market-range-strip">
                          {historyRangeOptions.map((option) => (
                            <button
                              className={`legacy-summary-chip legacy-summary-chip-button market-range-chip${historyLimit === option ? ' is-active' : ''}`}
                              key={option}
                              onClick={() => setHistoryLimit(option)}
                              type="button"
                            >
                              {option} 点
                            </button>
                          ))}
                        </div>
                        <a className="legacy-action-button secondary small" href={activeRecord.sourceUrl} rel="noreferrer" target="_blank">
                          查看源页面
                        </a>
                      </div>
                    </div>
                    <div className="market-chart-shell">
                      <div className="market-chart-legend">
                        <span>高点 {chartModel.max?.toFixed(3) ?? '--'}</span>
                        <span>低点 {chartModel.min?.toFixed(3) ?? '--'}</span>
                      </div>
                      {focusPoint ? (
                        <div
                          className="market-chart-tooltip"
                          style={{
                            left: `${(focusPoint.x / 760) * 100}%`,
                            top: `${(focusPoint.y / 280) * 100}%`,
                          }}
                        >
                          <strong>{focusPoint.price.toFixed(3)}</strong>
                          <span>{formatChartTime(focusPoint.fetchedAt)}</span>
                        </div>
                      ) : null}
                      {chartModel.path ? (
                        <svg
                          className="market-chart"
                          onMouseLeave={() => setHoveredPointIndex(null)}
                          onMouseMove={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            handleChartPointerMove(event.clientX - rect.left, rect.width);
                          }}
                          onTouchMove={(event) => {
                            const touch = event.touches[0];
                            if (!touch) {
                              return;
                            }
                            const rect = event.currentTarget.getBoundingClientRect();
                            handleChartPointerMove(touch.clientX - rect.left, rect.width);
                          }}
                          role="img"
                          viewBox="0 0 760 280"
                        >
                          <defs>
                            <linearGradient id="market-area-gradient" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%" stopColor="rgba(88, 233, 255, 0.58)" />
                              <stop offset="100%" stopColor="rgba(88, 233, 255, 0.02)" />
                            </linearGradient>
                          </defs>
                          <g className="market-chart-grid">
                            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                              <line key={ratio} x1="0" x2="760" y1={(280 * ratio).toFixed(2)} y2={(280 * ratio).toFixed(2)} />
                            ))}
                          </g>
                          <path className="market-chart-area" d={chartModel.areaPath} />
                          <path className="market-chart-line" d={chartModel.path} />
                          {focusPoint ? <line className="market-chart-focus-line" x1={focusPoint.x} x2={focusPoint.x} y1="0" y2="280" /> : null}
                          <g className="market-chart-markers">
                            {chartModel.markers.map((marker) => (
                              <g key={`${marker.fetchedAt}-${marker.x.toFixed(0)}`}>
                                <circle cx={marker.x} cy={marker.y} r="5" />
                              </g>
                            ))}
                            {focusPoint ? <circle className="market-chart-focus-dot" cx={focusPoint.x} cy={focusPoint.y} r="7" /> : null}
                          </g>
                          <rect className="market-chart-hitbox" height="280" width="760" x="0" y="0" />
                        </svg>
                      ) : (
                        <div className="legacy-empty-inline">当前历史点位不足，暂时无法绘制价格曲线。</div>
                      )}
                    </div>
                    <div className="market-chart-axis">
                      <span>{activeRecord.history[0] ? formatChartTime(activeRecord.history[0].fetchedAt) : '--'}</span>
                      <span>{activeRecord.history[activeRecord.history.length - 1] ? formatChartTime(activeRecord.history[activeRecord.history.length - 1].fetchedAt) : '--'}</span>
                    </div>
                    <div className="legacy-summary-strip market-chart-stats">
                      <span className="legacy-summary-chip">最低：{chartModel.min?.toFixed(3) ?? '--'}</span>
                      <span className="legacy-summary-chip">最高：{chartModel.max?.toFixed(3) ?? '--'}</span>
                      <span className="legacy-summary-chip">最新：{chartModel.latest?.toFixed(3) ?? '--'}</span>
                      <span className="legacy-summary-chip">起点：{chartModel.first?.toFixed(3) ?? '--'}</span>
                      <span className={`legacy-summary-chip market-trend-chip market-trend-chip-${trendSummary?.direction ?? 'flat'}`}>
                        窗口变化：{trendSummary ? `${formatSignedNumber(trendSummary.delta, 3)} / ${formatSignedPercent(trendSummary.deltaPercent, 2)}` : '--'}
                      </span>
                    </div>
                  </div>

                  <div className="market-grid">
                    <section className="market-panel market-kpi-panel">
                      <div className="market-panel-head">
                        <h3>行情指标</h3>
                      </div>
                      <div className="market-kpi-grid">
                        <article className="market-kpi-card">
                          <span>前收</span>
                          <strong>{activeRecord.prevClose || '--'}</strong>
                        </article>
                        <article className="market-kpi-card">
                          <span>开盘</span>
                          <strong>{activeRecord.open || '--'}</strong>
                        </article>
                        <article className="market-kpi-card">
                          <span>买价 / 卖价</span>
                          <strong>{activeRecord.bid || '--'} / {activeRecord.ask || '--'}</strong>
                        </article>
                        <article className="market-kpi-card">
                          <span>日内区间</span>
                          <strong>{activeRecord.dayRange || '--'}</strong>
                        </article>
                        <article className="market-kpi-card">
                          <span>52 周区间</span>
                          <strong>{activeRecord.week52Range || '--'}</strong>
                        </article>
                        <article className="market-kpi-card">
                          <span>成交量 / 均量</span>
                          <strong>{activeRecord.volume || '--'} / {activeRecord.avgVolume || '--'}</strong>
                        </article>
                      </div>
                    </section>

                    <section className="market-panel market-contract-panel">
                      <div className="market-panel-head">
                        <h3>{marketType === 'precious-metals' ? '合约信息' : '估值与扩展指标'}</h3>
                      </div>
                      <div className="market-contract-list">
                        {marketType === 'precious-metals' ? (
                          <>
                            <div><span>合约月份</span><strong>{activeRecord.contractMonth || '--'}</strong></div>
                            <div><span>结算日</span><strong>{activeRecord.settlementDate || '--'}</strong></div>
                            <div><span>最小跳动</span><strong>{activeRecord.tickSize || '--'}</strong></div>
                            <div><span>合约大小</span><strong>{activeRecord.contractSize || '--'}</strong></div>
                            <div><span>跳动价值</span><strong>{activeRecord.tickValue || '--'}</strong></div>
                            <div><span>基础单位</span><strong>{activeRecord.baseUnit || '--'}</strong></div>
                          </>
                        ) : (
                          <>
                            <div><span>分类</span><strong>{activeRecord.category || '--'}</strong></div>
                            <div><span>市值</span><strong>{activeRecord.marketCap || '--'}</strong></div>
                            <div><span>市盈率</span><strong>{activeRecord.peRatio || '--'}</strong></div>
                            <div><span>Beta</span><strong>{activeRecord.beta || '--'}</strong></div>
                            <div><span>EPS</span><strong>{activeRecord.eps || '--'}</strong></div>
                            <div><span>股息 / 收益率</span><strong>{activeRecord.dividend || '--'} / {activeRecord.yield || '--'}</strong></div>
                          </>
                        )}
                        <div><span>源页更新时间</span><strong>{activeRecord.lastUpdateText || '--'}</strong></div>
                        <div><span>抓取时间</span><strong>{formatUpdatedAt(activeRecord.fetchedAt)}</strong></div>
                      </div>
                    </section>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {!loading && visibleRecords.length === 0 && !message ? (
          <div className="legacy-feedback market-feedback">
            {marketType === 'precious-metals'
              ? '当前还没有同步到贵金属数据，请先运行后端同步任务。'
              : techCategoryFilter === 'all'
                ? '当前还没有同步到 AI / 科技市场数据，请先触发同步任务。'
                : '当前筛选分类下还没有可展示的 AI / 科技市场数据。'}
          </div>
        ) : null}
      </div>
    </section>
  );
}
