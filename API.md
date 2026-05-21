# API 文档

Base URL: `http://localhost:3000`

## 通用说明

- 默认服务端口是 `3000`
- 默认返回格式是 `application/json`
- 已开启 CORS，前后端可跨域联调
- 静态资源通过 `/public/*` 暴露
- 头像目录：`/public/images`
- 帖子附件目录：`/public/uploads`

## 鉴权说明

需要登录的接口使用 Bearer Token：

```http
Authorization: Bearer <token>
```

鉴权规则：

- `/api/v1/users/*` 全部需要登录
- `POST/PATCH/DELETE /api/v1/questions/*` 需要登录，并带作者/所有权校验
- `POST /api/v1/market/*/sync` 和 `POST /api/v1/ai-dailies/sync` 需要登录
- `GET /api/v1/questions` 和 `GET /api/v1/questions/:qid` 支持可选登录态

公开帖子接口在带有效 token 时会额外返回：

- `likedByMe`：当前用户是否已点赞
- `ownedByMe`：当前用户是否是作者

未携带 token 时，这两个字段默认为 `false`。

## 健康检查

### `GET /health`

成功响应 `200`：

```json
{
  "service": "3Xbackend",
  "status": "ok"
}
```

## 市场数据接口

### `GET /api/v1/market/precious-metals`

公开接口，返回后端已同步入库的贵金属快照和短期价格历史。

查询参数：

- `history_limit`：每个品种返回的历史点位数量，默认 `24`，最大 `240`

成功响应 `200`：

```json
{
  "updatedAt": "2026-05-11T10:30:00+08:00",
  "records": [
    {
      "symbol": "XAU",
      "name": "Gold",
      "sourceUrl": "https://www.investing.com/commodities/gold",
      "price": "3348.25",
      "change": "+12.80",
      "changePercent": "+0.38%",
      "prevClose": "3335.45",
      "open": "3338.10",
      "bid": "3348.10",
      "ask": "3348.40",
      "dayRange": "3329.80 - 3354.20",
      "week52Range": "2298.40 - 3509.90",
      "volume": "128.62K",
      "avgVolume": "189.31K",
      "lastUpdateText": "Last Update: May 11, 2026 10:29AM ET",
      "contractMonth": "Jun 26",
      "settlementDate": "2026-06-26",
      "tickSize": "0.1",
      "contractSize": "100 Troy Ounces",
      "tickValue": "10",
      "baseUnit": "1 Troy Ounce",
      "fetchedAt": "2026-05-11T10:30:00+08:00",
      "history": [
        {
          "price": "3339.10",
          "fetchedAt": "2026-05-11T09:30:00+08:00"
        },
        {
          "price": "3348.25",
          "fetchedAt": "2026-05-11T10:30:00+08:00"
        }
      ]
    }
  ]
}
```

说明：

- 当前默认同步 `Gold / Silver / Platinum / Palladium`
- `history` 按时间升序返回，前端可直接用于折线图
- 数据来自后端抓取 `Investing.com` 页面，不是实时第三方行情 API

### `POST /api/v1/market/precious-metals/sync`

受保护接口，需要 Bearer Token。用于手动触发一次贵金属同步，适合首次初始化、前端手动更新、补少量历史点位。

查询参数：

- `rounds`：连续同步轮数，默认 `1`，最大 `24`
- `interval_ms`：轮次间隔毫秒数，默认 `800`，最大 `30000`

请求头：

```http
Authorization: Bearer <token>
```

成功响应 `200`：

```json
{
  "message": "precious metal sync completed",
  "targetCount": 4,
  "successCount": 4,
  "failedSymbols": [],
  "failedDetails": [],
  "fetchedAt": "2026-05-13T16:00:00+08:00",
  "partial": false
}
```

说明：

- 当 `rounds > 1` 时，`message` 会附带批量同步说明
- 允许部分成功；如果个别品种失败，接口仍返回 `200`，并通过 `partial / failedSymbols / failedDetails` 说明失败项
- 登录后前端“市场动态”页可直接调用这个接口做“立即同步”和“补历史”

### `GET /api/v1/market/ai-tech`

公开接口，返回后端已同步入库的 AI / 科技相关指数、ETF、热门科技标的快照和短期价格历史。

查询参数：

- `history_limit`：每个标的返回的历史点位数量，默认 `24`，最大 `240`

成功响应 `200`：

```json
{
  "updatedAt": "2026-05-13T15:30:00+08:00",
  "records": [
    {
      "category": "etf",
      "symbol": "QQQ",
      "name": "Invesco QQQ Trust",
      "sourceUrl": "https://www.investing.com/etfs/powershares-qqqq",
      "price": "714.71",
      "change": "+7.47",
      "changePercent": "(+1.06%)",
      "prevClose": "707.24",
      "open": "709.35",
      "bid": "",
      "ask": "",
      "dayRange": "709.25 - 715.11",
      "week52Range": "402.39 - 715.11",
      "volume": "34.12M",
      "avgVolume": "46.81M",
      "marketCap": "",
      "peRatio": "",
      "beta": "",
      "eps": "",
      "dividend": "",
      "yield": "",
      "lastUpdateText": "Last Update: May 13, 2026 03:29PM ET",
      "fetchedAt": "2026-05-13T15:30:00+08:00",
      "history": [
        {
          "price": "708.20",
          "fetchedAt": "2026-05-13T13:30:00+08:00"
        },
        {
          "price": "714.71",
          "fetchedAt": "2026-05-13T15:30:00+08:00"
        }
      ]
    }
  ]
}
```

说明：

- 当前默认同步 `NDX / QQQ / XLK / SMH / IGV`
- `category` 用于区分 `equity / index / etf`
- `history` 按时间升序返回，前端可直接用于价格图

### `POST /api/v1/market/ai-tech/sync`

受保护接口，需要 Bearer Token。用于手动触发一次 AI / 科技市场同步。

查询参数：

- `rounds`：连续同步轮数，默认 `1`，最大 `24`
- `interval_ms`：轮次间隔毫秒数，默认 `800`，最大 `30000`

请求头：

```http
Authorization: Bearer <token>
```

成功响应 `200`：

```json
{
  "message": "ai tech market sync completed",
  "targetCount": 5,
  "successCount": 5,
  "failedSymbols": [],
  "failedDetails": [],
  "fetchedAt": "2026-05-13T16:00:00+08:00",
  "partial": false
}
```

说明：

- 适合首次拉取、手动刷新、快速补短历史数据
- 部分失败时仍可能返回 `200`，请结合 `partial` 字段判断

## AI 日报接口

### `GET /api/v1/ai-dailies`

公开接口，返回后端已同步入库的 `hex2077.dev` AI 日报内容。

查询参数：

- `limit`：返回条数，默认 `20`，最大 `200`
- `offset`：偏移量，默认 `0`
- `keyword`：可选关键词，按标题、摘要、正文、发布日期、`slug` 模糊匹配

成功响应 `200`：

```json
{
  "updatedAt": "2026-05-20T10:30:00+08:00",
  "offset": 0,
  "limit": 20,
  "total": 87,
  "hasMore": true,
  "records": [
    {
      "title": "AI日报 2026/05/20",
      "slug": "docs/2026-05/2026-05-20/",
      "sourceUrl": "https://hex2077.dev/docs/2026-05/2026-05-20/",
      "publishedDate": "2026-05-20",
      "summary": "今日 AI 资讯摘要...",
      "readTime": "6 min read",
      "content": "全文抓取后的正文摘要...",
      "sections": [
        {
          "heading": "今日看点",
          "items": ["条目 1", "条目 2"]
        }
      ],
      "links": [
        {
          "title": "原文链接",
          "url": "https://..."
        }
      ],
      "fetchedAt": "2026-05-20T10:30:00+08:00"
    }
  ]
}
```

分页语义说明：

- 后端会先按 `published_date desc, fetched_at desc, id desc` 查询快照
- 再按 `slug` 去重，只保留同一篇日报最新一次同步结果
- `total` 表示去重后的可见日报总数，不是原始快照行数
- 前端“加载更多”建议使用：`offset = 当前已经加载的 records.length`
- `hasMore = true` 表示后面仍有更多去重后的日报可继续翻页

### `POST /api/v1/ai-dailies/sync`

受保护接口，需要 Bearer Token。用于手动触发一次 AI 日报同步，适合首次拉取、手动补数据、前端点击“立即同步”。

查询参数：

- `rounds`：连续同步轮数，默认 `1`，最大 `24`
- `interval_ms`：轮次间隔毫秒数，默认 `800`，最大 `30000`

请求头：

```http
Authorization: Bearer <token>
```

成功响应 `200`：

```json
{
  "message": "ai daily sync completed",
  "targetCount": 7,
  "successCount": 7,
  "failedSymbols": [],
  "failedDetails": [],
  "fetchedAt": "2026-05-20T10:30:00+08:00",
  "partial": false
}
```

说明：

- 数据源是 `https://hex2077.dev/docs/`
- 主要用于抓取最近一批日报索引并落库
- 支持多轮同步，用于短时间内补齐新增内容或验证抓取链路

## 认证接口

### `POST /api/v1/auth/register`

请求体：

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

规则：

- `username` 必须是 11 位手机号
- `password` 必须包含字母和数字，长度至少 6 位
- `security_question` 和 `security_answer` 必填

成功响应 `201`：

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

请求体：

```json
{
  "username": "13800138000",
  "password": "abc12345"
}
```

成功响应 `200`：

- 返回结构与注册成功一致

登录策略：

- 连续失败 3 次锁定 5 分钟
- 失败提示会返回剩余尝试次数或锁定提示

### `POST /api/v1/auth/reset-password`

请求体：

```json
{
  "username": "13800138000",
  "password": "newabc123",
  "security_answer": "2020"
}
```

成功响应 `200`：

```json
{
  "message": "password reset successfully"
}
```

### `GET /api/v1/auth/security-question?username=13800138000`

用于找回密码前查询密保问题。

成功响应 `200`：

```json
{
  "username": "13800138000",
  "security_question": "year"
}
```

## 用户资料接口

### `GET /api/v1/users/me`

请求头：

```http
Authorization: Bearer <token>
```

成功响应 `200`：

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

请求头：

```http
Authorization: Bearer <token>
```

请求体：

```json
{
  "nickname": "pilot1616",
  "age": 20,
  "hobby": "coding",
  "sign": "hello"
}
```

规则：

- `age` 必须在 `0-120` 之间

成功响应 `200`：

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

### `POST /api/v1/users/me/avatar`

请求头：

```http
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

表单字段：

- `image`：头像文件，必填

成功响应 `200`：

```json
{
  "saved": true,
  "path": "/public/images/13800138000.jpg"
}
```

说明：

- 服务端会按当前登录用户用户名重命名头像文件
- 上传成功后会自动更新用户 `avatar_path`
- 仅支持 `png/jpg/jpeg/gif`
- 文件大小最大 `5MB`

### `GET /api/v1/users/me/questions`

请求头：

```http
Authorization: Bearer <token>
```

用于获取当前登录用户自己的帖子列表。

查询参数：

- `page`：页码，默认 `1`
- `page_size`：每页条数，默认 `20`，最大 `100`
- `keyword`：按帖子正文关键字过滤
- `sort`：排序方式，支持 `latest`、`oldest`、`most_liked`、`most_commented`，默认 `latest`
- `is_upload`：按发布状态过滤，支持 `true/false/1/0`

成功响应 `200`：

- 返回结构与 `GET /api/v1/questions` 一致，但只包含当前登录用户自己的帖子

### `GET /api/v1/users/me/comments`

请求头：

```http
Authorization: Bearer <token>
```

用于获取当前登录用户自己的评论列表。

查询参数：

- `page`：页码，默认 `1`
- `page_size`：每页条数，默认 `20`，最大 `100`
- `keyword`：按评论正文关键字过滤

成功响应 `200`：

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

请求头：

```http
Authorization: Bearer <token>
```

用于获取当前登录用户点赞过的帖子列表。

查询参数：

- `page`：页码，默认 `1`
- `page_size`：每页条数，默认 `20`，最大 `100`
- `keyword`：按帖子正文关键字过滤

成功响应 `200`：

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

请求头：

```http
Authorization: Bearer <token>
```

用于获取当前登录用户在论坛里的统计信息。

成功响应 `200`：

```json
{
  "questionsCount": 3,
  "commentsCount": 12,
  "likesCount": 8
}
```

## 帖子与评论接口

### `GET /api/v1/questions`

公开帖子列表接口，支持分页和过滤。

查询参数：

- `page`：页码，默认 `1`
- `page_size`：每页条数，默认 `20`，最大 `100`
- `author`：按用户名或昵称过滤
- `keyword`：按帖子正文关键字过滤
- `sort`：排序方式，支持 `latest`、`oldest`、`most_liked`、`most_commented`，默认 `latest`
- `is_upload`：按发布状态过滤，支持 `true/false/1/0`

请求示例：

```http
GET /api/v1/questions?page=1&page_size=10&author=pilot1616&keyword=hello&sort=most_liked&is_upload=true
```

成功响应 `200`：

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
          "text": "nice",
          "avatarPath": "/public/images/13800138001.jpg"
        }
      ]
    }
  ]
}
```

说明：

- `avatarPath` 是发帖用户头像路径
- `likedByMe` 和 `ownedByMe` 只有在带有效 token 请求时才有真实状态
- 列表接口会带简要评论数据；完整互动建议进入详情页后再调评论分页接口

### `POST /api/v1/questions`

请求头：

```http
Authorization: Bearer <token>
```

请求体：

```json
{
  "nickName": "pilot1616",
  "text": "hello world",
  "files": ["1745720000000_demo.jpg"],
  "imgName": ["demo.jpg"]
}
```

成功响应 `201`：

- 返回新建后的帖子对象，结构与 `GET /api/v1/questions` 中 `records[i]` 一致

约束：

- `text` 不能为空
- `text` 最大长度 `5000`

### `GET /api/v1/questions/:qid`

获取单条帖子详情。

成功响应 `200`：

- 返回单条帖子对象，结构与 `records[i]` 一致

### `PATCH /api/v1/questions/:qid`

请求头：

```http
Authorization: Bearer <token>
```

请求体：

```json
{
  "nickName": "pilot1616",
  "text": "updated text",
  "isUpload": true,
  "files": ["1745720000000_demo.jpg"],
  "imgName": ["demo.jpg"]
}
```

说明：

- 只有帖子作者能修改
- 如果传 `files`，后端会按这组文件清单重建附件记录
- 如果附件清单移除了旧文件，后端会删除对应磁盘文件
- `text` 如果传入则不能为空，最大长度 `5000`

成功响应 `200`：

- 返回更新后的帖子对象

### `DELETE /api/v1/questions/:qid`

请求头：

```http
Authorization: Bearer <token>
```

说明：

- 只有帖子作者能删除

成功响应 `200`：

```json
{
  "deleted": true
}
```

### `POST /api/v1/questions/:qid/toggle-upload`

请求头：

```http
Authorization: Bearer <token>
```

说明：

- 只有帖子作者能切换发布状态

成功响应 `200`：

```json
{
  "uploadFlag": false
}
```

### `POST /api/v1/questions/:qid/files`

请求头：

```http
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

表单字段：

- `files`：附件文件列表，推荐字段名
- `file`：兼容旧单文件字段

说明：

- 只能上传到当前登录用户自己的帖子
- 上传成功后会自动写入附件记录，无需额外创建元数据
- 仅支持 `png/jpg/jpeg/gif/mp4`
- 单个文件最大 `20MB`

成功响应 `200`：

```json
{
  "saved": true,
  "files": ["1745720000000_demo.jpg"],
  "imgName": ["demo.jpg"]
}
```

### `DELETE /api/v1/questions/:qid/files/:filename`

请求头：

```http
Authorization: Bearer <token>
```

说明：

- 只能删除当前登录用户自己帖子的附件
- `filename` 使用服务端保存后的文件名，例如 `1745720000000_demo.jpg`

成功响应 `200`：

```json
{
  "deleted": true,
  "file": "1745720000000_demo.jpg"
}
```

### `GET /api/v1/questions/:qid/comments`

公开评论分页接口。

查询参数：

- `page`：页码，默认 `1`
- `page_size`：每页条数，默认 `20`，最大 `100`

成功响应 `200`：

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
      "text": "nice",
      "avatarPath": "/public/images/13800138001.jpg"
    }
  ]
}
```

### `POST /api/v1/questions/:qid/comments`

请求头：

```http
Authorization: Bearer <token>
```

请求体：

```json
{
  "text": "nice"
}
```

约束：

- `text` 不能为空
- `text` 最大长度 `1000`

成功响应 `201`：

- 返回更新后的整条帖子对象

### `PATCH /api/v1/questions/:qid/comments/:commentID`

请求头：

```http
Authorization: Bearer <token>
```

请求体：

```json
{
  "text": "updated comment"
}
```

约束：

- `text` 不能为空
- `text` 最大长度 `1000`

说明：

- 只有评论作者本人能修改评论

成功响应 `200`：

- 返回更新后的整条帖子对象

### `DELETE /api/v1/questions/:qid/comments/:commentID`

请求头：

```http
Authorization: Bearer <token>
```

说明：

- 只有评论作者本人能删除评论
- 评论不存在时返回 `404 comment not found`

成功响应 `200`：

- 返回删除后的整条帖子对象

### `GET /api/v1/questions/:qid/likes`

公开点赞分页接口。

查询参数：

- `page`：页码，默认 `1`
- `page_size`：每页条数，默认 `20`，最大 `100`

成功响应 `200`：

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

### `POST /api/v1/questions/:qid/like`

请求头：

```http
Authorization: Bearer <token>
```

成功响应 `200`：

```json
{
  "liked": true,
  "likesNum": 2
}
```

说明：

- 同一用户重复点赞不会重复累加

### `DELETE /api/v1/questions/:qid/like`

请求头：

```http
Authorization: Bearer <token>
```

成功响应 `200`：

```json
{
  "liked": false,
  "likesNum": 1
}
```

说明：

- 用于取消当前用户对该帖子的点赞
- 如果当前用户原本未点赞，也会返回当前点赞状态，不报错

## 兼容旧前端接口

这组接口用于兼容 `example/` 目录下的旧前端调用方式，不建议新功能继续基于它们扩展。

### `GET /question_request/`

返回帖子列表。

### `POST /question_upload/`

创建帖子元数据。

### `POST /question_file_upload/`

上传帖子附件。

请求格式：`multipart/form-data`

字段：

- `qid`：帖子 ID
- `file`：可重复多个

### `POST /comment_upload/`

为帖子追加评论。

### `POST /like_upload/`

为帖子点赞。

### `POST /control_upload/`

切换帖子发布状态。

### `POST /delete_upload/`

删除帖子及关联评论、点赞、附件记录。

### `POST /file_upload/`

兼容旧头像/图片上传流程使用的文件上传接口。

### `GET /image_info/:filename`

读取旧前端图片信息。

## 开发约定

- 只要后端接口、请求参数、返回字段或接口行为发生变化，就要同步更新 `API.md`
- 新前端优先对齐 `/api/v1/*` 正式接口
- 兼容旧接口只用于保留历史页面能力，不作为新需求扩展基础
