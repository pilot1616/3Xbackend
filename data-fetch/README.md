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

## 数据完整性检查与补数

对三张表按 `[--start, 今天]` 逐日核对，缺口自动补数（`data-fetch/app/check_data_integrity.py`）：

```bash
task data:integrity -- --start 2026-09-01             # 检查 + 自动补数
task data:integrity -- --start 2026-09-01 --no-repair # 只报告缺口，不修复
cd data-fetch && .venv/bin/python -m app.check_data_integrity --start 2026-09-01  # 等价 CLI
```

判定口径：

- **AI 日报**：工作日逐日核对；`published_date` 落在库内最早/最晚有报日期之间的空洞视为缺失（区间外不判缺，源站是否发布无法预知）。
- **行情表**：每个标的按交易日核对；交易日基准取该标的库内全历史出现过的日期集合（与数据源口径一致，不从日历推导节假日）。
- 补数复用 `akshare_client` / `AIDailyClient` 的抓取逻辑，经唯一键幂等写入（`symbol+fetched_at` / `source+slug`），可安全重复执行。
- 源站本身没有的日期（如停刊日、节假日停更）补不上，报告为 `not-available`，属正常现象，不影响退出码。

退出码：`0` 完整或缺口均为源站未发布；`1` 发现缺口（--no-repair 模式）；`2` 补数失败（抓取异常）。

