# Data Fetch

数据同步服务，直接写入当前项目使用的 MySQL 表：

- `precious_metal_snapshots`（贵金属，AKShare）
- `tech_market_snapshots`（科技市场，AKShare）
- `ai_daily_snapshots`（AI 日报，hex2077.dev，解析逻辑对齐 Go 后端 `ai_daily_sync.go`）

## 本地运行

```bash
cd data-fetch
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m app.main once
```

持续轮询：

```bash
python -m app.main loop
```

## 中断控制

同步任务支持协作式软中断：收到中断请求后在检查点（数据源之间、文章之间）退出，
**已抓到的数据先落库再退出，不会丢**。

- CLI：`Ctrl+C`（SIGINT）或 `SIGTERM` 触发；第一次信号软退出，连续两次强制退出；退出码 130
- API：`POST /sync/stop` 请求正在执行的同步在下一个检查点停止
- 结果可观测：响应里带 `interrupted`、`interruptedAt`（中断发生在哪个阶段）、`stages`（各阶段 ok/interrupted 状态）

单源失败不影响其它数据源：贵金属失败时科技市场与 AI 日报照常同步。
