# 本地打包并部署到服务器

这个项目推荐用 Docker 镜像包部署：本地构建镜像和 release 包，上传到服务器后导入镜像并启动 Compose。

## 1. 本地打包

在项目根目录执行：

```bash
./scripts/package-release.sh
```

默认会生成：

```text
dist/3xbackend-release.tar.gz
```

包内包含：

- `images.tar`：`app`、`agent`、`data-fetch`、`mysql:8.4` 镜像
- `docker-compose.yml`：生产运行用 Compose 文件
- `.env.example`：生产环境变量模板
- `scripts/deploy-server.sh`：服务器启动脚本
- `public/images`、`public/uploads`：运行时静态资源挂载目录

可选变量：

```bash
IMAGE_TAG=2026-08-24 RELEASE_NAME=3xbackend-2026-08-24 ./scripts/package-release.sh
```

## 2. 上传到服务器

```bash
scp dist/3xbackend-release.tar.gz user@server:/opt/
```

服务器上解包：

```bash
cd /opt
tar -xzf 3xbackend-release.tar.gz
cd 3xbackend-release
```

## 3. 配置环境变量

```bash
cp .env.example .env
vi .env
```

至少修改：

- `MYSQL_ROOT_PASSWORD`
- `DATABASE_MYSQL_PASSWORD`
- `AUTH_SECRET`
- `AUTH_ADMIN_USERNAMES`
- `LLM_API_KEY`

## 4. 启动

```bash
./scripts/deploy-server.sh
```

检查服务：

```bash
docker compose ps
curl http://127.0.0.1:3000/health
```

如果服务器前面有 Nginx，只需要把外部域名反代到 `127.0.0.1:3000`。

## 5. 更新版本

本地重新打包并上传新包，服务器解包后执行：

```bash
./scripts/deploy-server.sh
```

脚本会重新 `docker load` 镜像并 `docker compose up -d`。

## 6. 首次数据初始化

服务启动后，后台定时任务会持续同步最新数据。

如果是空库并且需要一次性补齐完整历史数据，请先在 `.env` 中配置 `AUTH_ADMIN_USERNAMES`，用对应管理员账号登录 Web 页面，然后进入：

```text
/admin/sync
```

在管理员同步控制台执行“同步完整历史”。

也可以直接触发 data-fetch 历史同步：

```bash
docker compose exec data-fetch python -m app.main history
```

## 7. 数据和附件

- MySQL 数据保存在 Docker volume `mysql-data`。
- 用户头像和帖子附件挂载在 release 目录的 `public/` 下。
- 更新版本时不要删除服务器上的 `public/` 目录和 Docker volume。
