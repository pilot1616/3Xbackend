# 3Xbackend

这是一个网络论坛项目，当前仓库同时包含：

- Go 后端服务
- MySQL 数据存储
- 基于 React + TypeScript 的新前端重写目录 `front/`
- 旧示例前端目录 `example/`，仅作为结构和样式参考

## 当前状态

当前项目已经不是单纯的“后端骨架”，而是已经具备可联调的论坛基础能力：

- 用户注册、登录、找回密码
- Token 鉴权和当前用户资料维护
- 头像上传
- 帖子发布、编辑、删除、发布状态切换
- 帖子附件上传与删除
- 帖子列表、单帖详情
- 评论发布、编辑、删除
- 点赞与取消点赞
- 我的帖子、我的评论、我的点赞、个人统计
- 新前端 `front/` 已开始替换原来的 jQuery 示例页面

详细接口说明见 [API.md](/Users/zhangxinghui/Desktop/web/3Xbackend/API.md)。

## 项目结构

```text
3Xbackend/
├── cmd/                    # Go 程序入口
├── config/                 # 后端配置文件
├── internal/               # 业务代码
│   ├── config/             # 配置解析
│   ├── database/           # 数据库初始化与模型
│   ├── handler/            # HTTP Handler
│   ├── middleware/         # 鉴权/CORS 等中间件
│   ├── server/             # 路由注册与服务启动
│   └── service/            # 业务服务层
├── public/                 # 运行时静态资源目录
├── front/                  # 新前端：Vite + React + TypeScript
├── example/                # 旧示例前端，仅供参考
├── API.md                  # 接口文档
└── README.md               # 项目说明
```

## 技术栈

后端：

- Go
- Gin
- GORM
- MySQL
- Viper

前端：

- Vite
- React 18
- TypeScript
- React Router

## 后端启动

### 1. 准备 MySQL

先准备一个可用的 MySQL 数据库，并确认 `config/config.yaml` 中的配置正确。

当前默认配置文件位置：

- [config/config.yaml](/Users/zhangxinghui/Desktop/web/3Xbackend/config/config.yaml)

需要重点确认：

- `database.mysql.user`
- `database.mysql.password`
- `database.mysql.address`
- `database.mysql.port`
- `database.mysql.schema`

### 2. 启动后端

```bash
go run ./cmd
```

默认监听：

- `http://localhost:3000`

健康检查：

```bash
curl http://localhost:3000/health
```

## 前端启动

新前端目录：

- [front](/Users/zhangxinghui/Desktop/web/3Xbackend/front)

### 1. 安装依赖

```bash
cd front
npm install
```

### 2. 启动开发服务

```bash
npm run dev
```

### 3. 类型检查和构建

```bash
npm run typecheck
npm run build
```

### 4. 前端环境变量

示例文件：

- [front/.env.example](/Users/zhangxinghui/Desktop/web/3Xbackend/front/.env.example)

支持的变量：

- `VITE_API_BASE_URL`: 后端 API 根地址，默认 `http://localhost:3000`
- `VITE_ASSET_BASE_URL`: 静态资源根地址，默认跟随 `VITE_API_BASE_URL`

## Docker 运行

仓库根目录已经提供：

- [Dockerfile](/Users/zhangxinghui/Desktop/web/3Xbackend/Dockerfile)
- [.dockerignore](/Users/zhangxinghui/Desktop/web/3Xbackend/.dockerignore)

这个镜像会同时：

- 构建 `front/` 前端产物
- 构建 Go 后端二进制
- 在最终容器中由 Go 服务统一提供 API、前端页面和上传目录

### 1. 构建镜像

```bash
docker build -t 3xbackend .
```

### 2. 运行容器

```bash
docker run --rm -p 3000:3000 \
  -e SERVER_PORT=3000 \
  -e DATABASE_MYSQL_USER=root \
  -e DATABASE_MYSQL_PASSWORD=your-password \
  -e DATABASE_MYSQL_ADDRESS=host.docker.internal \
  -e DATABASE_MYSQL_PORT=3306 \
  -e DATABASE_MYSQL_SCHEMA=3X \
  -v $(pwd)/public:/app/public \
  3xbackend
```

说明：

- 推荐把 `public` 目录挂载出来，保留头像和帖子附件
- 容器内默认工作目录是 `/app`
- 前端页面会由后端直接托管，不需要再额外启动 Vite
- 当前后端已支持通过环境变量覆盖 `config/config.yaml` 中的主要配置

### 3. 可覆盖的常用环境变量

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

## 旧前端与新前端的关系

旧前端目录：

- [example](/Users/zhangxinghui/Desktop/web/3Xbackend/example)

用途：

- 用来参考页面结构和旧视觉资源
- 不再作为最终交付前端继续扩展

新前端目录：

- [front](/Users/zhangxinghui/Desktop/web/3Xbackend/front)

当前策略：

- 先复用旧版 UI 资源
- 再逐步把页面和数据流完全迁移到 TypeScript 前端

## API 文档

接口文档在：

- [API.md](/Users/zhangxinghui/Desktop/web/3Xbackend/API.md)

开发约定：

- 只要后端接口发生变化，就必须同步更新 `API.md`
- 前端开发时优先对齐 `/api/v1/*` 正式接口
- 旧兼容接口只保留兼容用途，不再作为新功能扩展基础

## 当前已完成的主要模块

后端：

- 认证模块
- 用户资料模块
- 论坛帖子模块
- 评论模块
- 点赞模块
- 文件上传模块

前端：

- 登录/注册/重置密码页
- 问题广场页
- 发帖与帖子管理页
- 相册页
- 个人资料页
- 单帖详情页

## 开发约定

- 后端代码变更后，要检查 [API.md](/Users/zhangxinghui/Desktop/web/3Xbackend/API.md) 是否需要同步更新
- 每完成一个独立功能点，单独提交一次 Git commit
- 新前端开发集中在 [front](/Users/zhangxinghui/Desktop/web/3Xbackend/front)
- `example/` 只作为参考，不作为最终前端继续堆功能

## 下一步方向

- 继续完善单帖详情交互
- 完善发帖页上传体验和附件管理
- 继续减少新前端对整份 legacy CSS 的直接依赖
- 逐步把更多页面行为从“复用旧结构”过渡到“真正的新前端结构”
