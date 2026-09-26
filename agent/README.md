# Agent

独立的 LangGraph AI Agent 服务。

## 启动

```bash
cd agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8010
```

## 接口

- `GET /health`
- `POST /prompt`
- `GET /conversations`
- `GET /conversations/{conversation_id}/messages`
- `POST /chat`

浏览器不直接调用这些接口，统一走 Go 后端的 `/api/v1/agent/*` 代理。

## 鉴权

- 设置环境变量 `AGENT_INTERNAL_TOKEN` 后，除 `/health` 外的所有接口都要求请求头 `X-Agent-Token` 与该令牌一致，否则返回 `401`。
- Go 后端会读取同一个 `AGENT_INTERNAL_TOKEN` 并在代理请求时自动附加，两侧必须配置相同的值。
- 令牌留空时不校验（仅限本地开发）；生产环境必须设置，prod Compose 已强制。

## 其他配置

- `AGENT_ALLOWED_TABLES`：限制 SQL 只读查询可访问的表（逗号分隔）。**留空时默认只允许三张数据表**（`ai_daily_snapshots`、`precious_metal_snapshots`、`tech_market_snapshots`），不会放开全部表；需要扩表时显式配置。
- `CORS_ALLOWED_ORIGINS`：浏览器跨域白名单（逗号分隔）。留空时允许任意来源（不携带凭据），仅限本地开发。
- `LLM_TIMEOUT_SECONDS`：单次 LLM 调用超时，默认 35 秒。两次调用 + 5 秒 SQL 超时的最坏路径低于 Go 代理的 90 秒上限。
- `AGENT_SAMPLE_ROW_LIMIT`：采样行数上限。

内置行为：

- SQL 校验：只读语句、黑名单 token（含 `into`/`outfile`）、表白名单（CTE 别名自动豁免）、结果强制 LIMIT。
- LLM 调用对 429/5xx/网络错误自动重试一次。
- 每用户限流：`/prompt` 和 `/chat` 共享每 60 秒 10 次的预算，超出返回 429（需要 Go 代理转发用户身份）。
- 审计：`/chat` 与 `/prompt` 均写入 `agent_runs` 和 `agent_llm_logs`；失败响应只含通用提示，异常原文仅入库存档。
- 缓存：表结构 introspect 结果缓存 5 分钟；chat 表 DDL 每进程只跑一次。

## 测试

```bash
python -m pytest
```
