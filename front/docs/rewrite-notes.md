# Rewrite Notes

## 1. 旧前端结构梳理

`example/html/` 里实际有 5 个核心页面：

- `login.html`
  - 负责登录、注册、忘记密码
  - 大量逻辑基于 `localStorage.registeredUsers`、`localStorage.nowUserInfo`
  - 不是真正依赖后端认证
- `index.html`
  - 首页帖子流
  - 支持按昵称搜索
  - 使用旧接口拉帖子、发表评论、点赞
- `leacots.html`
  - 发帖页
  - 负责上传附件、发帖、查看自己的帖子、撤销发布、删除、编辑
- `album.html`
  - 相册页
  - 实际上是把当前用户帖子的附件抽出来展示
- `about.html`
  - 我的资料页
  - 头像上传调后端，但昵称/年龄/爱好/签名大量保存在 `localStorage.editedUsers`

## 2. 旧前端的主要问题

- 状态分散在 DOM 和 `localStorage`，没有统一数据层
- 登录态是假登录，不是基于后端 token
- 用户资料并没有真正持久化到后端
- 页面间重复读取 `localStorage.nowUserInfo`
- 依赖旧兼容接口，字段命名混合，扩展成本高

## 3. 旧接口 -> 新接口映射

### 登录注册

- 旧实现：浏览器本地数据
- 新接口：
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/login`
  - `GET /api/v1/auth/security-question`
  - `POST /api/v1/auth/reset-password`

### 首页帖子流

- 旧接口：`GET /question_request/`
- 新接口：
  - `GET /api/v1/questions`
  - `GET /api/v1/questions/:qid`
  - `GET /api/v1/questions/:qid/comments`
  - `GET /api/v1/questions/:qid/likes`
  - `POST /api/v1/questions/:qid/comments`
  - `POST /api/v1/questions/:qid/like`
  - `DELETE /api/v1/questions/:qid/like`

### 发帖 / 我的帖子

- 旧接口：
  - `POST /question_file_upload/`
  - `POST /question_upload/`
  - `POST /control_upload/`
  - `POST /delete_upload/`
- 新接口：
  - `POST /api/v1/questions`
  - `POST /api/v1/questions/:qid/files`
  - `DELETE /api/v1/questions/:qid/files/:filename`
  - `PATCH /api/v1/questions/:qid`
  - `DELETE /api/v1/questions/:qid`
  - `POST /api/v1/questions/:qid/toggle-upload`
  - `GET /api/v1/users/me/questions`

### 个人资料 / 相册 / 个人中心

- 旧接口：
  - `POST /file_upload/`
  - `GET /image_info/:filename`
  - 其余资料字段主要依赖浏览器本地存储
- 新接口：
  - `GET /api/v1/users/me`
  - `PATCH /api/v1/users/me`
  - `POST /api/v1/users/me/avatar`
  - `GET /api/v1/users/me/comments`
  - `GET /api/v1/users/me/likes`
  - `GET /api/v1/users/me/summary`

## 4. 后端现状梳理

当前 Go 后端已经具备重写前端所需的主体能力：

- 鉴权：注册、登录、重置密码、当前用户信息
- 用户资料：查看、编辑、头像上传
- 帖子：列表、详情、排序、创建、编辑、删除、发布状态切换
- 附件：上传、删除
- 评论：分页、创建、编辑、删除
- 点赞：点赞、取消点赞、点赞列表
- 个人中心：我的帖子、我的评论、我的点赞、汇总统计

## 5. 新前端的建议模块划分

### `src/api`

- 统一封装请求
- 统一注入 Bearer Token
- 统一处理 401

### `src/lib`

- Session 持久化
- 未来可放全局工具函数

### `src/types`

- 对齐后端响应结构
- 降低页面直接操作原始 JSON 的耦合

### `src/pages`

- `HomePage`
- `AuthPage`
- `PublishPage`
- `AlbumPage`
- `ProfilePage`

## 6. 逐步重写顺序

1. 先完成真实登录和 session 存储。
2. 再完成首页帖子流和帖子详情。
3. 再完成发帖页，包括附件上传和我的帖子管理。
4. 再完成资料页，包括头像和资料更新。
5. 最后补相册页和个人中心增强体验。
