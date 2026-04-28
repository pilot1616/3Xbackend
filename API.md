# API 文档

Base URL: `http://localhost:3000`

## 通用说明

- 服务端口默认是 `3000`
- 返回格式默认为 `application/json`
- 已开启 CORS，允许跨域访问
- 静态资源通过 `/public/*` 暴露
- 头像目录: `/public/images`
- 帖子附件目录: `/public/uploads`

## 鉴权说明

需要登录的接口使用 Bearer Token:

```http
Authorization: Bearer <token>
```

当前只有 `/api/v1/users/*` 强制要求鉴权。兼容旧前端的论坛接口暂未强制校验 token。

现在新增了 `/api/v1/questions/*` 受保护接口，这组接口要求 Bearer Token，并带所有权校验。

公开读取接口 `GET /api/v1/questions` 和 `GET /api/v1/questions/:qid` 支持可选携带 Bearer Token。

- 如果带了有效 token，返回的帖子对象会额外给出 `likedByMe` 和 `ownedByMe`
- 不带 token 时，这两个字段默认为 `false`

## 健康检查

### `GET /health`

响应示例:

```json
{
  "service": "3Xbackend",
  "status": "ok"
}
```

## 认证接口

### `POST /api/v1/auth/register`

请求体:

```json
{
  "username": "13800138000",
  "password": "abc12345",
  "nickname": "pilot1616",
  "sign": "hello",
  "security_question": "year",
  "security_answer": "2020"
}
```

规则:

- `username` 必须是 11 位手机号
- `password` 必须包含字母和数字，长度至少 6 位
- `security_question` 和 `security_answer` 必填

成功响应 `201`:

```json
{
  "token": "xxx.yyy",
  "expires_at": "2026-04-28T10:00:00+08:00",
  "user": {
    "id": 1,
    "username": "13800138000",
    "nickname": "pilot1616",
    "age": 0,
    "hobby": "",
    "sign": "hello",
    "avatar_path": "/public/images/userImgDefault.png",
    "created_at": "2026-04-27T10:00:00+08:00"
  }
}
```

### `POST /api/v1/auth/login`

请求体:

```json
{
  "username": "13800138000",
  "password": "abc12345"
}
```

成功响应 `200` 与注册成功结构一致。

登录策略:

- 连续失败 3 次锁定 5 分钟
- 失败提示会返回剩余尝试次数或锁定提示

### `POST /api/v1/auth/reset-password`

请求体:

```json
{
  "username": "13800138000",
  "password": "newabc123",
  "security_answer": "2020"
}
```

成功响应 `200`:

```json
{
  "message": "password reset successfully"
}
```

### `GET /api/v1/auth/security-question?username=13800138000`

用于找回密码前查询密保问题。

成功响应 `200`:

```json
{
  "username": "13800138000",
  "security_question": "year"
}
```

### `GET /api/v1/users/me`

请求头:

```http
Authorization: Bearer <token>
```

成功响应 `200`:

```json
{
  "user": {
    "id": 1,
    "username": "13800138000",
    "nickname": "pilot1616",
    "age": 20,
    "hobby": "coding",
    "sign": "hello",
    "avatar_path": "/public/images/13800138000.jpg",
    "created_at": "2026-04-27T10:00:00+08:00"
  }
}
```

### `PATCH /api/v1/users/me`

请求头:

```http
Authorization: Bearer <token>
```

请求体:

```json
{
  "nickname": "pilot1616",
  "age": 20,
  "hobby": "coding",
  "sign": "hello"
}
```

规则:

- `age` 必须在 `0-120` 之间

成功响应 `200`:

```json
{
  "message": "profile updated successfully",
  "user": {
    "id": 1,
    "username": "13800138000",
    "nickname": "pilot1616",
    "age": 20,
    "hobby": "coding",
    "sign": "hello",
    "avatar_path": "/public/images/13800138000.jpg",
    "created_at": "2026-04-27T10:00:00+08:00"
  }
}
```

### `GET /api/v1/users/me/questions`

请求头:

```http
Authorization: Bearer <token>
```

用于获取当前登录用户自己的帖子列表。

查询参数:

- `page`: 页码，默认 `1`
- `page_size`: 每页条数，默认 `20`，最大 `100`
- `keyword`: 按帖子正文关键字过滤
- `sort`: 排序方式，支持 `latest`、`oldest`、`most_liked`、`most_commented`，默认 `latest`
- `is_upload`: 按发布状态过滤，支持 `true/false/1/0`

成功响应 `200`:

- 返回结构与 `GET /api/v1/questions` 一致，但只包含当前登录用户自己的帖子

### `POST /api/v1/users/me/avatar`

请求头:

```http
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

表单字段:

- `image`: 头像文件，必填

成功响应 `200`:

```json
{
  "saved": true,
  "path": "/public/images/13800138000.jpg"
}
```

说明:

- 服务端会按当前登录用户的用户名重命名头像文件
- 上传成功后会自动更新当前用户的 `avatar_path`
- 仅支持 `png/jpg/jpeg/gif`
- 文件大小最大 `5MB`

### `GET /api/v1/users/me/comments`

请求头:

```http
Authorization: Bearer <token>
```

用于获取当前登录用户自己的评论列表。

查询参数:

- `page`: 页码，默认 `1`
- `page_size`: 每页条数，默认 `20`，最大 `100`
- `keyword`: 按评论正文关键字过滤

成功响应 `200`:

```json
{
  "page": 1,
  "page_size": 20,
  "total": 2,
  "records": [
    {
      "id": 10,
      "qid": 1745720000000,
      "time": "2026-04-27 10:05:00",
      "text": "nice",
      "questionText": "hello world"
    }
  ]
}
```

### `GET /api/v1/users/me/likes`

请求头:

```http
Authorization: Bearer <token>
```

用于获取当前登录用户点赞过的帖子列表。

查询参数:

- `page`: 页码，默认 `1`
- `page_size`: 每页条数，默认 `20`，最大 `100`
- `keyword`: 按帖子正文关键字过滤

成功响应 `200`:

```json
{
  "page": 1,
  "page_size": 20,
  "total": 2,
  "records": [
    {
      "id": 5,
      "qid": 1745720000000,
      "likedAt": "2026-04-27 11:00:00",
      "questionUser": "13800138001",
      "questionNickName": "tom",
      "questionText": "hello world",
      "isUpload": true,
      "likesNum": 2,
      "commentsNum": 1
    }
  ]
}
```

### `GET /api/v1/users/me/summary`

请求头:

```http
Authorization: Bearer <token>
```

用于获取当前登录用户在论坛里的统计信息。

成功响应 `200`:

```json
{
  "questionsCount": 3,
  "commentsCount": 12,
  "likesCount": 8
}
```

## 论坛兼容接口

这些接口用于兼容当前 `example/` 里的旧前端调用方式。

## 受保护帖子接口

这组接口是给新前端准备的正式接口，要求登录，且只能操作自己的帖子。

### `GET /api/v1/questions`

公开帖子列表接口，支持分页和过滤。

查询参数:

- `page`: 页码，默认 `1`
- `page_size`: 每页条数，默认 `20`，最大 `100`
- `author`: 按用户名或昵称过滤
- `keyword`: 按帖子正文关键字过滤
- `sort`: 排序方式，支持 `latest`、`oldest`、`most_liked`、`most_commented`，默认 `latest`
- `is_upload`: 按发布状态过滤，支持 `true/false/1/0`

请求示例:

```http
GET /api/v1/questions?page=1&page_size=10&author=pilot1616&keyword=hello&sort=most_liked&is_upload=true
```

成功响应 `200`:

```json
{
  "page": 1,
  "page_size": 10,
  "total": 23,
  "records": [
    {
      "qid": 1745720000000,
      "isUpload": true,
      "user": "13800138000",
      "nickName": "pilot1616",
      "time": "2026-04-27 10:00:00",
      "text": "hello world",
      "files": ["1745720000000_demo.jpg"],
      "imgName": ["demo.jpg"],
      "avatarPath": "/public/images/13800138000.jpg",
      "likesNum": 1,
      "commentsNum": 1,
      "likedByMe": false,
      "ownedByMe": false,
      "comments": [
        {
          "id": 10,
          "user": "13800138001",
          "nickName": "tom",
          "time": "2026-04-27 10:05:00",
          "text": "nice"
        }
      ]
    }
  ]
}
```

说明:

- 帖子对象中的 `avatarPath` 表示发帖用户头像路径，前端可直接拼接静态资源域名访问
- 帖子对象中的 `likedByMe` 表示当前请求用户是否已点赞该帖子
- 帖子对象中的 `ownedByMe` 表示当前请求用户是否是该帖子作者

### `POST /api/v1/questions`

请求头:

```http
Authorization: Bearer <token>
```

请求体:

```json
{
  "nickName": "pilot1616",
  "text": "hello world",
  "files": ["1745720000000_demo.jpg"],
  "imgName": ["demo.jpg"]
}
```

成功响应 `201`:

- 返回新建后的帖子对象，结构与 `records[i]` 一致

约束:

- `text` 不能为空
- `text` 最大长度为 5000 个字符

### `POST /api/v1/questions/:qid/files`

请求头:

```http
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

表单字段:

- `files`: 附件文件列表，推荐使用这个字段名
- `file`: 兼容单文件/旧字段名，也可使用

说明:

- 只能上传到当前登录用户自己的帖子
- 上传成功后会自动写入帖子附件记录，无需再单独创建附件元数据
- 仅支持 `png/jpg/jpeg/gif/mp4`
- 单个文件大小最大 `20MB`

成功响应 `200`:

```json
{
  "saved": true,
  "files": ["1745720000000_demo.jpg"],
  "imgName": ["demo.jpg"]
}
```

### `DELETE /api/v1/questions/:qid/files/:filename`

请求头:

```http
Authorization: Bearer <token>
```

说明:

- 只能删除当前登录用户自己帖子的附件
- `filename` 使用服务端保存后的文件名，例如 `1745720000000_demo.jpg`

成功响应 `200`:

```json
{
  "deleted": true,
  "file": "1745720000000_demo.jpg"
}
```

### `GET /api/v1/questions/:qid`

获取单条帖子详情。

成功响应 `200`:

- 返回单条帖子对象，结构与 `records[i]` 一致

### `GET /api/v1/questions/:qid/comments`

公开评论分页接口。

查询参数:

- `page`: 页码，默认 `1`
- `page_size`: 每页条数，默认 `20`，最大 `100`

成功响应 `200`:

```json
{
  "page": 1,
  "page_size": 20,
  "total": 3,
  "records": [
    {
      "id": 10,
      "user": "13800138001",
      "nickName": "tom",
      "time": "2026-04-27 10:05:00",
      "text": "nice"
    }
  ]
}
```

### `GET /api/v1/questions/:qid/likes`

公开点赞分页接口。

查询参数:

- `page`: 页码，默认 `1`
- `page_size`: 每页条数，默认 `20`，最大 `100`

成功响应 `200`:

```json
{
  "page": 1,
  "page_size": 20,
  "total": 2,
  "records": [
    {
      "id": 5,
      "user": "13800138001",
      "nickName": "tom",
      "time": "2026-04-27 11:00:00"
    }
  ]
}
```

### `PATCH /api/v1/questions/:qid`

请求头:

```http
Authorization: Bearer <token>
```

请求体:

```json
{
  "nickName": "pilot1616",
  "text": "updated text",
  "isUpload": true,
  "files": ["1745720000000_demo.jpg"],
  "imgName": ["demo.jpg"]
}
```

说明:

- 只有帖子作者能修改
- 如果传 `files`，后端会用这组文件清单重建帖子附件记录
- 如果附件清单里移除了旧文件，后端会删除对应磁盘文件
- `text` 如果传入则不能为空，最大长度为 5000 个字符

成功响应 `200`:

- 返回更新后的帖子对象

### `DELETE /api/v1/questions/:qid`

请求头:

```http
Authorization: Bearer <token>
```

说明:

- 只有帖子作者能删除

成功响应 `200`:

```json
{
  "deleted": true
}
```

### `POST /api/v1/questions/:qid/toggle-upload`

请求头:

```http
Authorization: Bearer <token>
```

说明:

- 只有帖子作者能切换发布状态

成功响应 `200`:

```json
{
  "uploadFlag": false
}
```

### `POST /api/v1/questions/:qid/comments`

请求头:

```http
Authorization: Bearer <token>
```

请求体:

```json
{
  "text": "nice"
}
```

约束:

- `text` 不能为空
- `text` 最大长度为 1000 个字符

成功响应 `201`:

- 返回更新后的整条帖子对象

说明:

- 返回体中的 `comments[*].id` 可用于删除评论

### `PATCH /api/v1/questions/:qid/comments/:commentID`

请求头:

```http
Authorization: Bearer <token>
```

请求体:

```json
{
  "text": "updated comment"
}
```

约束:

- `text` 不能为空
- `text` 最大长度为 1000 个字符

说明:

- 只有评论作者本人能修改评论

成功响应 `200`:

- 返回更新后的整条帖子对象

### `DELETE /api/v1/questions/:qid/comments/:commentID`

请求头:

```http
Authorization: Bearer <token>
```

说明:

- 只有评论作者本人能删除评论
- 评论不存在时返回 `404 comment not found`

成功响应 `200`:

- 返回删除后的整条帖子对象

### `POST /api/v1/questions/:qid/like`

请求头:

```http
Authorization: Bearer <token>
```

成功响应 `200`:

```json
{
  "liked": true,
  "likesNum": 2
}
```

说明:

- 同一用户重复点赞不会重复累加

### `DELETE /api/v1/questions/:qid/like`

请求头:

```http
Authorization: Bearer <token>
```

成功响应 `200`:

```json
{
  "liked": false,
  "likesNum": 1
}
```

说明:

- 用于取消当前用户对该帖子的点赞
- 如果当前用户本来没有点过赞，也会返回当前点赞状态，不报错

### `GET /question_request/`

返回帖子列表。

成功响应示例:

```json
{
  "length": 1,
  "records": [
    {
      "qid": 1745720000000,
      "isUpload": true,
      "user": "13800138000",
      "nickName": "pilot1616",
      "time": "2026-04-27 10:00:00",
      "text": "hello world",
      "files": ["1745720000000_demo.jpg"],
      "imgName": ["demo.jpg"],
      "likesNum": 1,
      "commentsNum": 1,
      "comments": [
        {
          "id": 10,
          "user": "13800138001",
          "nickName": "tom",
          "time": "2026-04-27 10:05:00",
          "text": "nice"
        }
      ]
    }
  ]
}
```

### `POST /question_upload/`

创建帖子元数据。

请求体:

```json
{
  "qid": 1745720000000,
  "isUpload": true,
  "user": "13800138000",
  "nickName": "pilot1616",
  "text": "hello world",
  "files": ["1745720000000_demo.jpg"],
  "imgName": ["demo.jpg"]
}
```

成功响应 `200`:

- 返回新建后的帖子对象，结构与 `records[i]` 一致

### `POST /question_file_upload/`

上传帖子附件。

请求格式: `multipart/form-data`

字段:

- `qid`: 帖子 ID
- `file`: 可重复多个

示例:

```bash
curl -X POST http://localhost:3000/question_file_upload/ \
  -F "qid=1745720000000" \
  -F "file=@demo.jpg" \
  -F "file=@demo.mp4"
```

成功响应:

```json
{
  "saved": true,
  "files": [
    "1745720000000_demo.jpg",
    "1745720000000_demo.mp4"
  ]
}
```

说明:

- 仅支持 `png/jpg/jpeg/gif/mp4`
- 单个文件大小最大 `20MB`
- 服务端新建帖子时会自动生成 `qid`，该值以毫秒时间戳为基准，并保持在 JavaScript 安全整数范围内

### `POST /comment_upload/`

请求体:

```json
{
  "qid": 1745720000000,
  "user": "13800138001",
  "nickName": "tom",
  "text": "nice"
}
```

成功响应:

- 返回更新后的整条帖子对象

### `POST /like_upload/`

请求体:

```json
{
  "qid": 1745720000000,
  "user": "13800138001",
  "nickName": "tom"
}
```

成功响应:

```json
{
  "liked": true,
  "likesNum": 2
}
```

说明:

- 同一 `user` 对同一帖子重复点赞不会重复累加

### `POST /control_upload/`

切换帖子发布状态。

请求体:

```json
{
  "qid": 1745720000000,
  "user": "13800138000"
}
```

说明:

- `user` 现在是可选字段
- 如果传了 `user`，后端会按用户名做所有权校验
- 不传时仍保持旧兼容行为

成功响应:

```json
{
  "uploadFlag": false
}
```

### `POST /delete_upload/`

删除帖子及其评论、点赞、附件记录。

请求体:

```json
{
  "qid": 1745720000000,
  "user": "13800138000"
}
```

说明:

- `user` 现在是可选字段
- 如果传了 `user`，后端会按用户名做所有权校验
- 不传时仍保持旧兼容行为

成功响应:

```json
{
  "deleted": true
}
```

## 图片与头像接口

### `POST /file_upload/`

上传用户头像。

请求格式: `multipart/form-data`

字段:

- `image`: 图片文件
- `username`: 可选，显式指定用户名

说明:

- 如果不传 `username`，后端会尝试从文件名主干推断用户名
- 当用户名匹配到用户时，会自动更新该用户的 `avatar_path`
- 仅支持 `png/jpg/jpeg/gif`
- 文件大小最大 `5MB`

示例:

```bash
curl -X POST http://localhost:3000/file_upload/ \
  -F "username=13800138000" \
  -F "image=@avatar.jpg;filename=13800138000.jpg"
```

成功响应:

```json
{
  "saved": true,
  "path": "/public/images/13800138000.jpg"
}
```

### `GET /image_info/:filename`

查询头像文件是否存在，支持 JSONP。

示例:

```http
GET /image_info/13800138000.jpg
```

成功响应:

```json
{
  "status": 200,
  "path": "/public/images/13800138000.jpg"
}
```

未找到响应:

```json
{
  "status": 404,
  "error": "image not found"
}
```

JSONP 示例:

```http
GET /image_info/13800138000.jpg?callback=foo
```

## 静态资源访问

- `/public/images/userImgDefault.png`
- `/public/images/13800138000.jpg`
- `/public/uploads/1745720000000_demo.jpg`

## 当前限制

- 论坛兼容接口目前仍然没有强制 token 校验
- 论坛兼容接口优先保证能承接旧示例，不代表最终 REST 设计
- 新前端应优先使用 `/api/v1/questions/*` 这一组受保护帖子接口
- 受保护帖子接口当前已经覆盖: 创建、单条查询、编辑、删除、切换发布、评论、删评论、点赞
- 个人资料里的 `age/hobby/sign` 已进入后端，旧示例里基于 `localStorage` 的资料逻辑后续应改成调用 `/api/v1/users/me`
