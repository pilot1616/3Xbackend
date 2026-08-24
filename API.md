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
- `POST /api/v1/admin/sync/*` 需要管理员权限
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

### `POST /api/v1/admin/sync/precious-metals`

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

### `POST /api/v1/admin/sync/ai-tech`

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

### `POST /api/v1/admin/sync/ai-dailies`

管理员接口，需要 Bearer Token。用于在后台同步控制台手动触发一次 AI 日报同步，适合首次拉取、手动补数据和排查抓取链路。

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

### `POST /api/v1/admin/sync/full-history`

管理员接口，需要 Bearer Token。用于一次性补齐金融历史数据，并按较高上限补拉 AI 日报归档。

查询参数：

- `ai_daily_max_entries`：AI 日报最大补拉篇数，默认 `10000`

成功响应 `200`：

```json
{
  "message": "full historical sync completed",
  "financialHistory": {
    "mode": "history",
    "historyStartYear": 2018,
    "preciousMetals": 1000,
    "preciousMetalsTotal": 1000,
    "techMarkets": 1000,
    "techMarketsTotal": 1000,
    "failures": [],
    "fetchedAt": "2026-05-20T10:30:00+08:00"
  },
  "aiDailyArchive": {
    "targetCount": 100,
    "successCount": 100,
    "failedSymbols": [],
    "failedDetails": [],
    "fetchedAt": "2026-05-20T10:30:00+08:00",
    "partial": false
  }
}
```

说明：

- 金融历史由 `data-fetch` 服务通过 AkShare 补齐。
- AI 日报归档由 Go 后端同步器补拉。
- 该操作可能持续较久，建议只在首次部署、重建数据库或明显缺数据时执行。

## 分析接口

### `GET /api/v1/analysis/ai-trend`

公开接口，返回指定窗口内 AI 日报的结构化趋势分析。

查询参数：

- `window`：可选，支持 `1d` / `7d` / `30d`，默认 `7d`

成功响应 `200`：

```json
{
  "window": "7d",
  "generatedAt": "2026-05-21T10:30:00+08:00",
  "dataStatus": {
    "sampleCount": 7,
    "sufficient": true,
    "partial": false,
    "windowStart": "2026-05-15",
    "windowEnd": "2026-05-21",
    "note": ""
  },
  "summary": "近 7 天内的 AI 日报主要围绕基础设施和模型能力展开，信息重心仍然集中在这两个主题。",
  "dominantThemes": [
    {
      "theme": "infra",
      "count": 5,
      "share": 0.71
    },
    {
      "theme": "model-capability",
      "count": 4,
      "share": 0.57
    }
  ],
  "emergingThemes": [
    {
      "theme": "enterprise-app",
      "count": 2,
      "reason": "clustered-in-recent-days"
    }
  ],
  "headlineSignals": [
    "基础设施是当前窗口内出现频率最高的 AI 主题。",
    "模型能力虽然不是第一主题，但保持了持续出现。",
    "企业应用主题在窗口后半段出现得更集中，存在升温迹象。"
  ],
  "risks": [
    "主题识别基于规则关键词，可能遗漏隐含主题或语义相近表达。",
    "主题分布较分散，因此总结结论的集中度会低于表面描述。"
  ],
  "confidence": "medium",
  "evidence": [
    {
      "title": "AI Daily A",
      "publishedDate": "2026-05-20",
      "themes": ["infra", "model-capability"]
    }
  ]
}
```

错误响应：

`400 Bad Request`

```json
{
  "message": "invalid analysis window",
  "code": "INVALID_ANALYSIS_WINDOW"
}
```

`422 Unprocessable Entity`

```json
{
  "message": "insufficient ai daily data for analysis",
  "code": "INSUFFICIENT_AI_DAILY_DATA"
}
```

`500 Internal Server Error`

```json
{
  "message": "analysis computation failed",
  "code": "ANALYSIS_COMPUTATION_FAILED"
}
```

字段说明：

- `window`：分析窗口，固定为 `1d` / `7d` / `30d`
- `generatedAt`：服务端生成分析结果的时间
- `dataStatus.sampleCount`：窗口内纳入分析的 AI 日报篇数
- `dataStatus.partial`：是否存在降级或回退情况
- `dataStatus.note`：数据口径补充说明；若 `PublishedDate` 不可用会说明回退到 `FetchedAt`
- `dominantThemes`：主导主题列表，按命中篇数降序
- `emergingThemes`：后半窗口明显升温的主题
- `headlineSignals`：基于统计结果生成的可读信号
- `evidence`：支撑结论的代表性日报证据

### `GET /api/v1/analysis/market-trend`

公开接口，返回指定窗口内 AI / 科技市场和贵金属市场的结构化趋势分析。

查询参数：

- `window`：可选，支持 `1d` / `7d` / `30d`，默认 `7d`

成功响应 `200`：

```json
{
  "window": "7d",
  "generatedAt": "2026-05-21T10:30:00+08:00",
  "dataStatus": {
    "techCoveredSymbolCount": 5,
    "metalCoveredSymbolCount": 4,
    "sufficient": true,
    "partial": false,
    "windowStart": "2026-05-15T10:30:00+08:00",
    "windowEnd": "2026-05-21T10:30:00+08:00",
    "coveredSymbols": ["NDX", "QQQ", "XLK", "SMH", "IGV", "XAU", "XAG", "XPT", "XPD"],
    "expectedSymbols": ["NDX", "QQQ", "XLK", "SMH", "IGV", "XAU", "XAG", "XPT", "XPD"],
    "note": ""
  },
  "summary": "科技风险资产整体偏强，而贵金属并未形成领涨，当前市场更接近风险偏好环境。",
  "marketRegime": "risk-on",
  "techMomentum": {
    "averageChangePercent": 2.6,
    "advancers": 4,
    "decliners": 1
  },
  "safeHavenMomentum": {
    "averageChangePercent": -0.3,
    "advancers": 1,
    "decliners": 3
  },
  "leaders": [
    {
      "symbol": "SMH",
      "changePercent": 4.1
    },
    {
      "symbol": "QQQ",
      "changePercent": 2.8
    }
  ],
  "laggards": [
    {
      "symbol": "XAU",
      "changePercent": -0.7
    }
  ],
  "risks": [
    "市场分析基于抓取快照，不是交易所级别的高频实时行情。",
    "不同标的在同一窗口内的快照密度可能并不完全一致。"
  ],
  "confidence": "medium",
  "evidence": [
    {
      "symbol": "QQQ",
      "startPrice": "700.10",
      "endPrice": "719.70",
      "changePercent": 2.8
    }
  ]
}
```

错误响应：

`400 Bad Request`

```json
{
  "message": "invalid analysis window",
  "code": "INVALID_ANALYSIS_WINDOW"
}
```

`422 Unprocessable Entity`

```json
{
  "message": "insufficient market history for analysis",
  "code": "INSUFFICIENT_MARKET_HISTORY"
}
```

`500 Internal Server Error`

```json
{
  "message": "analysis computation failed",
  "code": "ANALYSIS_COMPUTATION_FAILED"
}
```

字段说明：

- `dataStatus.techCoveredSymbolCount`：窗口内成功形成起止价格的科技组 symbol 数量
- `dataStatus.metalCoveredSymbolCount`：窗口内成功形成起止价格的贵金属组 symbol 数量
- `dataStatus.coveredSymbols`：本次实际参与分析的 symbol 列表
- `dataStatus.expectedSymbols`：首期预期观测的固定 symbol 白名单
- `dataStatus.partial`：是否触发了宽松降级或存在部分数据跳过
- `dataStatus.note`：当贵金属组样本不足但科技组可分析时，这里会说明结论偏向科技组视角
- `marketRegime`：市场状态，固定为 `risk-on` / `risk-off` / `mixed`
- `techMomentum`：科技组平均变化率和涨跌分布
- `safeHavenMomentum`：贵金属组平均变化率和涨跌分布
- `leaders` / `laggards`：窗口内表现最好和最弱的代表性标的

### `GET /api/v1/analysis/overview`

公开接口，返回 AI 信息面与市场面的联动分析结果。

查询参数：

- `window`：可选，支持 `1d` / `7d` / `30d`，默认 `7d`

成功响应 `200`：

```json
{
  "window": "7d",
  "generatedAt": "2026-05-21T10:30:00+08:00",
  "dataStatus": {
    "aiSampleCount": 7,
    "techCoveredSymbolCount": 5,
    "metalCoveredSymbolCount": 4,
    "sufficient": true,
    "partial": false,
    "windowStart": "2026-05-15T10:30:00+08:00",
    "windowEnd": "2026-05-21T10:30:00+08:00",
    "coveredSymbols": ["NDX", "QQQ", "XLK", "SMH", "IGV", "XAU", "XAG", "XPT", "XPD"],
    "expectedSymbols": ["NDX", "QQQ", "XLK", "SMH", "IGV", "XAU", "XAG", "XPT", "XPD"],
    "note": ""
  },
  "summary": "AI 信息面目前由基础设施主导，而市场也通过风险偏好状态对这一叙事做出了确认。",
  "alignment": "aligned",
  "linkageTags": ["infra-chip-alignment"],
  "keyAgreements": [
    "基础设施主题升温，同时半导体与科技基准也处于领涨位置。"
  ],
  "keyTensions": [],
  "aiTrend": {
    "summary": "近 7 天内的 AI 日报主要围绕基础设施和模型能力展开，信息重心仍然集中在这两个主题。",
    "dominantThemes": ["infra", "model-capability"],
    "confidence": "medium"
  },
  "marketTrend": {
    "summary": "科技风险资产整体偏强，而贵金属并未形成领涨，当前市场更接近风险偏好环境。",
    "marketRegime": "risk-on",
    "confidence": "medium"
  },
  "evidence": [
    {
      "type": "theme-market-alignment",
      "theme": "infra",
      "symbols": ["SMH", "QQQ"],
      "note": "基础设施关注度提升，同时半导体和广义科技风险资产也在同步走强。"
    }
  ],
  "risks": [
    "综合判断基于规则联动，不代表稳定长期因果关系。",
    "短窗口内，市场反馈可能滞后于叙事变化。"
  ],
  "confidence": "medium"
}
```

错误响应：

`400 Bad Request`

```json
{
  "message": "invalid analysis window",
  "code": "INVALID_ANALYSIS_WINDOW"
}
```

`422 Unprocessable Entity`

```json
{
  "message": "insufficient ai daily data for analysis",
  "code": "INSUFFICIENT_AI_DAILY_DATA"
}
```

或：

```json
{
  "message": "insufficient market history for analysis",
  "code": "INSUFFICIENT_MARKET_HISTORY"
}
```

说明：

- 当 AI 日报样本不足，或全部命中回退到 `FetchedAt`、无法形成可信 AI 时间窗口时，返回 `INSUFFICIENT_AI_DAILY_DATA`
- 当市场侧样本不足，或市场子结果存在 `partial`、无法支撑严格的 overview 输出时，返回 `INSUFFICIENT_MARKET_HISTORY`
- 当 AI 子结果因 `PublishedDate` 回退等原因进入 `partial`、无法支撑严格的 overview 输出时，返回 `INSUFFICIENT_AI_DAILY_DATA`

`500 Internal Server Error`

```json
{
  "message": "analysis computation failed",
  "code": "ANALYSIS_COMPUTATION_FAILED"
}
```

字段说明：

- `dataStatus.aiSampleCount`：纳入 overview 的 AI 日报篇数
- `alignment`：AI 叙事与市场表现的一致性，固定为 `aligned` / `diverging` / `mixed`
- `linkageTags`：联动标签，首期包括 `infra-chip-alignment`、`app-pricing-gap`、`policy-overhang`、`speculative-risk-on`、`defensive-rotation`、`mixed-conviction`
- `keyAgreements`：信息面与市场面一致的要点
- `keyTensions`：信息面与市场面冲突的要点
- `aiTrend` / `marketTrend`：overview 里携带的精简子摘要
- `overview` 严格依赖 AI 和市场两边结果，任一侧核心输入不足都会返回 `422`

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
- `author`：按用户名或昵称模糊过滤
- `phone`：按手机号模糊过滤
- `keyword`：按帖子正文关键字过滤
- `sort`：排序方式，支持 `latest`、`oldest`、`most_liked`、`most_commented`，默认 `latest`
- `is_upload`：按发布状态过滤，支持 `true/false/1/0`

请求示例：

```http
GET /api/v1/questions?page=1&page_size=10&phone=13800138000&keyword=hello&sort=most_liked&is_upload=true
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
