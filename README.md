# 3Xbackend

`3Xbackend` 是一个论坛 + 市场动态的全栈项目，当前仓库同时包含：

- Go 后端服务
- MySQL 数据库
- React + TypeScript 新前端：`front/`
- Python data-fetch 数据抓取服务：`data-fetch/`
- Python Agent 分析服务：`agent/`
- 旧示例前端：`example/`，仅作为结构和样式参考

详细接口说明见 [API.md](/Users/zhangxinghui/Desktop/web/3Xbackend/API.md)。

## 项目能力

当前项目已经具备完整的可运行链路，核心能力包括：

- 用户注册、登录、找回密码、密保校验
- 用户资料维护、头像上传
- 帖子发布、编辑、删除、发布状态切换
- 帖子图片 / 视频附件上传与删除
- 帖子列表、详情页、点赞、评论
- 首页统一搜索：按内容、作者、手机号筛选公开帖子
- 我的帖子、我的评论、我的点赞、个人统计
- 市场动态页：贵金属行情、AI / 科技市场行情，只展示数据和后台更新状态
- AI 联动分析页：AI 日报主题趋势、市场趋势、综合联动判断
- AI 日报独立栏目：日报检索、阅读、章节导航
- 管理员后台同步控制台：同步最新数据、补齐完整历史数据、查看失败提示
- 启动后定时同步 `Investing.com` 贵金属数据
- 启动后定时同步 `Investing.com` AI / 科技市场数据
- 启动后定时同步 `hex2077.dev` AI 日报数据
- 独立 `data-fetch/` 服务：通过 AkShare 拉取最新金融快照和历年金融历史数据
- 独立 `agent/` 服务：接收外部 prompt，联动数据库与 LLM 做分析
- 分层测试模块：Go 后端、前端 E2E、data-fetch pytest、Agent pytest
- 假数据脚本：可注入千级帖子、评论、点赞和演示图片

## 目录结构

```text
3Xbackend/
├── cmd/                    # Go 程序入口（主服务、同步脚本、种子脚本）
├── config/                 # 后端配置文件
├── internal/               # 业务代码
├── public/                 # 运行时静态资源目录
├── front/                  # 新前端：Vite + React + TypeScript
├── data-fetch/             # Python AkShare 数据抓取服务
├── agent/                  # Python LangGraph / LLM 分析服务
├── example/                # 旧示例前端，仅供参考
├── specs/                  # 产品、实现和测试规格文档
├── API.md                  # 接口文档
├── README.md               # 项目说明
└── SEED.md                 # 假数据脚本说明
```

## 技术栈

后端：

- Go
- Gin
- GORM
- MySQL
- Viper

前端：

- React 18
- TypeScript
- Vite
- React Router

数据与 AI 服务：

- FastAPI
- SQLAlchemy
- AkShare
- LangGraph
- Playwright
- Pytest

## 推荐本地启动方式

推荐直接使用 [Taskfile.yml](/Users/zhangxinghui/Desktop/web/3Xbackend/Taskfile.yml)。

### 1. 初始化环境

```bash
task init
```

这个命令会：

- 创建 `public/images` 和 `public/uploads`
- 补齐 `.env`、`front/.env`、`agent/.env` 和 `data-fetch/.env`
- 安装前端依赖

### 2. 启动开发环境

如果你本机已经有可用的 MySQL：

```bash
task dev
```

如果你希望使用 Docker 中的 MySQL：

```bash
task dev:docker
```

启动后默认访问地址：

- 前端开发服务：`http://localhost:5173`
- 后端 API：`http://localhost:3000`
- Agent 服务：`http://localhost:8010`
- 健康检查：`http://localhost:3000/health`

## 后端 / 前端单独运行

### 后端

不需要先编译，可以直接运行：

```bash
go run ./cmd
```

或者：

```bash
task backend
```

如果使用 Docker MySQL：

```bash
task backend:docker
```

### 前端

```bash
cd front
npm run dev
```

或者：

```bash
task frontend
```

前端类型检查和构建：

```bash
cd front
npm run typecheck
npm run build
```

## Docker 运行

仓库根目录已经提供：

- [Dockerfile](/Users/zhangxinghui/Desktop/web/3Xbackend/Dockerfile)
- [docker-compose.yml](/Users/zhangxinghui/Desktop/web/3Xbackend/docker-compose.yml)
- [docker-compose.prod.yml](/Users/zhangxinghui/Desktop/web/3Xbackend/docker-compose.prod.yml)
- [.dockerignore](/Users/zhangxinghui/Desktop/web/3Xbackend/.dockerignore)
- [agent/Dockerfile](/Users/zhangxinghui/Desktop/web/3Xbackend/agent/Dockerfile)

完整 Compose 启动：

```bash
task compose:up
```

关闭：

```bash
task compose:down
```

说明：

- Docker 镜像会同时构建 `front/` 前端产物和 Go 后端二进制
- 运行容器后，前端静态文件由 Go 服务统一托管
- 推荐挂载 `public/` 目录，保留头像和帖子附件
- `agent` 服务会随 Compose 一起启动，监听 `8010`

## 服务器部署

如果要在本地打包后上传到服务器运行，推荐使用 release 包：

```bash
./scripts/package-release.sh
scp dist/3xbackend-release.tar.gz user@server:/opt/
```

服务器上：

```bash
cd /opt
tar -xzf 3xbackend-release.tar.gz
cd 3xbackend-release
cp .env.example .env
vi .env
./scripts/deploy-server.sh
```

详细说明见 [docs/deploy.md](/Users/zhangxinghui/Desktop/web/3Xbackend/docs/deploy.md)。

## Agent

`agent/` 下是一个独立的 LangGraph 服务，默认提供：

- `GET /health`
- `POST /prompt`
- `GET /conversations`
- `GET /conversations/{conversation_id}/messages`
- `POST /chat`

本地启动：

```bash
task agent
```

开发模式下，`task dev` 也会一并拉起 agent。

## data-fetch

`data-fetch/` 下是独立的 FastAPI / AkShare 数据抓取服务，用于后台定时任务和管理员后台手动补数。

默认提供：

- `GET /health`
- `POST /sync/latest`：同步最新金融快照
- `POST /sync/history`：一次性同步完整历史金融数据，写入时按唯一键幂等去重

命令行运行：

```bash
task data:fetch
task data:fetch:history
```

如果 MySQL 在 Docker：

```bash
task data:fetch:docker
```

首次初始化完整演示数据可使用：

```bash
task startup:init
```

这个命令会依次执行历年金融数据补齐、AI 日报全量同步和论坛演示数据注入。

## 市场动态、AI 分析与 AI 日报

项目当前已经将“市场动态”和“AI 日报”拆为两个独立栏目：

- `/market`：只展示贵金属与 AI / 科技市场行情
- `/analysis`：展示 AI 主题趋势、市场趋势和综合联动判断
- `/ai-daily`：只展示 AI 日报内容阅读、搜索和翻页
- `/admin/sync`：管理员后台同步控制台，支持同步最新数据和一次性补齐完整历史数据

说明：`/analysis` 页面本身不直接抓取外部站点，它消费后端已经入库的 AI 日报和市场快照；因此首次查看前，建议先确保市场与 AI 日报同步任务至少跑过一轮。

其中，市场与内容数据来源分为三类：

### 1. 贵金属

数据来源：`Investing.com`

当前默认同步：

- Gold
- Silver
- Platinum
- Palladium

默认行为：

- 服务启动后立即同步一次
- 后续每 `60` 分钟自动同步一次

手动同步：

```bash
task metal:sync
```

现在的产品流程中，普通用户页面不再暴露贵金属手动同步入口；需要手动触发时请使用管理员后台 `/admin/sync` 或 Task 命令。

如果 MySQL 在 Docker：

```bash
task metal:sync:docker
```

### 2. AI / 科技市场

数据来源：`Investing.com`

当前默认同步：

- Nasdaq 100 (`NDX`)
- Invesco QQQ Trust (`QQQ`)
- Technology Select Sector SPDR Fund (`XLK`)
- VanEck Semiconductor ETF (`SMH`)
- iShares Expanded Tech-Software Sector ETF (`IGV`)

默认行为：

- 服务启动后立即同步一次
- 后续每 `120` 分钟自动同步一次

手动同步：

```bash
task tech:sync
```

现在的产品流程中，普通用户页面不再暴露 AI / 科技市场手动同步入口；需要手动触发时请使用管理员后台 `/admin/sync` 或 Task 命令。

如果 MySQL 在 Docker：

```bash
task tech:sync:docker
```

### 3. AI 日报

数据来源：`https://hex2077.dev/docs/`

默认行为：

- 服务启动后立即同步一次
- 后续每 `30` 分钟自动同步一次
- 默认抓取最近 `7` 篇日报

手动同步：

```bash
task ai:daily:sync
```

现在的产品流程中，普通用户页面不再暴露 AI 日报同步或补拉入口；需要手动触发时请使用管理员后台 `/admin/sync` 或 Task 命令。

如果 MySQL 在 Docker：

```bash
task ai:daily:sync:docker
```

### 前端能力

市场动态页当前已支持：

- 贵金属和 AI / 科技标的价格图展示
- 已同步历史点位可视化
- 展示后台定时更新状态

AI 联动分析页当前已支持：

- `AI 趋势`：聚合近 1 / 7 / 30 天 AI 日报主题分布
- `市场趋势`：聚合科技风险偏好与贵金属避险动量
- `综合结论`：联动 AI 信息面与市场面，输出一致 / 背离 / 分化判断
- 窗口切换与独立模块降级提示
- 独立模块数据不足时的降级提示与重试入口

AI 日报栏目当前已支持：

- AI 日报列表搜索
- AI 日报分页加载更多
- AI 日报上一篇 / 下一篇切换
- AI 日报章节导航
- AI 日报正文节选阅读

管理员同步控制台当前已支持：

- 匿名用户访问时提示登录
- 普通用户访问时提示无管理员权限
- 管理员同步最新贵金属、AI / 科技市场、AI 日报
- 管理员一次性同步完整历史数据
- 同步失败时展示后端返回的错误信息

## 测试

测试规划见 [specs/product-test-suite-spec.md](/Users/zhangxinghui/Desktop/web/3Xbackend/specs/product-test-suite-spec.md)。

当前已配置的分层测试：

- Go 后端：`internal/**/*_test.go`
- 前端 E2E：`front/tests/*.spec.ts`
- data-fetch：`data-fetch/tests/*.py`
- Agent：`agent/tests/*.py`

常用命令：

```bash
task test:backend
task test:frontend
task test:data-fetch
task test:agent
task test:all
```

说明：

- `task test:frontend` 会运行 `npm run typecheck` 和 Playwright E2E。
- Playwright 首次运行前需要安装浏览器：`cd front && npx playwright install chromium`。
- `task test:frontend` 已为本地 Vite 地址设置 `NO_PROXY/no_proxy`，避免本地代理影响 `127.0.0.1:5173`。

## 假数据注入

项目提供了独立的种子脚本入口：

- [cmd/seed/main.go](/Users/zhangxinghui/Desktop/web/3Xbackend/cmd/seed/main.go)
- [SEED.md](/Users/zhangxinghui/Desktop/web/3Xbackend/SEED.md)

默认可注入千级规模论坛数据，包括：

- 演示账号
- 帖子
- 评论
- 点赞
- 演示图片和附件

执行方式：

```bash
task seed
```

如果 MySQL 在 Docker：

```bash
task seed:docker
```

默认种子账号密码：

- `Forum123`

默认密保答案：

- `1999`

## 常用 Task 命令

如果本机还没有 `task`，可以先安装：

```bash
brew install go-task/tap/go-task
```

常用命令：

- `task init`：初始化本地环境
- `task db:up`：启动本地 MySQL 容器
- `task db:wait`：等待 MySQL ready
- `task db:down`：停止本地 MySQL 容器
- `task backend`：本地直接 `go run ./cmd`
- `task backend:docker`：拉起 Docker MySQL 后运行后端
- `task frontend`：运行前端开发服务
- `task dev`：本地同时跑前后端
- `task dev:docker`：使用 Docker MySQL 同时跑前后端
- `task build`：检查 Go 构建和前端构建
- `task test:backend`：运行 Go 后端测试
- `task test:frontend`：运行前端类型检查和 E2E 测试
- `task test:data-fetch`：运行 data-fetch pytest
- `task test:agent`：运行 Agent pytest
- `task test:all`：运行所有已配置测试
- `task seed`：注入假数据
- `task metal:sync`：手动执行贵金属同步
- `task tech:sync`：手动执行 AI / 科技市场同步
- `task data:fetch`：使用 AkShare 同步最新金融快照
- `task data:fetch:history`：使用 AkShare 一次性补齐历年金融数据
- `task startup:init`：初始化历年金融数据、AI 日报全量和论坛演示数据
- `task ai:daily:sync`：手动执行 AI 日报同步
- `task agent`：运行 Agent 服务
- `task compose:up`：启动完整 Compose 环境
- `task compose:down`：关闭完整 Compose 环境

## 配置项

主要配置文件：

- [config/config.yaml](/Users/zhangxinghui/Desktop/web/3Xbackend/config/config.yaml)
- [front/.env.example](/Users/zhangxinghui/Desktop/web/3Xbackend/front/.env.example)
- [agent/.env.example](/Users/zhangxinghui/Desktop/web/3Xbackend/agent/.env.example)
- [data-fetch/.env.example](/Users/zhangxinghui/Desktop/web/3Xbackend/data-fetch/.env.example)
- [.env.example](/Users/zhangxinghui/Desktop/web/3Xbackend/.env.example)

常用环境变量：

- `SERVER_PORT`
- `AUTH_SECRET`
- `AUTH_TOKEN_EXPIRE_HOURS`
- `STORAGE_PUBLIC_DIR`
- `STORAGE_IMAGE_DIR`
- `STORAGE_UPLOAD_DIR`
- `DATABASE_MYSQL_USER`
- `DATABASE_MYSQL_PASSWORD`
- `DATABASE_MYSQL_ADDRESS`
- `DATABASE_MYSQL_PORT`
- `DATABASE_MYSQL_SCHEMA`
- `VITE_API_BASE_URL`
- `VITE_ASSET_BASE_URL`

同步相关配置项：

- `sync.precious_metals.enabled`
- `sync.precious_metals.interval_minutes`
- `sync.precious_metals.request_timeout_sec`
- `sync.precious_metals.initial_run_on_startup`
- `sync.precious_metals.source_base_url`
- `sync.precious_metals.user_agent`
- `sync.ai_tech.enabled`
- `sync.ai_tech.interval_minutes`
- `sync.ai_tech.request_timeout_sec`
- `sync.ai_tech.initial_run_on_startup`
- `sync.ai_tech.source_base_url`
- `sync.ai_tech.user_agent`
- `sync.ai_daily.enabled`
- `sync.ai_daily.interval_minutes`
- `sync.ai_daily.request_timeout_sec`
- `sync.ai_daily.initial_run_on_startup`
- `sync.ai_daily.source_base_url`
- `sync.ai_daily.index_path`
- `sync.ai_daily.max_entries`
- `sync.ai_daily.user_agent`

## 新旧前端关系

旧前端目录：

- [example](/Users/zhangxinghui/Desktop/web/3Xbackend/example)

用途：

- 仅用于参考旧页面结构和静态资源
- 不再作为新需求的主要开发目录

新前端目录：

- [front](/Users/zhangxinghui/Desktop/web/3Xbackend/front)

当前约定：

- 新功能优先落在 `front/`
- 与后端联调优先走 `/api/v1/*`
- `example/` 只保留兼容参考价值

## 文档约定

- 后端 API、请求参数、返回字段、同步策略发生变化时，必须同步更新 [API.md](/Users/zhangxinghui/Desktop/web/3Xbackend/API.md)
- 项目运行、初始化、同步、种子脚本发生变化时，应同步更新 `README.md`
- 假数据策略或种子规模变化时，应同步更新 [SEED.md](/Users/zhangxinghui/Desktop/web/3Xbackend/SEED.md)
