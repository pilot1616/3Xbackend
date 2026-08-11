# 3Xbackend

`3Xbackend` 是一个论坛 + 市场动态的全栈项目，当前仓库同时包含：

- Go 后端服务
- MySQL 数据库
- React + TypeScript 新前端：`front/`
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
- 市场动态页：贵金属行情、AI / 科技市场行情
- AI 联动分析页：AI 日报主题趋势、市场趋势、综合联动判断
- AI 日报独立栏目：日报检索、阅读、章节导航、同步补拉
- 启动后定时同步 `Investing.com` 贵金属数据
- 启动后定时同步 `Investing.com` AI / 科技市场数据
- 启动后定时同步 `hex2077.dev` AI 日报数据
- 独立 `agent/` 服务：接收外部 prompt，联动数据库与 LLM 做分析
- 假数据脚本：可注入千级帖子、评论、点赞和演示图片

## 目录结构

```text
3Xbackend/
├── cmd/                    # Go 程序入口（主服务、同步脚本、种子脚本）
├── config/                 # 后端配置文件
├── internal/               # 业务代码
├── public/                 # 运行时静态资源目录
├── front/                  # 新前端：Vite + React + TypeScript
├── example/                # 旧示例前端，仅供参考
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

## 推荐本地启动方式

推荐直接使用 [Taskfile.yml](/Users/zhangxinghui/Desktop/web/3Xbackend/Taskfile.yml)。

### 1. 初始化环境

```bash
task init
```

这个命令会：

- 创建 `public/images` 和 `public/uploads`
- 补齐 `.env` 和 `front/.env`
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

## Agent

`agent/` 下是一个独立的 LangGraph 服务，默认提供：

- `GET /health`
- `POST /prompt`

本地启动：

```bash
task agent
```

开发模式下，`task dev` 也会一并拉起 agent。

## 市场动态、AI 分析与 AI 日报

项目当前已经将“市场动态”和“AI 日报”拆为两个独立栏目：

- `/market`：只展示贵金属与 AI / 科技市场行情
- `/analysis`：展示 AI 主题趋势、市场趋势和综合联动判断
- `/ai-daily`：只展示 AI 日报内容阅读、搜索、翻页和同步操作

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

如果 MySQL 在 Docker：

```bash
task ai:daily:sync:docker
```

### 前端能力

市场动态页当前已支持：

- 贵金属和 AI / 科技标的价格图展示
- 已同步历史点位可视化
- 登录后手动“立即同步”

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
- 登录后手动同步与补拉

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
- `task seed`：注入假数据
- `task metal:sync`：手动执行贵金属同步
- `task tech:sync`：手动执行 AI / 科技市场同步
- `task ai:daily:sync`：手动执行 AI 日报同步
- `task compose:up`：启动完整 Compose 环境
- `task compose:down`：关闭完整 Compose 环境

## 配置项

主要配置文件：

- [config/config.yaml](/Users/zhangxinghui/Desktop/web/3Xbackend/config/config.yaml)
- [front/.env.example](/Users/zhangxinghui/Desktop/web/3Xbackend/front/.env.example)
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
