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

## AKShare 文档 RAG 索引（构建期）

`/prompt` 管线的 `fetch_market_data` 节点与 `/chat` 管线共用 `fetch_external_market_text`：
意图命中时用 RAG 检索 AKShare 官方文档挑选行情接口，LLM 生成参数后调用白名单接口远程取数，
数据注入 SQL 生成与回答两轮；普通请求零开销，取数失败静默降级。
检索索引是 `app/akshare_docs_data/chunks.jsonl`，随仓库提交，**运行服务不需要联网爬文档**。

文档随 AKShare 版本演进，升级 `requirements.txt` 里的 `akshare` 后重建索引：

```bash
task agent:rag:build          # 等价于：cd agent && ./.venv/bin/python scripts/build_akshare_rag.py
# 脚本选项：
#   --parse-only   只重新切块（复用上次的 HTML 缓存）
#   --docs-dir X   自定义 HTML 缓存目录（默认 agent/.akshare_docs_cache，构建后自动清理）
#   --keep-html    保留 HTML 缓存
```

流程：爬 `akshare.akfamily.xyz`（52 页，限速抓取）→ 按 `<section>` 切块（一个接口一块，约 1500 块）→
写入 `chunks.jsonl` → 自动校验（核心接口必须可检索、块数异常时拒绝覆盖旧索引）。

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

- `AGENT_ALLOWED_TABLES`：限制 SQL 只读查询可访问的表（逗号分隔）。**留空时默认允许七张表**：三张市场/AI 数据表（`ai_daily_snapshots`、`precious_metal_snapshots`、`tech_market_snapshots`）加论坛公开内容（`questions`、`comments`、`question_files`、`question_likes`）；`users` 等含敏感信息的表任何默认配置下都不可查。需要收窄或扩展时显式配置。
- `CORS_ALLOWED_ORIGINS`：浏览器跨域白名单（逗号分隔）。留空时允许任意来源（不携带凭据），仅限本地开发。
- `LLM_TIMEOUT_SECONDS`：单次 LLM 调用超时，默认 35 秒。两次调用 + 5 秒 SQL 超时的最坏路径低于 Go 代理的 90 秒上限。
- 分 stage 模型配置：`LLM_SQL_MODEL`（生成 SQL）、`LLM_ANALYZE_MODEL`（分析结论）、`LLM_TOOL_MODEL`（akshare 接口参数规划）。任一项留空时回落到全局 `LLM_MODEL`，只配 `LLM_MODEL` 即可全站生效。
- `AGENT_SAMPLE_ROW_LIMIT`：采样行数上限。

内置行为：

- SQL 校验：只读语句、黑名单 token（含 `into`/`outfile`）、表白名单（CTE 别名自动豁免）、结果强制 LIMIT。
- LLM 调用对 429/5xx/网络错误自动重试一次。
- 每用户限流：`/prompt` 和 `/chat` 共享每 60 秒 10 次的预算，超出返回 429（需要 Go 代理转发用户身份）。
- 审计：`/chat` 与 `/prompt` 均写入 `agent_runs` 和 `agent_llm_logs`；失败响应只含通用提示，异常原文仅入库存档。
- 缓存：表结构 introspect 结果缓存 5 分钟；chat 表 DDL 每进程只跑一次。
- 上下文压缩（分段摘要）：`/chat` 不再全量注入历史原文。每 3 轮对话（6 条消息）封一个摘要段存入 `agent_conversation_summaries`，由回答那次 LLM 调用顺带产出（不加调用次数）；注入 prompt 的是「最近 12 段摘要 + 封顶 6 条尾部原文（每条截 300 字）」，Token 用量恒定，长程记忆不随对话变长而丢失或膨胀。摘要解析失败只影响该段补记，主回答始终正常返回。

## 测试

```bash
python -m pytest
```
