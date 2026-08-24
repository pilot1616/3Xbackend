import { useState } from 'react';
import { Link } from 'react-router-dom';

import { syncAIDailies, syncPreciousMetalMarket, syncTechMarket } from '../api/forum';
import { useSession } from '../lib/session';
import type { AIDailySyncResult, PreciousMetalSyncResult, TechMarketSyncResult } from '../types/api';

type SyncTarget = 'precious-metals' | 'ai-tech' | 'ai-dailies';
type SyncResult = PreciousMetalSyncResult | TechMarketSyncResult | AIDailySyncResult;

type SyncAction = {
  target: SyncTarget;
  label: string;
  description: string;
  latestLabel: string;
  backfillLabel: string;
  latest: () => Promise<SyncResult>;
  backfill: () => Promise<SyncResult>;
};

const syncActions: SyncAction[] = [
  {
    target: 'precious-metals',
    label: '贵金属行情',
    description: '同步 Gold、Silver、Platinum、Palladium 的最新快照。',
    latestLabel: '同步最新贵金属',
    backfillLabel: '补拉贵金属窗口',
    latest: () => syncPreciousMetalMarket(1, 800),
    backfill: () => syncPreciousMetalMarket(6, 1200),
  },
  {
    target: 'ai-tech',
    label: 'AI / 科技市场',
    description: '同步 NDX、QQQ、XLK、SMH、IGV 的最新快照。',
    latestLabel: '同步最新科技市场',
    backfillLabel: '补拉科技市场窗口',
    latest: () => syncTechMarket(1, 800),
    backfill: () => syncTechMarket(6, 1200),
  },
  {
    target: 'ai-dailies',
    label: 'AI 日报',
    description: '同步 hex2077.dev 的 AI 日报归档内容。',
    latestLabel: '同步最新日报',
    backfillLabel: '补拉日报归档',
    latest: () => syncAIDailies(1, 800),
    backfill: () => syncAIDailies(6, 1200),
  },
];

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || '--';
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(
    2,
    '0',
  )}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

export function AdminSyncPage() {
  const session = useSession();
  const isAdmin = Boolean(session?.user.is_admin);

  const [busyTarget, setBusyTarget] = useState<SyncTarget | null>(null);
  const [message, setMessage] = useState('');
  const [results, setResults] = useState<Partial<Record<SyncTarget, SyncResult>>>({});

  async function runAction(action: SyncAction, mode: 'latest' | 'backfill') {
    setBusyTarget(action.target);
    setMessage('');
    try {
      const result = mode === 'latest' ? await action.latest() : await action.backfill();
      setResults((current) => ({ ...current, [action.target]: result }));
      const failed = result.partial && result.failedSymbols.length > 0 ? `；未完成：${result.failedSymbols.join('、')}` : '';
      setMessage((result.message || `${action.label}同步完成`) + failed);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${action.label}同步失败`);
    } finally {
      setBusyTarget(null);
    }
  }

  if (!session) {
    return (
      <div className="legacy-gated-scene">
        <div className="legacy-gated-card">
          <span className="legacy-home-stage-kicker">Admin Required</span>
          <h2>请先登录</h2>
          <p>后台同步控制台只允许管理员访问。</p>
          <Link className="legacy-action-button" to="/auth?redirect=/admin/sync">
            去登录
          </Link>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="legacy-gated-scene">
        <div className="legacy-gated-card">
          <span className="legacy-home-stage-kicker">Forbidden</span>
          <h2>没有管理员权限</h2>
          <p>当前账号不能执行后台同步任务。</p>
          <Link className="legacy-action-button" to="/">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section className="content whisper-content market-scene">
      <div className="cont w1000 market-shell">
        <div className="market-route-banner">
          <span className="market-route-badge">Admin Sync</span>
          <div className="market-route-copy">
            <strong>后台同步控制台</strong>
            <span>用于管理员触发最新数据同步和短窗口补拉，普通页面只负责读取同步后的数据。</span>
          </div>
        </div>

        {message ? <div className="legacy-feedback market-feedback">{message}</div> : null}

        <div className="market-overview-grid">
          {syncActions.map((action) => {
            const result = results[action.target];
            const busy = busyTarget === action.target;
            return (
              <article className="market-overview-card" key={action.target}>
                <span>{action.label}</span>
                <strong>{result ? `${result.successCount} / ${result.targetCount}` : '--'}</strong>
                <em>{action.description}</em>
                <div className="legacy-summary-strip">
                  <button className="legacy-action-button small" disabled={Boolean(busyTarget)} onClick={() => void runAction(action, 'latest')} type="button">
                    {busy ? '执行中...' : action.latestLabel}
                  </button>
                  <button className="legacy-action-button secondary small" disabled={Boolean(busyTarget)} onClick={() => void runAction(action, 'backfill')} type="button">
                    {busy ? '执行中...' : action.backfillLabel}
                  </button>
                </div>
                {result ? (
                  <div className="legacy-summary-strip">
                    <span className="legacy-summary-chip">时间：{formatDateTime(result.fetchedAt)}</span>
                    <span className="legacy-summary-chip">{result.partial ? '部分成功' : '全部成功'}</span>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
