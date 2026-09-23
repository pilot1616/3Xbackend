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

- `CORS_ALLOWED_ORIGINS`：浏览器跨域白名单（逗号分隔）。留空时允许任意来源（不携带凭据），仅限本地开发。
- `AGENT_ALLOWED_TABLES`：限制 SQL 只读查询可访问的表（逗号分隔）。
- `AGENT_SAMPLE_ROW_LIMIT`：采样行数上限。

## 测试

```bash
python -m pytest
```
