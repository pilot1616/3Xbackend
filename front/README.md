# front

这个目录用于用 TypeScript 重写原来的 `example/` 前端。

## 为什么要重写

旧前端的问题很明显：

- 使用 jQuery 直接操作 DOM，页面间逻辑重复
- 登录、注册、资料编辑大量依赖 `localStorage` 假数据
- 论坛页面调用的是旧兼容接口，不适合继续扩展
- 页面结构是多份静态 HTML，后续维护成本高

## 旧页面到新页面映射

- `example/html/login.html` -> `/auth`
- `example/html/index.html` -> `/`
- `example/html/leacots.html` -> `/publish`
- `example/html/album.html` -> `/album`
- `example/html/about.html` -> `/profile`

## 后端对接原则

新前端优先使用正式接口：

- 认证：`/api/v1/auth/*`
- 用户：`/api/v1/users/me*`
- 论坛：`/api/v1/questions*`

不再基于以下旧兼容接口继续扩展：

- `/question_request/`
- `/question_upload/`
- `/comment_upload/`
- `/like_upload/`
- `/control_upload/`
- `/delete_upload/`

## 当前已落地的基础能力

- Vite + React + TypeScript 工程骨架
- 路由和基础布局
- Session 存储
- API 类型定义与请求封装
- 首页、认证页、发帖页、相册页、资料页基础骨架
- 已开始复用旧版视觉资源：`main.css`、`logo.png`、`banner`/背景图、`layui` 图标与按钮样式
- 首页已接真实帖子列表、单帖详情跳转、点赞切换、点赞列表分页查看、评论分页、评论提交、评论编辑、评论删除
- 认证页已接真实登录、注册、重置密码，并补了手机号/密码/密保字段前端校验
- 发帖页已接真实发帖、附件上传、帖子编辑、删除、发布状态切换、附件删除，并补了关键字筛选、本地附件预览、文件类型与大小校验
- 单帖详情页已接作者更多帖子联动
- 相册页已接“我的帖子”附件聚合展示，并支持跳转到原帖详情
- 资料页已接真实资料读取、资料更新、头像上传、我的评论分页、我的点赞分页、统计汇总，并支持跳转到原帖详情
- 已支持通过环境变量切换 API 与静态资源基址

## 本地运行

```bash
cd front
npm install
npm run dev
```

构建检查:

```bash
npm run typecheck
npm run build
```

## 环境变量

- `VITE_API_BASE_URL`: 后端 API 根地址，默认 `http://localhost:3000`
- `VITE_ASSET_BASE_URL`: 静态资源根地址，默认跟随 `VITE_API_BASE_URL`

## 下一步建议

1. 继续打磨单帖详情交互，比如评论时间线展示和更完整的相关推荐策略。
2. 给发帖页补上传进度，以及已上传附件的更细筛选或批量操作。
3. 给资料页和相册页补更多帖子联动信息，比如作者、发布时间和回到广场筛选。
4. 把复用旧 UI 的阶段性样式再收束一层，减少对整份 legacy CSS 的直接依赖。
