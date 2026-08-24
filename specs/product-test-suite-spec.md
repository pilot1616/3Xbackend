# Product Test Suite Spec

## 背景

当前项目已经包含 Go API、React 前端、Python Agent、Python data-fetch、MySQL 和后台同步控制台。测试体系需要覆盖用户使用路径、后台运维路径、数据同步路径和 AI 数据问答路径，避免功能继续扩张后出现“页面能打开但核心流程断掉”的情况。

## 测试目标

- 验证用户账号、论坛、文件、评论、点赞、搜索、个人中心等社区主流程。
- 验证市场数据、AI 日报、分析页在有数据、无数据、数据不足时的表现。
- 验证后台同步只允许管理员使用，普通用户无法触发同步。
- 验证完整历史同步能触发 data-fetch 历史补齐和 AI 日报归档补拉。
- 验证 Agent 代理、只读 SQL 约束、会话记录和错误降级。
- 验证前端关键页面不会白屏，关键按钮不会调用错误接口。
- 提供可在本地和 CI 中运行的分层测试命令。

## 分层策略

### 1. Go 后端测试

位置：

```text
internal/service/*_test.go
internal/handler/*_test.go
internal/middleware/*_test.go
internal/server/*_test.go
```

覆盖范围：

- `auth`：注册、登录、锁定、找回密码、管理员白名单。
- `forum`：帖子、评论、点赞、可见性、搜索、分页、我的内容。
- `upload`：头像、帖子附件、类型限制、大小限制、归属权限。
- `market`：快照读取、历史窗口、空数据、字段映射。
- `ai_daily`：分页、搜索、slug 去重、sections/links 解析。
- `analysis`：AI 主题、市场 regime、综合判断、数据不足。
- `admin_sync`：401/403/200 权限边界、同步结果格式、data-fetch 失败。
- `agent_proxy`：代理成功、agent 不可用、登录会话权限。

优先级：

1. 管理员认证和后台同步权限。
2. 论坛和账号主流程。
3. 数据展示和分析 fixture。
4. Agent 代理和 LLM mock。

### 2. React 前端测试

位置：

```text
front/tests/
front/playwright.config.ts
```

覆盖范围：

- `smoke.spec.ts`：打开核心页面，无白屏、无严重 console error。
- `auth.spec.ts`：登录、注册、redirect、退出。
- `forum.spec.ts`：发帖、附件、详情、评论、点赞、可见性。
- `market.spec.ts`：空态、数据态、不出现前台同步按钮。
- `ai-daily.spec.ts`：归档列表、搜索、阅读、复制链接。
- `analysis.spec.ts`：窗口切换、数据不足提示、Agent 错误降级。
- `admin-sync.spec.ts`：普通用户无权限、管理员可见后台按钮、同步失败提示。

优先级：

1. Smoke 测试和路由可用性。
2. 登录 redirect 和前台不暴露同步按钮。
3. 论坛主流程。
4. 管理后台流程。

### 3. data-fetch 测试

位置：

```text
data-fetch/tests/
```

覆盖范围：

- 配置环境变量解析。
- `/health`、`/sync/latest`、`/sync/history`。
- `insert_record_if_absent` 幂等写入。
- AkShare client 在空数据、异常、正常数据下的转换。
- 后台 loop 不阻塞 HTTP 启动。

优先级：

1. HTTP endpoint 和配置。
2. DB 写入幂等。
3. AkShare mock。

### 4. Agent 测试

位置：

```text
agent/tests/
```

覆盖范围：

- SQL 清洗和只读校验。
- forbidden table 拦截。
- `/health`。
- `/prompt` LLM mock。
- `/chat` 会话、消息、run、LLM 日志。

优先级：

1. SQL 安全。
2. LLM mock。
3. 会话持久化。

## 测试数据策略

测试数据必须可重复生成，避免依赖外部网络。

### Go fixture

建议新增：

```text
internal/testutil/
├── db.go
├── auth.go
├── forum.go
├── market.go
└── server.go
```

职责：

- 初始化 isolated GORM DB。
- 创建普通用户和管理员用户。
- 生成 token。
- 插入帖子、评论、点赞。
- 插入市场快照和 AI 日报。
- 启动 handler/server 测试 router。

### 前端 fixture

Playwright 使用 mock API 或测试后端。第一阶段推荐 route mock，第二阶段接真实测试库。

### data-fetch fixture

用 pytest monkeypatch AkShare 函数，不发真实网络请求。

## 命令规划

新增 Taskfile 任务：

```yaml
test:backend:
  cmds:
    - mkdir -p .cache/go-build
    - GOCACHE=$(pwd)/.cache/go-build go test ./...

test:frontend:
  dir: front
  cmds:
    - npm run typecheck
    - npm run test:e2e

test:data-fetch:
  dir: data-fetch
  cmds:
    - pytest

test:agent:
  dir: agent
  cmds:
    - pytest

test:all:
  cmds:
    - task test:backend
    - task test:frontend
    - task test:data-fetch
    - task test:agent
```

## 落地顺序

### Step 1: 规格与基础命令

- 新增本规格文档。
- 增加 `test:backend`，确保本地 Go cache 不写系统目录。

验收：

- `task test:backend` 可运行。
- 文档提交。

### Step 2: 后端管理员认证测试

- 测试 `AUTH_ADMIN_USERNAMES` / `auth.admin_usernames` 解析。
- 测试 `UserResponse.is_admin`。
- 测试 `AdminRequired` 的 401、403、通过。

验收：

- `go test ./internal/config ./internal/service ./internal/middleware` 通过。

### Step 3: 后台同步 API 测试

- 测试 `/api/v1/admin/sync/*` 权限。
- mock sync service 或 httptest data-fetch。
- 测试 `/api/v1/admin/sync/full-history` 成功和 data-fetch 失败。

验收：

- admin sync handler/server 测试通过。

### Step 4: 前端 E2E 基础设施

- 增加 Playwright。
- 增加 smoke 测试。
- 增加“普通页面不出现同步按钮”的测试。
- 增加 admin 页面权限空态测试。

验收：

- `npm run typecheck` 通过。
- `npm run test:e2e` 可运行。

### Step 5: data-fetch pytest 基础设施

- 增加 pytest 依赖。
- 增加 `/health` 和 `/sync/history` mock 测试。
- 增加 DB 幂等测试。

验收：

- `pytest` 通过。

### Step 6: 论坛和账号主流程

- 后端覆盖 auth/forum/upload 核心单元和 handler。
- 前端覆盖登录、发帖、详情、评论、点赞、可见性。

验收：

- Go 和 Playwright 主流程通过。

### Step 7: 数据分析和 Agent

- 使用 fixture 覆盖市场、AI 日报、分析。
- Agent 覆盖 SQL 只读安全和 LLM mock。

验收：

- 所有模块测试通过。

## 非目标

- 第一阶段不要求真实外部网络抓取。
- 第一阶段不要求真实 LLM 调用。
- 第一阶段不强制引入 Docker 测试库，优先用 mock 和 isolated DB。

## 风险与处理

- 现有服务部分依赖具体 struct，不易 mock：优先增加 httptest 层和配置注入，必要时再抽接口。
- Playwright 安装浏览器可能耗时：CI 可单独缓存，第一阶段先提交配置和 smoke。
- data-fetch 依赖 AkShare 较重：所有测试必须 monkeypatch，不访问网络。
