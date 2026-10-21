import { useEffect, useRef, useState } from 'react';

import { listAgentConversations, listAgentMessages } from '../api/forum';
import { streamAgentChat } from '../api/client';
import { useSession } from '../lib/session';
import type { AgentChatMessage, AgentConversation, AnalysisWindow } from '../types/api';

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

function formatVisibleQuerySummary(value?: string) {
  if (!value) {
    return '';
  }
  return value
    .split('\n')
    .filter((line) => !line.trim().toLowerCase().startsWith('sql='))
    .join('\n')
    .trim();
}

// stage 占位文案集合：onDelta 判断当前内容是否还是状态提示而非回答正文
const STREAMING_STAGES = new Set(['正在回复…', '正在生成查询…', '查询出错，正在修正…', '正在补充外部行情…', '正在分析数据…', '处理中…']);

interface AgentChatPanelProps {
  selectedWindow?: AnalysisWindow;
  standalone?: boolean;
}

export function AgentChatPanel({ selectedWindow = '7d', standalone = false }: AgentChatPanelProps) {
  const session = useSession();
  const [chatConversations, setChatConversations] = useState<AgentConversation[]>([]);
  const [activeConversationID, setActiveConversationID] = useState('');
  const [chatMessages, setChatMessages] = useState<AgentChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!session) {
      setChatConversations([]);
      setActiveConversationID('');
      setChatMessages([]);
      setChatError('');
      return;
    }
    void loadChatConversations();
  }, [session?.token]);

  useEffect(() => {
    if (!session || !activeConversationID) {
      setChatMessages([]);
      return;
    }
    void loadChatMessages(activeConversationID);
  }, [session?.token, activeConversationID]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [chatMessages, chatSending]);

  async function loadChatConversations() {
    setChatLoading(true);
    setChatError('');
    try {
      const result = await listAgentConversations();
      setChatConversations(result.records);
      setActiveConversationID((current) => current || result.records[0]?.conversation_id || '');
    } catch (error) {
      setChatError(error instanceof Error ? error.message : '聊天记录加载失败');
    } finally {
      setChatLoading(false);
    }
  }

  async function loadChatMessages(conversationID: string) {
    setChatLoading(true);
    setChatError('');
    try {
      const result = await listAgentMessages(conversationID);
      setChatMessages(result.records);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : '聊天记录加载失败');
    } finally {
      setChatLoading(false);
    }
  }

  function handleNewChat() {
    setActiveConversationID('');
    setChatMessages([]);
    setChatInput('');
    setChatError('');
  }

  async function handleSendChat() {
    if (!session || chatSending) {
      return;
    }
    const content = chatInput.trim();
    if (!content) {
      return;
    }

    const optimisticMessage: AgentChatMessage = {
      message_id: `local-${Date.now()}`,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    const streamingId = `streaming-${Date.now()}`;
    setChatMessages((items) => [
      ...items,
      optimisticMessage,
      { message_id: streamingId, role: 'assistant', content: '', created_at: new Date().toISOString() },
    ]);
    setChatInput('');
    setChatSending(true);
    setChatError('');

    const upsertStreaming = (patch: Partial<AgentChatMessage>) => {
      setChatMessages((items) => items.map((item) => (item.message_id === streamingId ? { ...item, ...patch } : item)));
    };

    try {
      await streamAgentChat(
        {
          conversation_id: activeConversationID || undefined,
          message: content,
          context: {
            window: selectedWindow,
            source: standalone ? 'ai-chat-page' : 'analysis-page-chat',
          },
        },
        {
          onMeta: (payload) => {
            setActiveConversationID(payload.conversation_id);
            upsertStreaming({ run_id: payload.run_id });
          },
          onStage: (payload) => {
            const stageText: Record<string, string> = {
              smalltalk: '正在回复…',
              generate_sql: '正在生成查询…',
              repair_sql: '查询出错，正在修正…',
              fetch_market_data: '正在补充外部行情…',
              analyze: '正在分析数据…',
            };
            upsertStreaming({ content: stageText[payload.stage] ?? '处理中…' });
          },
          onSources: (payload) => {
            upsertStreaming({ query_summary: payload.query_summary });
          },
          onDelta: (payload) => {
            // 首个 delta 到达时清掉 stage 占位文案，之后逐字追加
            setChatMessages((items) =>
              items.map((item) => {
                if (item.message_id !== streamingId) {
                  return item;
                }
                const prefix = STREAMING_STAGES.has(item.content) ? '' : item.content;
                return { ...item, content: prefix + payload.text };
              }),
            );
          },
          onDone: (payload) => {
            upsertStreaming({
              message_id: payload.message_id,
              content: payload.reply,
            });
          },
          onError: (payload) => {
            throw new Error(payload.message);
          },
        },
      );
      void loadChatConversations();
    } catch (error) {
      // 流中途中断：占位消息保留已收到内容并标记；没有内容才移除
      setChatMessages((items) =>
        items.filter((item) => {
          if (item.message_id !== streamingId) {
            return true;
          }
          if (!item.content || STREAMING_STAGES.has(item.content)) {
            return false;
          }
          return true;
        }),
      );
      setChatError(error instanceof Error ? error.message : '发送失败');
      setChatInput(content);
    } finally {
      setChatSending(false);
    }
  }

  return (
    <section className={`analysis-panel analysis-chat-panel${standalone ? ' analysis-chat-panel-standalone' : ''}`}>
      <div className="analysis-panel-head">
        <div>
          <span className="analysis-panel-kicker">Agent 对话</span>
          <h2>追问数据结论</h2>
          <p>{session ? `当前登录：${session.user.nickname || session.user.username}` : '登录后可读取数据库并保留聊天记录。'}</p>
        </div>
        <div className="analysis-panel-badges">
          <span className="analysis-chip-badge is-confidence">{session ? '可对话' : '需登录'}</span>
          {chatConversations.length > 0 ? <span className="analysis-chip-badge is-mixed">{chatConversations.length} 个会话</span> : null}
        </div>
      </div>

      {session ? (
        <div className="analysis-chat-layout">
          <aside className="analysis-chat-sidebar">
            <button className="legacy-action-button secondary small" disabled={chatSending} onClick={handleNewChat} type="button">
              新对话
            </button>
            <div className="analysis-chat-conversation-list">
              {chatConversations.map((item) => (
                <button
                  className={`analysis-chat-conversation${item.conversation_id === activeConversationID ? ' is-active' : ''}`}
                  key={item.conversation_id}
                  onClick={() => setActiveConversationID(item.conversation_id)}
                  type="button"
                >
                  <strong>{item.title || '新对话'}</strong>
                  <span>{formatDateTime(item.updated_at)}</span>
                </button>
              ))}
              {!chatLoading && chatConversations.length === 0 ? <p className="analysis-list-empty">还没有历史会话。</p> : null}
            </div>
          </aside>

          <div className="analysis-chat-main">
            {chatError ? <div className="analysis-panel-error"><strong>对话暂不可用</strong><p>{chatError}</p></div> : null}
            <div className="analysis-chat-messages" aria-live="polite">
              {chatLoading && chatMessages.length === 0 ? <p className="analysis-list-empty">正在加载聊天记录...</p> : null}
              {!chatLoading && chatMessages.length === 0 ? <p className="analysis-list-empty">可以直接问：近 7 天 AI 主题和科技股走势有没有背离？</p> : null}
              {chatMessages.map((item) => {
                const visibleSummary = formatVisibleQuerySummary(item.query_summary);
                return (
                  <article className={`analysis-chat-message is-${item.role}`} key={item.message_id}>
                    <span>{item.role === 'user' ? '我' : 'AI'}</span>
                    <p>{item.content}</p>
                    {item.role === 'assistant' && (item.run_id || visibleSummary) ? (
                      <div className="analysis-chat-meta">
                        {item.run_id ? <code>{item.run_id}</code> : null}
                        {visibleSummary ? <pre>{visibleSummary}</pre> : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
              {chatSending ? <p className="analysis-list-empty">Agent 正在查询数据库并生成回复...</p> : null}
              <div ref={chatEndRef} />
            </div>

            <div className="analysis-chat-composer">
              <textarea
                disabled={chatSending}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void handleSendChat();
                  }
                }}
                placeholder="输入问题，例如：结合近 30 天 AI 日报和贵金属走势，当前更像风险偏好还是避险？"
                rows={3}
                value={chatInput}
              />
              <button className="legacy-action-button" disabled={chatSending || !chatInput.trim()} onClick={() => void handleSendChat()} type="button">
                {chatSending ? '发送中...' : '发送'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="analysis-panel-error">
          <strong>需要登录</strong>
          <p>登录后才能对话、读取数据库并查看自己的历史记录。</p>
        </div>
      )}
    </section>
  );
}
