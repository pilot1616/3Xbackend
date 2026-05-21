import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { getAIDailies, getPreciousMetalMarket, getTechMarket, syncAIDailies, syncPreciousMetalMarket, syncTechMarket } from '../api/forum';
import { useSession } from '../lib/session';
import type {
  AIDailyRecord,
  PreciousMetalPoint,
  TechMarketPoint,
} from '../types/api';

const historyRangeOptions = [12, 24, 48, 96, 192] as const;

const aiDailyLimitOptions = [7, 14, 21, 30] as const;

type HistoryRangeOption = (typeof historyRangeOptions)[number];
type AIDailyLimitOption = (typeof aiDailyLimitOptions)[number];

type MarketConsoleType = 'precious-metals' | 'ai-tech' | 'ai-daily';

type TechCategoryFilter = 'all' | 'equity' | 'index' | 'etf';

type AIDailySortMode = 'latest' | 'read-time' | 'sections';

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

function formatDailyDate(value: string) {
  if (!value) {
    return '--';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeDailyText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function compactDailySummary(value: string) {
  const normalized = normalizeDailyText(value);
  if (!normalized) {
    return '--';
  }

  const segments = normalized
    .split(/[。！？!?；;]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 10)
    .slice(0, 2);

  const joined = segments.length > 0 ? segments.join('。') : normalized;
  if (joined.length <= 120) {
    return joined;
  }
  return `${joined.slice(0, 120).trim()}...`;
}

function buildDailyContentBlocks(value: string) {
  const normalized = normalizeDailyText(value);
  if (!normalized) {
    return [] as string[];
  }

  const segments = normalized
    .split(/[。！？!?]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12);

  if (segments.length === 0) {
    return [normalized];
  }

  const blocks: string[] = [];
  let current = '';

  segments.forEach((segment) => {
    const next = current ? `${current}。${segment}` : segment;
    if (next.length > 120 && current) {
      blocks.push(`${current}。`);
      current = segment;
      return;
    }
    current = next;
  });

  if (current) {
    blocks.push(`${current}。`);
  }

  return blocks.slice(0, 8);
}

function buildDailyHighlights(record: AIDailyRecord | null) {
  if (!record) {
    return [] as string[];
  }

  const text = (record.summary || record.content || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return [];
  }

  const parts = text
    .split(/[。！？!?；;]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 10);

  return parts.slice(0, 3);
}

function parseReadTimeMinutes(value: string) {
  const match = value.match(/(\d+)/);
  if (!match) {
    return 0;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function MarketPage() {
  const session = useSession();
  const [marketType, setMarketType] = useState<MarketConsoleType>('precious-metals');
  const [records, setRecords] = useState<UnifiedMarketRecord[]>([]);
  const [activeSymbol, setActiveSymbol] = useState('XAU');
  const [aiDailyRecords, setAIDailyRecords] = useState<AIDailyRecord[]>([]);
  const [activeDailySlug, setActiveDailySlug] = useState('');
  const [activeDailySection, setActiveDailySection] = useState('');
  const [aiDailySearchInput, setAIDailySearchInput] = useState('');
  const [aiDailySortMode, setAIDailySortMode] = useState<AIDailySortMode>('latest');
  const [aiDailyOffset, setAIDailyOffset] = useState(0);
  const [aiDailyTotal, setAIDailyTotal] = useState(0);
  const [aiDailyHasMore, setAIDailyHasMore] = useState(false);
  const [loadingMoreDailies, setLoadingMoreDailies] = useState(false);
  const [dailySummaryExpanded, setDailySummaryExpanded] = useState(false);
  const [techCategoryFilter, setTechCategoryFilter] = useState<TechCategoryFilter>('all');
  const [historyLimit, setHistoryLimit] = useState<HistoryRangeOption>(48);
  const [aiDailyLimit, setAIDailyLimit] = useState<AIDailyLimitOption>(14);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [priming, setPriming] = useState(false);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const deferredAIDailyKeyword = useDeferredValue(aiDailySearchInput.trim());
  const loadRequestRef = useRef(0);
  const activeDailyButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (marketType === 'ai-daily') {
      setAIDailyOffset(0);
    }
  }, [aiDailyLimit, deferredAIDailyKeyword, marketType]);

  useEffect(() => {
    void loadMarket();
  }, [historyLimit, aiDailyLimit, aiDailyOffset, deferredAIDailyKeyword, marketType]);

  async function loadMarket() {
    const requestID = loadRequestRef.current + 1;
    loadRequestRef.current = requestID;

    const isLoadingMoreAIDaily = marketType === 'ai-daily' && aiDailyOffset > 0;
    if (isLoadingMoreAIDaily) {
      setLoadingMoreDailies(true);
    } else {
      setLoading(true);
    }
    setMessage('');
    try {
      if (marketType === 'ai-daily') {
        const result = await getAIDailies(aiDailyLimit, deferredAIDailyKeyword, aiDailyOffset);
        if (requestID !== loadRequestRef.current) {
          return;
        }
        setAIDailyRecords((current) => (aiDailyOffset > 0 ? [...current, ...result.records] : result.records));
        setAIDailyTotal(result.total);
        setAIDailyHasMore(result.hasMore);
        setUpdatedAt(result.updatedAt);
        const candidateRecords = aiDailyOffset > 0 ? undefined : result.records;
        if (candidateRecords && candidateRecords.length > 0 && !candidateRecords.some((record) => record.slug === activeDailySlug)) {
          setActiveDailySlug(candidateRecords[0].slug);
        }
        return;
      }

      const result = marketType === 'precious-metals' ? await getPreciousMetalMarket(historyLimit) : await getTechMarket(historyLimit);
      if (requestID !== loadRequestRef.current) {
        return;
      }
      setRecords(result.records);
      setUpdatedAt(result.updatedAt);
      if (result.records.length > 0 && !result.records.some((record) => record.symbol === activeSymbol)) {
        setActiveSymbol(result.records[0].symbol);
      }
    } catch (err) {
      if (requestID !== loadRequestRef.current) {
        return;
      }
      setMessage(err instanceof Error ? err.message : marketType === 'ai-daily' ? '加载 AI 日报失败' : '加载市场动态失败');
    } finally {
      if (requestID === loadRequestRef.current) {
        setLoading(false);
        setLoadingMoreDailies(false);
      }
    }
  }

  const visibleRecords = useMemo(() => {
    if (marketType !== 'ai-tech' || techCategoryFilter === 'all') {
      return records;
    }
    return records.filter((record) => record.category === techCategoryFilter);
  }, [marketType, records, techCategoryFilter]);

  const activeRecord = useMemo(() => visibleRecords.find((record) => record.symbol === activeSymbol) ?? visibleRecords[0] ?? null, [activeSymbol, visibleRecords]);
  const filteredAIDailyRecords = useMemo(() => {
    const next = [...aiDailyRecords];
    if (aiDailySortMode === 'read-time') {
      next.sort((a, b) => parseReadTimeMinutes(b.readTime) - parseReadTimeMinutes(a.readTime) || b.publishedDate.localeCompare(a.publishedDate));
      return next;
    }
    if (aiDailySortMode === 'sections') {
      next.sort((a, b) => b.sections.length - a.sections.length || b.publishedDate.localeCompare(a.publishedDate));
      return next;
    }
    next.sort((a, b) => b.publishedDate.localeCompare(a.publishedDate) || b.fetchedAt.localeCompare(a.fetchedAt));
    return next;
  }, [aiDailyRecords, aiDailySortMode]);
  const activeDailyRecord = useMemo(() => filteredAIDailyRecords.find((record) => record.slug === activeDailySlug) ?? filteredAIDailyRecords[0] ?? null, [activeDailySlug, filteredAIDailyRecords]);
  const activeDailyIndex = useMemo(
    () => (activeDailyRecord ? filteredAIDailyRecords.findIndex((record) => record.slug === activeDailyRecord.slug) : -1),
    [activeDailyRecord, filteredAIDailyRecords],
  );
  const previousDailyRecord = activeDailyIndex > 0 ? filteredAIDailyRecords[activeDailyIndex - 1] ?? null : null;
  const nextDailyRecord = activeDailyIndex >= 0 && activeDailyIndex < filteredAIDailyRecords.length - 1 ? filteredAIDailyRecords[activeDailyIndex + 1] ?? null : null;
  const activeDailySectionRecord = useMemo(
    () => activeDailyRecord?.sections.find((section) => section.heading === activeDailySection) ?? activeDailyRecord?.sections[0] ?? null,
    [activeDailyRecord, activeDailySection],
  );
  const activeDailySectionIndex = useMemo(
    () => (activeDailySectionRecord && activeDailyRecord ? activeDailyRecord.sections.findIndex((section) => section.heading === activeDailySectionRecord.heading) : -1),
    [activeDailyRecord, activeDailySectionRecord],
  );
  const previousDailySection = activeDailySectionIndex > 0 && activeDailyRecord ? activeDailyRecord.sections[activeDailySectionIndex - 1] ?? null : null;
  const nextDailySection = activeDailySectionIndex >= 0 && activeDailyRecord && activeDailySectionIndex < activeDailyRecord.sections.length - 1 ? activeDailyRecord.sections[activeDailySectionIndex + 1] ?? null : null;
  const dailyContentBlocks = useMemo(() => buildDailyContentBlocks(activeDailyRecord?.content || activeDailyRecord?.summary || ''), [activeDailyRecord]);
  const visibleDailyContentBlocks = useMemo(
    () => (dailySummaryExpanded ? dailyContentBlocks : dailyContentBlocks.slice(0, 3)),
    [dailyContentBlocks, dailySummaryExpanded],
  );

  const chartModel = useMemo(() => (activeRecord ? buildLinePath(activeRecord.history) : emptyChartModel), [activeRecord]);
  const dailyHighlights = useMemo(() => buildDailyHighlights(activeDailyRecord), [activeDailyRecord]);

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
        : trendSummary?.direction === 'flat'
          ? '走势横盘，当前价格保持相对平稳。'
          : '同步完成后可在这里查看当前市场的窗口变化。';

  const focusPoint = hoveredPointIndex !== null ? chartModel.points[hoveredPointIndex] ?? null : chartModel.points[chartModel.points.length - 1] ?? null;

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
    : marketType === 'ai-tech'
      ? [
          { label: '市场分类', value: activeRecord?.category || '--' },
          { label: '同步状态', value: activeRecord ? formatElapsedTime(activeRecord.fetchedAt) : '--' },
          { label: '市值', value: activeRecord?.marketCap || '--' },
          { label: '市盈率', value: activeRecord?.peRatio || '--' },
        ]
      : [
          { label: '发布日期', value: activeDailyRecord ? formatDailyDate(activeDailyRecord.publishedDate) : '--' },
          { label: '阅读时长', value: activeDailyRecord?.readTime || '--' },
          { label: '同步状态', value: activeDailyRecord ? formatElapsedTime(activeDailyRecord.fetchedAt) : '--' },
          { label: '章节数量', value: String(activeDailyRecord?.sections.length ?? 0) },
        ];

  const marketOverview = useMemo(() => {
    if (marketType === 'ai-daily') {
      if (filteredAIDailyRecords.length === 0) {
        return [] as Array<{ label: string; primary: string; secondary: string; tone?: 'up' | 'down' | 'flat' }>;
      }

      const latest = filteredAIDailyRecords[0];
      const longest = [...filteredAIDailyRecords].sort((a, b) => (b.content.length || 0) - (a.content.length || 0))[0];
      const richest = [...filteredAIDailyRecords].sort((a, b) => (b.sections.length || 0) - (a.sections.length || 0))[0];

      return [
        {
          label: '最新一期',
          primary: latest?.title || '--',
          secondary: latest ? formatDailyDate(latest.publishedDate) : '--',
        },
        {
          label: '内容最完整',
          primary: longest ? `${longest.title} ${longest.readTime || ''}`.trim() : '--',
          secondary: longest ? `${longest.content.length} 字正文` : '--',
        },
        {
          label: '结构最丰富',
          primary: richest ? richest.title : '--',
          secondary: richest ? `${richest.sections.length} 个主题章节` : '--',
        },
      ];
    }

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
    ];
  }, [filteredAIDailyRecords, historyLimit, marketType, visibleRecords]);

  useEffect(() => {
    if (marketType !== 'ai-tech') {
      return;
    }
    if (visibleRecords.length > 0 && !visibleRecords.some((record) => record.symbol === activeSymbol)) {
      setActiveSymbol(visibleRecords[0].symbol);
    }
  }, [activeSymbol, marketType, visibleRecords]);

  useEffect(() => {
    if (marketType !== 'ai-daily') {
      return;
    }
    if (filteredAIDailyRecords.length > 0 && !filteredAIDailyRecords.some((record) => record.slug === activeDailySlug)) {
      setActiveDailySlug(filteredAIDailyRecords[0].slug);
    }
  }, [activeDailySlug, filteredAIDailyRecords, marketType]);

  useEffect(() => {
    if (marketType !== 'ai-daily') {
      return;
    }
    activeDailyButtonRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeDailyRecord?.slug, marketType]);

  useEffect(() => {
    setDailySummaryExpanded(false);
    setActiveDailySection(activeDailyRecord?.sections[0]?.heading ?? '');
  }, [activeDailyRecord?.slug]);

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
    if (marketType === 'ai-tech') {
      return syncTechMarket(rounds, intervalMs);
    }
    return syncAIDailies(rounds, intervalMs);
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
      const defaultMessage =
        marketType === 'precious-metals'
          ? '贵金属数据拉取完成'
          : marketType === 'ai-tech'
            ? 'AI / 科技市场数据拉取完成'
            : 'AI 日报同步完成';
      setMessage((result.message || defaultMessage) + failedCopy);
      if (marketType === 'ai-daily' && aiDailyOffset > 0) {
        setAIDailyOffset(0);
        return;
      }
      await loadMarket();
    } catch (err) {
      setMessage(
        err instanceof Error
          ? err.message
          : marketType === 'precious-metals'
            ? '贵金属数据拉取失败'
            : marketType === 'ai-tech'
              ? 'AI / 科技市场数据拉取失败'
              : 'AI 日报同步失败',
      );
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
      setMessage(err instanceof Error ? err.message : marketType === 'ai-daily' ? 'AI 日报补拉失败' : '历史点位补齐失败');
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
            <strong>
              {marketType === 'precious-metals' ? '贵金属监控台' : marketType === 'ai-tech' ? 'AI / 科技行情台' : 'AI 日报情报台'}
            </strong>
            <span>
              {marketType === 'precious-metals'
                ? '聚焦贵金属价格、区间和合约信息。'
                : marketType === 'ai-tech'
                  ? '聚焦 AI / 科技相关指数与 ETF 的价格轨迹。'
                  : '聚焦每日 AI 资讯摘要、主题章节与原文链接，适合快速浏览和进一步阅读。'}
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
              <button className={marketType === 'ai-daily' ? 'is-active' : ''} onClick={() => setMarketType('ai-daily')} type="button">
                AI 日报
              </button>
            </div>
            {session ? (
              <>
                <button className="legacy-action-button secondary small" disabled={syncing || priming} onClick={() => void handlePrimeHistory()} type="button">
                  {priming ? '补拉中...' : marketType === 'ai-daily' ? '补更多期' : '补历史'}
                </button>
                <button className="legacy-action-button" disabled={syncing || priming} onClick={() => void handleManualSync()} type="button">
                  {syncing ? '同步中...' : '立即同步'}
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
            <h2>{marketType === 'ai-daily' ? 'AI 日报' : '市场动态'}</h2>
            <p>
              {marketType === 'precious-metals'
                ? '先看当前价格和窗口变化，再进入图表与合约详情。'
                : marketType === 'ai-tech'
                  ? '先看当前价格和窗口变化，再进入图表与估值详情。'
                  : '先从最近几期日报里选一篇，再在右侧读取摘要、章节和跳转原文。'}
            </p>
            <div className="legacy-summary-strip market-stage-actions">
              <span className="legacy-summary-chip">数据源：{marketType === 'ai-daily' ? 'Hex 2077' : 'Investing'}</span>
              <span className="legacy-summary-chip">{marketType === 'ai-daily' ? `日报数：${filteredAIDailyRecords.length} / ${aiDailyTotal || filteredAIDailyRecords.length}` : `标的数：${visibleRecords.length}`}</span>
              <span className="legacy-summary-chip">更新时间：{formatUpdatedAt(updatedAt)}</span>
            </div>
          </div>
          <div className="market-stage-metrics market-stage-metrics-compact">
            <article className="legacy-home-stage-card">
              <strong>{marketType === 'ai-daily' ? activeDailyRecord?.readTime || '--' : activeRecord?.price ?? '--'}</strong>
              <span>{marketType === 'ai-daily' ? '阅读时长' : '当前价格'}</span>
            </article>
            <article className="legacy-home-stage-card">
              <strong>{marketType === 'ai-daily' ? String(activeDailyRecord?.sections.length ?? 0) : trendSummary ? formatSignedPercent(trendSummary.deltaPercent, 2) : '--'}</strong>
              <span>{marketType === 'ai-daily' ? '主题章节' : '窗口涨跌幅'}</span>
            </article>
          </div>
        </div>

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
        {loading ? <div className="legacy-feedback market-feedback">{marketType === 'ai-daily' ? '正在加载 AI 日报...' : '正在加载市场动态...'}</div> : null}

        {!loading && marketType === 'ai-daily' && filteredAIDailyRecords.length > 0 ? (
          <div className="market-deck market-deck-daily">
            <aside className="market-sidebar">
              <div className="market-panel market-symbol-panel market-daily-list-panel">
                <div className="market-panel-head">
                  <div>
                    <h3>日报清单</h3>
                    <p>从最近同步的日报里选择一篇，右侧会展开正文摘要和章节索引。</p>
                  </div>
                  <div className="legacy-summary-strip market-range-strip">
                    {aiDailyLimitOptions.map((option) => (
                      <button
                        className={`legacy-summary-chip legacy-summary-chip-button market-range-chip${aiDailyLimit === option ? ' is-active' : ''}`}
                        key={option}
                        onClick={() => setAIDailyLimit(option)}
                        type="button"
                      >
                        {option} 期
                      </button>
                    ))}
                  </div>
                </div>
                <label className="market-daily-search">
                  <span>筛选日报</span>
                  <div className="market-daily-search-row">
                    <input
                      onChange={(event) => setAIDailySearchInput(event.target.value)}
                      placeholder="按标题、摘要、正文、日期检索"
                      type="search"
                      value={aiDailySearchInput}
                    />
                    {aiDailySearchInput ? (
                      <button className="market-daily-search-clear" onClick={() => setAIDailySearchInput('')} type="button">
                        清空
                      </button>
                    ) : null}
                  </div>
                  <div className="market-daily-search-meta">
                    <small className="market-daily-search-hint">
                      {deferredAIDailyKeyword ? `服务端搜索：${deferredAIDailyKeyword}` : '服务端搜索，支持标题 / 摘要 / 正文 / 日期 / slug'}
                    </small>
                    <small className="market-daily-search-hint">当前结果：{filteredAIDailyRecords.length} / {aiDailyTotal || filteredAIDailyRecords.length} 条</small>
                  </div>
                </label>
                <div className="legacy-summary-strip market-range-strip market-daily-sort-strip">
                  {([
                    ['latest', '最新'],
                    ['read-time', '阅读时长'],
                    ['sections', '章节数'],
                  ] as const).map(([mode, label]) => (
                    <button
                      className={`legacy-summary-chip legacy-summary-chip-button market-range-chip${aiDailySortMode === mode ? ' is-active' : ''}`}
                      key={mode}
                      onClick={() => setAIDailySortMode(mode)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                  <button className="legacy-summary-chip legacy-summary-chip-button market-range-chip" onClick={() => activeDailyButtonRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })} type="button">
                    定位当前
                  </button>
                </div>
                <div className="market-symbol-list market-daily-list">
                  {filteredAIDailyRecords.map((record) => (
                    <button
                      className={`market-symbol-card market-daily-card${record.slug === activeDailyRecord?.slug ? ' is-active' : ''}`}
                      key={record.slug}
                      onClick={() => setActiveDailySlug(record.slug)}
                      ref={record.slug === activeDailyRecord?.slug ? activeDailyButtonRef : undefined}
                      type="button"
                    >
                      <div className="market-symbol-card-head market-daily-card-head">
                        <strong>{record.title}</strong>
                        <span>{formatDailyDate(record.publishedDate)}</span>
                      </div>
                      <div className="market-daily-card-summary">{compactDailySummary(record.summary || record.content)}</div>
                      <div className="market-symbol-card-meta market-daily-card-meta">
                        <span>{record.readTime || '--'}</span>
                        <span>{record.sections.length} 个章节</span>
                      </div>
                    </button>
                  ))}
                  {aiDailyHasMore ? (
                    <button className="market-daily-load-more" disabled={loadingMoreDailies} onClick={() => setAIDailyOffset(filteredAIDailyRecords.length)} type="button">
                      {loadingMoreDailies ? '加载中...' : '加载更多历史日报'}
                    </button>
                  ) : filteredAIDailyRecords.length > 0 ? (
                    <div className="market-daily-load-finished">历史日报已全部加载</div>
                  ) : null}
                </div>
              </div>
            </aside>

            <div className="market-main">
              {activeDailyRecord ? (
                <>
                  <div className="market-panel market-spotlight-panel market-daily-spotlight-panel">
                    <div className="market-panel-head">
                      <div>
                        <h3>{activeDailyRecord.title}</h3>
                        <p>快速看完导语和高频主题，再决定是否打开原站继续深读。</p>
                      </div>
                      <div className="legacy-summary-strip market-spotlight-tags market-daily-spotlight-tags">
                        <span className="legacy-summary-chip">{formatDailyDate(activeDailyRecord.publishedDate)}</span>
                        <span className="legacy-summary-chip market-trend-chip market-trend-chip-flat">{activeDailyRecord.readTime || '--'}</span>
                        <span className="legacy-summary-chip">位置 {activeDailyIndex >= 0 ? activeDailyIndex + 1 : 0} / {filteredAIDailyRecords.length}</span>
                      </div>
                    </div>
                    <div className="market-spotlight-grid market-daily-spotlight-grid">
                      <div className="market-spotlight-pricebox market-daily-summary-box">
                        <div className="market-daily-summary-head">
                          <strong>日报摘要</strong>
                          <button className="legacy-action-button secondary small" onClick={() => setDailySummaryExpanded((value) => !value)} type="button">
                            {dailySummaryExpanded ? '收起全文' : '展开全文'}
                          </button>
                        </div>
                        <span className={`market-daily-summary-text${dailySummaryExpanded ? ' is-expanded' : ''}`}>
                          {dailySummaryExpanded ? normalizeDailyText(activeDailyRecord.summary || activeDailyRecord.content) : compactDailySummary(activeDailyRecord.summary || activeDailyRecord.content)}
                        </span>
                        <div className="market-daily-summary-meta">
                          <em>{activeDailyRecord.content ? `${activeDailyRecord.content.length} 字正文已同步` : '当前仅有摘要信息'}</em>
                          {activeDailySectionRecord ? <small>当前聚焦：{activeDailySectionRecord.heading}</small> : null}
                        </div>
                        <div className="market-daily-summary-nav">
                          <button className="legacy-action-button secondary small" disabled={!previousDailyRecord} onClick={() => previousDailyRecord && setActiveDailySlug(previousDailyRecord.slug)} type="button">
                            上一篇
                          </button>
                          <button className="legacy-action-button secondary small" disabled={!nextDailyRecord} onClick={() => nextDailyRecord && setActiveDailySlug(nextDailyRecord.slug)} type="button">
                            下一篇
                          </button>
                        </div>
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

                  <div className="market-grid market-daily-grid">
                    <section className="market-panel market-kpi-panel market-daily-highlights-panel">
                      <div className="market-panel-head">
                        <h3>关键信号</h3>
                      </div>
                      <div className="market-daily-highlights">
                        {dailyHighlights.length > 0 ? (
                          dailyHighlights.map((item, index) => (
                            <article className="market-kpi-card market-daily-highlight-card" key={`${index}-${item.slice(0, 24)}`}>
                              <span>{`要点 ${index + 1}`}</span>
                              <strong>{item}</strong>
                            </article>
                          ))
                        ) : (
                          <div className="legacy-empty-inline">当前这期日报还没有提炼出足够长的要点句。</div>
                        )}
                      </div>
                    </section>

                    <section className="market-panel market-contract-panel market-daily-sections-panel">
                      <div className="market-panel-head">
                        <div>
                          <h3>章节与外链</h3>
                          <p>点击章节卡片即可切换聚焦内容，再决定是否跳转到原文继续深读。</p>
                        </div>
                        <a className="legacy-action-button secondary small" href={activeDailyRecord.sourceUrl} rel="noreferrer" target="_blank">
                          查看原文
                        </a>
                      </div>
                      <div className="market-daily-sections">
                        {activeDailyRecord.sections.length > 0 ? (
                          activeDailyRecord.sections.map((section) => (
                            <button
                              className={`market-daily-section-card${section.heading === activeDailySectionRecord?.heading ? ' is-active' : ''}`}
                              key={section.heading}
                              onClick={() => setActiveDailySection(section.heading)}
                              type="button"
                            >
                              <strong>{section.heading}</strong>
                              {section.items.length > 0 ? (
                                <ul>
                                  {section.items.slice(0, 4).map((item) => (
                                    <li key={item}>{item}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p>该章节当前没有拆出独立条目。</p>
                              )}
                            </button>
                          ))
                        ) : (
                          <div className="legacy-empty-inline">当前这期日报还没有可展示的章节结构。</div>
                        )}
                      </div>
                      {activeDailySectionRecord ? (
                        <div className="market-daily-section-focus">
                          <div className="market-daily-section-focus-head">
                            <strong>当前章节</strong>
                            <span>{activeDailySectionRecord.heading}</span>
                          </div>
                          <div className="market-daily-section-focus-nav">
                            <button className="legacy-action-button secondary small" disabled={!previousDailySection} onClick={() => previousDailySection && setActiveDailySection(previousDailySection.heading)} type="button">
                              上一章节
                            </button>
                            <span className="market-daily-section-focus-index">{activeDailySectionIndex >= 0 ? activeDailySectionIndex + 1 : 0} / {activeDailyRecord?.sections.length ?? 0}</span>
                            <button className="legacy-action-button secondary small" disabled={!nextDailySection} onClick={() => nextDailySection && setActiveDailySection(nextDailySection.heading)} type="button">
                              下一章节
                            </button>
                          </div>
                          {activeDailySectionRecord.items.length > 0 ? (
                            <div className="market-daily-section-focus-items">
                              {activeDailySectionRecord.items.slice(0, 6).map((item) => (
                                <article className="market-daily-section-focus-item" key={item}>
                                  {item}
                                </article>
                              ))}
                            </div>
                          ) : (
                            <p className="market-daily-section-focus-empty">该章节当前还没有拆出独立条目。</p>
                          )}
                        </div>
                      ) : null}
                      {activeDailyRecord.links.length > 0 ? (
                        <div className="market-daily-links">
                          {activeDailyRecord.links.slice(0, 8).map((link) => (
                            <a className="market-daily-link" href={link.url} key={`${link.title}-${link.url}`} rel="noreferrer" target="_blank">
                              <span>{link.title}</span>
                              <em>↗</em>
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  </div>

                  <section className="market-panel market-chart-panel market-daily-reading-panel">
                    <div className="market-panel-head">
                      <div>
                        <h3>正文节选</h3>
                        <p>把已同步正文拆成短段落卡片，适合先快速通读，再回到原文精读。</p>
                      </div>
                      <div className="legacy-summary-strip market-spotlight-tags">
                        <span className="legacy-summary-chip">{dailyContentBlocks.length} 段节选</span>
                        {activeDailySectionRecord ? <span className="legacy-summary-chip">{activeDailySectionRecord.heading}</span> : null}
                      </div>
                    </div>
                    <div className="market-daily-reading-grid">
                      {visibleDailyContentBlocks.length > 0 ? (
                        visibleDailyContentBlocks.map((block, index) => (
                          <article className="market-daily-reading-card" key={`${index}-${block.slice(0, 24)}`}>
                            <span className="market-daily-reading-index">节选 {index + 1}</span>
                            <p>{block}</p>
                          </article>
                        ))
                      ) : (
                        <div className="legacy-empty-inline">当前这期日报还没有同步出可阅读的正文片段。</div>
                      )}
                    </div>
                    {dailyContentBlocks.length > visibleDailyContentBlocks.length ? (
                      <div className="market-daily-reading-foot">当前仅展示前 {visibleDailyContentBlocks.length} 段，点击上方“展开全文”可查看更多内容。</div>
                    ) : null}
                  </section>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {!loading && marketType !== 'ai-daily' && visibleRecords.length > 0 ? (
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
                      <span className={`legacy-summary-chip market-trend-chip market-trend-chip-${trendSummary?.direction ?? 'flat'}`}>
                        窗口变化：{trendSummary ? formatSignedPercent(trendSummary.deltaPercent, 2) : '--'}
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

        {!loading && marketType === 'ai-daily' && aiDailyRecords.length === 0 && !message ? (
          <div className="legacy-feedback market-feedback">当前还没有同步到 AI 日报数据，请先触发同步任务。</div>
        ) : null}

        {!loading && marketType === 'ai-daily' && aiDailyRecords.length > 0 && filteredAIDailyRecords.length === 0 && !message ? (
          <div className="legacy-feedback market-feedback">当前筛选条件下没有匹配的 AI 日报，换个关键词再试。</div>
        ) : null}

        {!loading && marketType !== 'ai-daily' && visibleRecords.length === 0 && !message ? (
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
