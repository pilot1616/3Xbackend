import { AgentChatPanel } from '../components/AgentChatPanel';

export function AIChatPage() {
  return (
    <section className="content whisper-content analysis-page-shell ai-chat-page-shell">
      <div className="cont w1000 analysis-page-container">
        <section className="analysis-hero-panel ai-chat-hero-panel">
          <div className="analysis-hero-copy">
            <span className="analysis-hero-kicker">AI Chat</span>
            <h1>AI 数据助手</h1>
            <p>围绕 AI 日报、科技市场和贵金属数据追问结论。</p>
          </div>

          <div className="analysis-hero-controls">
            <div className="analysis-hero-meta">
              <div className="analysis-hero-meta-row">
                <span>入口：AI 聊天</span>
                <span>记录：数据库持久化</span>
              </div>
              <p>登录后可以继续历史会话，所有 LLM 调用和返回都会记录日志用于排查。</p>
            </div>
          </div>
        </section>

        <AgentChatPanel standalone />
      </div>
    </section>
  );
}
