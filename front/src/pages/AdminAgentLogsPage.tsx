import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  getAgentLogRunDetail,
  getAgentLogStats,
  listAgentLogRuns,
  type AgentLogRun,
  type AgentLogRunDetail,
  type AgentLogStats,
} from '../api/forum';

/**
 * LLM 日志查看器（运维后门）。
 * 刻意做成终端风格，与平台页面视觉隔离：这是调试工具，不是产品页面。
 * 数据来自 GET /api/v1/admin/agent-logs（adminGuard 保护，仅管理员可用）。
 */

const MONO = "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace";

const statusColor: Record<string, string> = {
  success: '#4ade80',
  failed: '#f87171',
  running: '#fbbf24',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h2 style={{ color: '#7dd3fc', fontSize: 14, letterSpacing: 1, margin: '0 0 10px', fontFamily: MONO }}>
        {'// '}
        {title}
      </h2>
      {children}
    </section>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <pre
      style={{
        background: '#0d1117',
        border: '1px solid #21262d',
        borderRadius: 6,
        color: '#c9d1d9',
        fontSize: 12,
        lineHeight: 1.5,
        margin: '6px 0 0',
        maxHeight: 320,
        overflow: 'auto',
        padding: 10,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {text}
    </pre>
  );
}

function RunDetail({ runID }: { runID: string }) {
  const [detail, setDetail] = useState<AgentLogRunDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError('');
    getAgentLogRunDetail(runID)
      .then((d) => alive && setDetail(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [runID]);

  if (error) return <p style={{ color: '#f87171', fontFamily: MONO, fontSize: 13 }}>加载失败: {error}</p>;
  if (!detail) return <p style={{ color: '#8a94a6', fontFamily: MONO, fontSize: 13 }}>加载中…</p>;

  return (
    <div>
      <div style={{ display: 'grid', gap: 6, gridTemplateColumns: '120px 1fr', fontSize: 13 }}>
        <span style={{ color: '#8a94a6' }}>run_id</span>
        <span style={{ color: '#c9d1d9', fontFamily: MONO }}>{detail.run_id}</span>
        <span style={{ color: '#8a94a6' }}>conversation</span>
        <span style={{ color: '#c9d1d9', fontFamily: MONO }}>{detail.conversation_id}</span>
        <span style={{ color: '#8a94a6' }}>状态 / 耗时</span>
        <span style={{ color: statusColor[detail.status] ?? '#c9d1d9' }}>
          {detail.status} · {((detail.latency_ms ?? 0) / 1000).toFixed(1)}s
        </span>
        <span style={{ color: '#8a94a6' }}>用户问题</span>
        <span style={{ color: '#e6edf3', whiteSpace: 'pre-wrap' }}>{detail.prompt}</span>
      </div>

      {detail.generated_sql ? (
        <Section title="generated SQL">
          <JsonBlock value={detail.generated_sql} />
        </Section>
      ) : null}
      {detail.error ? (
        <Section title="error">
          <p style={{ color: '#f87171', fontFamily: MONO, fontSize: 13, margin: 0 }}>{detail.error}</p>
        </Section>
      ) : null}

      <Section title={`LLM 调用明细（${detail.llm_calls.length} 次）`}>
        {detail.llm_calls.map((call) => (
          <details key={call.log_id} style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, marginBottom: 8 }}>
            <summary style={{ cursor: 'pointer', fontFamily: MONO, fontSize: 13, padding: '8px 10px', color: '#e6edf3' }}>
              <span style={{ color: '#7dd3fc' }}>{call.stage}</span>
              <span style={{ color: '#8a94a6' }}> · {call.model}</span>
              <span style={{ color: '#8a94a6' }}> · {((call.latency_ms ?? 0) / 1000).toFixed(1)}s</span>
              {call.error ? <span style={{ color: '#f87171' }}> · ERROR</span> : null}
              <span style={{ color: '#484f58' }}> · {call.created_at}</span>
            </summary>
            <div style={{ padding: '0 10px 10px' }}>
              {call.error ? <p style={{ color: '#f87171', fontSize: 12 }}>error: {call.error}</p> : null}
              <div style={{ color: '#8a94a6', fontSize: 12, marginTop: 6 }}>request</div>
              <JsonBlock value={call.request_json} />
              <div style={{ color: '#8a94a6', fontSize: 12, marginTop: 8 }}>response</div>
              <JsonBlock value={call.response_json} />
            </div>
          </details>
        ))}
      </Section>
    </div>
  );
}

export function AdminAgentLogsPage() {
  const [runs, setRuns] = useState<AgentLogRun[]>([]);
  const [stats, setStats] = useState<AgentLogStats[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (searchText: string, status: string) => {
    setLoading(true);
    setError('');
    try {
      const [runResp, statResp] = await Promise.all([
        listAgentLogRuns({ limit: 100, status, search: searchText }),
        getAgentLogStats(),
      ]);
      setRuns(runResp.records);
      setStats(statResp.records);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load('', '');
  }, [load]);

  return (
    <div style={{ background: '#010409', color: '#e6edf3', minHeight: '100vh', padding: '24px clamp(12px, 4vw, 40px)', fontFamily: MONO }}>
      <header style={{ alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>
          <span style={{ color: '#4ade80' }}>$</span> agent-llm-logs
        </h1>
        <Link to="/" style={{ color: '#7dd3fc', fontSize: 13, textDecoration: 'none' }}>
          ← 返回平台
        </Link>
      </header>

      <Section title="阶段统计（最近 7 天）">
        <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
          <thead>
            <tr style={{ color: '#8a94a6', textAlign: 'left' }}>
              <th style={{ padding: '6px 10px' }}>stage</th>
              <th style={{ padding: '6px 10px' }}>调用</th>
              <th style={{ padding: '6px 10px' }}>错误</th>
              <th style={{ padding: '6px 10px' }}>平均耗时</th>
              <th style={{ padding: '6px 10px' }}>最大耗时</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.stage} style={{ borderTop: '1px solid #21262d' }}>
                <td style={{ color: '#7dd3fc', padding: '6px 10px' }}>{s.stage}</td>
                <td style={{ padding: '6px 10px' }}>{s.calls}</td>
                <td style={{ color: s.errors > 0 ? '#f87171' : undefined, padding: '6px 10px' }}>{s.errors}</td>
                <td style={{ padding: '6px 10px' }}>{s.avg_seconds ?? '-'}s</td>
                <td style={{ padding: '6px 10px' }}>{s.max_seconds ?? '-'}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="请求列表">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(search, statusFilter);
          }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}
        >
          <input
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 prompt…"
            style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, color: '#e6edf3', fontSize: 13, padding: '6px 10px', width: 260 }}
            value={search}
          />
          <select
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, color: '#e6edf3', fontSize: 13, padding: '6px 10px' }}
            value={statusFilter}
          >
            <option value="">全部状态</option>
            <option value="success">success</option>
            <option value="failed">failed</option>
          </select>
          <button
            style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', cursor: 'pointer', fontSize: 13, padding: '6px 14px' }}
            type="submit"
          >
            {loading ? '查询中…' : '查询'}
          </button>
        </form>

        {error ? <p style={{ color: '#f87171' }}>{error}</p> : null}

        <div style={{ display: 'grid', gap: 8 }}>
          {runs.map((run) => {
            const active = run.run_id === selectedRun;
            return (
              <div key={run.run_id} style={{ background: active ? '#0d1117' : 'transparent', border: `1px solid ${active ? '#7dd3fc44' : '#21262d'}`, borderRadius: 6 }}>
                <button
                  onClick={() => setSelectedRun(active ? null : run.run_id)}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'block', fontFamily: MONO, fontSize: 13, padding: '10px 12px', textAlign: 'left', width: '100%' }}
                  type="button"
                >
                  <span style={{ color: statusColor[run.status] ?? '#8a94a6' }}>{run.status === 'success' ? '✓' : '✗'}</span>{' '}
                  <span style={{ color: '#e6edf3' }}>{run.prompt.slice(0, 60)}</span>
                  <span style={{ color: '#484f58' }}> · {run.started_at} · {((run.latency_ms ?? 0) / 1000).toFixed(1)}s</span>
                  {run.error ? <span style={{ color: '#f87171' }}> · {run.error.slice(0, 50)}</span> : null}
                </button>
                {active ? (
                  <div style={{ padding: '0 12px 12px' }}>
                    <RunDetail runID={run.run_id} />
                  </div>
                ) : null}
              </div>
            );
          })}
          {!loading && runs.length === 0 && !error ? <p style={{ color: '#8a94a6' }}>没有匹配的记录</p> : null}
        </div>
      </Section>
    </div>
  );
}
