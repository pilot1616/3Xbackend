# AI 分析聊天功能 Spec

## 目标

在 AI 分析页面增加聊天框，登录用户可以向 LLM 提问。LLM 通过 agent 读取数据库中的 AI 日报、贵金属、科技市场数据后回答。

## 权限

- 只有登录用户可以聊天。
- 未登录用户不能发送消息，也不能查看历史会话。
- 每个用户只能访问自己的聊天记录。
- 前端调用 Go 后端，Go 后端用现有 JWT 鉴权后代理到 Python agent。

## 架构

```text
AnalysisPage
  -> Go /api/v1/agent/*
    -> authGuard
    -> Python agent /chat
      -> MySQL 保存会话、消息、run、LLM 日志
      -> LLM 生成 SQL
      -> MySQL 执行只读查询
      -> LLM 生成回复
```

## 数据库存储

Python agent 创建并维护：

- `agent_conversations`
- `agent_messages`
- `agent_runs`
- `agent_llm_logs`

聊天记录、LLM 请求、LLM 返回、SQL、查询摘要和错误都需要落库，便于排查。

## 接口

Go 后端：

- `POST /api/v1/agent/chat`
- `GET /api/v1/agent/conversations`
- `GET /api/v1/agent/conversations/:id/messages`

Python agent：

- `POST /chat`
- `GET /conversations`
- `GET /conversations/{conversation_id}/messages`

## 页面

- AI 分析页新增聊天面板。
- 未登录显示登录提示。
- 已登录加载最近会话和消息。
- 每条 AI 回复展示 `run_id` 和查询摘要。

## 约束

- LLM 只生成只读 SQL。
- 默认只把最近 6 条历史消息传给 LLM。
- 查询结果最多 50 行。
- LLM 日志不保存 API key。

