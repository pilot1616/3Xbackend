# AI 市场分析 Agent Spec

## 1. 背景

当前项目已经具备三类稳定的数据同步能力：

- `AI 日报`：用于反映 AI 行业新闻、产品发布、基础设施、开源、监管、企业落地等信息变化
- `AI / 科技市场`：用于反映 AI 相关指数与 ETF 的市场表现
- `贵金属市场`：用于反映避险资产的市场状态

这三类数据已经能支持一个“项目功能型分析 agent”的第一阶段能力，但项目目前仍缺少一个统一的分析层：

- 现有接口主要返回原始列表或快照
- 还没有把 AI 日报内容与市场数据做结构化联动
- 还没有给前端或外部调用方提供可消费的“分析结果”
- 还没有形成“趋势结论 + 证据 + 风险提示 + 标签”的统一输出格式

因此，需要在后端增加一个分析模块，把现有同步数据组织成可解释、可验证、可扩展的分析能力。

## 2. 目标

本次目标：

- 基于现有 `AI 日报`、`AI / 科技市场`、`贵金属市场` 数据，提供结构化分析接口
- 将分析逻辑独立成单独模块，而不是继续堆到 `forum` 业务中
- 首期输出面向程序消费的 JSON 结果
- 为后续前端分析页、报告卡片、定时快照、LLM 总结留出接口和结构空间
- 将这套能力定义成“项目功能型 agent”，即项目内的分析功能，不是开发协作 agent

非目标：

- 本次不做聊天式对话 agent
- 本次不接入 LLM 生成自然语言长文
- 本次不做自动交易、投资建议、买卖信号
- 本次不新增数据库表保存分析结果
- 本次不修改现有同步抓取逻辑
- 本次不新增前端分析页面
- 本次不重构现有 `ForumService` 之外的既有业务逻辑

## 3. 产品定位

这个分析 agent 的定位不是“智能聊天机器人”，而是“数据驱动的分析引擎”。

它应该做的是：

- 从项目已有数据中提取结构化趋势
- 给出明确结论
- 给出形成该结论的证据
- 给出结论可信度与数据充分性说明
- 给出可供前端展示的标签、摘要、指标和风险提示

它不应该做的是：

- 凭空生成投资判断
- 没有证据链地输出模糊结论
- 依赖大模型才可运行
- 把所有能力做成一个不可控的黑盒

## 4. 用户故事

### 4.1 普通访客

作为访客，我希望：

- 可以获取最近一段时间内 AI 行业的结构化趋势分析
- 可以看到 AI 市场和贵金属市场的状态判断
- 可以看到 AI 信息面和市场面是否一致
- 可以知道结论基于哪些日报主题和哪些市场标的

### 4.2 已登录用户 / 产品运营

作为已登录用户或运营者，我希望：

- 在不手工阅读大量日报的情况下，快速知道最近 AI 发展重点
- 快速知道市场是在 `risk-on`、`risk-off` 还是 `mixed`
- 看到分析结论是否受数据样本不足影响
- 后续可以把这些 JSON 结果直接接到前端分析页或首页摘要区

### 4.3 维护者

作为维护者，我希望：

- 分析模块与论坛、市场同步、日报同步解耦
- 分析规则可读、可测、可维护
- 新增主题标签、联动规则、窗口期时不需要大改已有业务
- 接口输出稳定，文档明确，方便后续前端接入

## 5. 首期范围

首期只做以下三个接口：

- `GET /api/v1/analysis/ai-trend`
- `GET /api/v1/analysis/market-trend`
- `GET /api/v1/analysis/overview`

首期只支持以下分析窗口：

- `1d`
- `7d`
- `30d`

首期只使用以下数据源：

- `ai_daily_snapshots`
- `tech_market_snapshots`
- `precious_metal_snapshots`

首期只做按请求实时计算：

- 不落库
- 不做异步任务
- 不做预计算表
- 可在代码结构上预留轻缓存位置，但首版不强制实现

首期时间与窗口口径补充约定：

- `AI 日报` 分析窗口优先按 `PublishedDate` 计算
- 当 `PublishedDate` 缺失或不可解析时，才回退使用 `FetchedAt`
- `AI / 科技市场` 与 `贵金属市场` 继续按 `FetchedAt` 计算窗口
- `1d / 7d / 30d` 统一按服务端本地时区自然时间向前回溯，不使用 UTC 自然日切分

## 6. 非首期范围

以下内容明确放到后续阶段，不在本次 spec 落地范围：

- 分析结果入库与历史快照
- 定时生成日报/周报
- 用户级订阅
- 前端可视化分析页
- LLM 生成自然语言总结
- 论坛帖子、评论、点赞作为分析因子
- 多语言分析
- 可配置规则后台

## 7. 现状与依赖

当前已经存在的关键代码与数据基础：

### 7.1 路由层

当前路由注册位于：

- `internal/server/server.go`

已经存在：

- `/api/v1/market/precious-metals`
- `/api/v1/market/ai-tech`
- `/api/v1/ai-dailies`

这说明新增 `analysis` 路由时，应该沿用已有 `api/v1` 风格，而不是另起一套路由体系。

### 7.2 数据模型层

现有模型位于：

- `internal/database/forum.go`

已确认存在：

- `AIDailySnapshot`
- `TechMarketSnapshot`
- `PreciousMetalSnapshot`

这意味着首期分析可以直接查询现有表，不需要改 schema，不需要 `AutoMigrate` 新表。

额外约束：

- `ai_daily_snapshots` 当前按 `source + slug` 唯一保存，重复抓取会覆盖更新，不会保留同一篇日报的多版历史快照
- 因此 AI 日报分析应按“文章唯一记录”建模，而不是按“同文多次快照序列”建模
- `tech_market_snapshots` 与 `precious_metal_snapshots` 会持续追加，适合做窗口内价格序列分析

### 7.3 同步服务层

现有同步服务位于：

- `internal/service/ai_daily_sync.go`
- `internal/service/tech_market_sync.go`
- `internal/service/metal_sync.go`

这意味着分析模块不负责抓数据，只消费已经入库的数据。

## 8. 总体设计

整体拆为三层：

### 8.1 数据读取层

职责：

- 从数据库读取指定窗口内的日报、科技市场、贵金属市场数据
- 做最基础的数据清洗、排序、去重、时间范围过滤
- 保证上层不直接操作杂乱原始记录

建议位置：

- `internal/service/analysis.go` 内部私有方法即可
- 首期不必单独拆 repository

### 8.2 结构化分析层

职责：

- 对 AI 日报做主题提取、主题计数、趋势归类、重点信号整理
- 对市场快照做价格变化方向、风险偏好、避险偏好判断
- 对 AI 趋势结果与市场结果做联动分析

建议方式：

- 规则优先
- 可解释优先
- 最小可用优先

### 8.3 输出组装层

职责：

- 组装统一 JSON 返回结构
- 暴露给 handler
- 处理错误状态、参数校验、空数据提示

## 9. 模块结构设计

建议新增文件：

- `internal/service/analysis.go`
- `internal/handler/analysis.go`
- `internal/service/analysis_test.go`

建议在 `internal/server/server.go` 中新增：

- `analysisHandler *handler.AnalysisHandler`

### 9.1 为什么不继续塞进 `ForumService`

当前 `ForumService` 已经承载论坛、市场、AI 日报等多类职责。

如果继续把分析能力塞进 `ForumService`，会出现：

- 业务边界继续膨胀
- 测试越来越难写
- handler 层依赖越来越重
- 后续要加缓存、报告、快照时更难拆

因此本次分析模块应独立成：

- `AnalysisService`
- `AnalysisHandler`

这是首期最小且正确的职责切分。

## 10. 详细实施步骤

这一章是本 spec 的核心，按真实落地顺序写清每一步。

### 10.1 第一步：新增分析 service 结构

目标：

- 建立分析模块主入口
- 不先写复杂逻辑，先把骨架搭好

需要做的事：

1. 在 `internal/service/analysis.go` 中定义 `AnalysisService`
2. `AnalysisService` 至少持有：
   - `db *gorm.DB`
3. 新增构造函数：
   - `func NewAnalysisService(db *gorm.DB) *AnalysisService`
4. 明确首期公开方法：
   - `AnalyzeAITrend(window AnalysisWindow) (*AITrendAnalysisResponse, error)`
   - `AnalyzeMarketTrend(window AnalysisWindow) (*MarketTrendAnalysisResponse, error)`
   - `AnalyzeOverview(window AnalysisWindow) (*OverviewAnalysisResponse, error)`

这一阶段先不要求逻辑完整，但要求类型和方法边界先稳定下来。

验收标准：

- `analysis.go` 文件中能明确看到 service 入口
- 后续 handler 可以直接调用这三个方法
- 不依赖前端、不依赖新表

### 10.2 第二步：定义窗口类型和参数校验

目标：

- 避免各处散落写字符串 `"1d"`, `"7d"`, `"30d"`
- 保证接口参数统一

需要做的事：

1. 在 `analysis.go` 中定义：
   - `type AnalysisWindow string`
2. 定义常量：
   - `AnalysisWindow1D AnalysisWindow = "1d"`
   - `AnalysisWindow7D AnalysisWindow = "7d"`
   - `AnalysisWindow30D AnalysisWindow = "30d"`
3. 新增窗口解析函数，例如：
   - `parseAnalysisWindow(raw string) (AnalysisWindow, error)`
4. 约定默认值：
   - 当 query 不传时，默认使用 `7d`
5. 对非法值返回：
   - `invalid analysis window`

解析规则要求：

- 空字符串视为默认窗口
- 只接受小写 `1d/7d/30d`
- 其他值一律视为无效

验收标准：

- 所有 analysis 接口都通过同一套窗口解析逻辑
- 非法窗口会稳定返回 `400`

### 10.3 第三步：定义统一返回结构

目标：

- 先固定输出协议，避免边写逻辑边改接口形态

需要做的事：

1. 在 `analysis.go` 中定义 AI 分析返回类型
2. 定义市场分析返回类型
3. 定义综合分析返回类型
4. 定义内部通用片段结构，例如：
   - 时间窗口信息
   - 证据项
   - 风险项
   - 标签项
   - 数据充分性说明

建议公共字段：

- `window`
- `generatedAt`
- `dataStatus`
- `summary`
- `signals`
- `risks`
- `confidence`
- `evidence`

`dataStatus` 需要表达：

- 样本是否足够
- 数据是否部分缺失
- 是否存在历史不足

首期建议统一 `dataStatus` 基础字段，避免三个接口各自发明结构：

- `sufficient`: `boolean`
- `partial`: `boolean`
- `windowStart`: `string`，RFC3339 或日期字符串
- `windowEnd`: `string`，RFC3339 或日期字符串
- `sampleCount`: `number`，适用于单源统计
- `coveredSymbols`: `string[]`，适用于市场类统计
- `expectedSymbols`: `string[]`，适用于市场类统计
- `coveredSymbolCount`: `number`，适用于市场类统计，表示窗口内成功形成有效变化率计算的 symbol 数
- `note`: `string`

在此基础上：

- AI 趋势接口可增加 `sampleCount`
- 市场趋势接口可增加 `techCoveredSymbolCount`、`metalCoveredSymbolCount`
- 综合接口可增加 `aiSampleCount`、`techCoveredSymbolCount`、`metalCoveredSymbolCount`

验收标准：

- 三个接口输出结构层级清晰
- 字段命名稳定，避免前端将来频繁改对接代码
- 首期字段足够支撑前端卡片、详情、标签和提示展示

### 10.4 第四步：实现 AI 日报数据读取

目标：

- 为 AI 趋势分析准备原始输入数据

需要做的事：

1. 查询 `AIDailySnapshot`
2. 按窗口过滤时间
   - 优先使用 `PublishedDate`
   - `PublishedDate` 缺失或不可解析时回退到 `FetchedAt`
3. 结果按统一时间字段排序
4. 只取窗口内数据，不混入窗口外数据
5. 不需要实现“同一篇日报多次快照去重”
   - 当前表结构对 `source + slug` 做唯一约束，重复抓取会覆盖更新
   - 分析输入应视为“每篇日报一条当前有效记录”
6. 读取字段至少包括：
   - `Title`
   - `Summary`
   - `Content`
   - `SectionsJSON`
   - `LinksJSON`
   - `MetaJSON`
   - `PublishedDate`
   - `FetchedAt`

实现要求：

- 首期不需要复杂 repository 层
- 直接在 `AnalysisService` 内部查询即可
- 读取后尽量转换为内部分析输入结构，避免后续逻辑直接依赖 GORM model
- 需要明确日期解析失败时的行为：解析失败的 `PublishedDate` 不应导致整批失败，应回退使用 `FetchedAt` 并在 `dataStatus.note` 中记录存在回退样本

错误处理：

- 若窗口内记录数过少，返回：
  - `insufficient ai daily data for analysis`

建议样本阈值：

- `1d` 至少 1 篇
- `7d` 至少 3 篇
- `30d` 至少 7 篇

这个阈值不是绝对业务真理，但首期要固定下来，便于结果可解释。

验收标准：

- 可以稳定拿到窗口内日报数据
- 样本不足时有明确错误，不返回空泛结论

### 10.5 第五步：实现 AI 主题提取规则

目标：

- 把日报文本转换成有限、稳定、可统计的主题标签

首期主题建议固定为：

- `agent`
- `model-capability`
- `infra`
- `open-source`
- `enterprise-app`
- `regulation`

需要做的事：

1. 为每个主题定义关键词集合
2. 关键词匹配范围至少包括：
   - `Title`
   - `Summary`
   - `Content`
   - `SectionsJSON` 解出的标题与条目
3. 同一篇日报可以命中多个主题
4. 对每篇日报统计命中的主题列表
5. 对整个窗口统计：
   - 每个主题命中篇数
   - 每个主题命中次数
   - 最近主题强度排序

实现要求：

- 首期允许简单关键词匹配
- 先做英文/中英混合关键词
- 规则应集中定义在一个区域，方便后续调整
- 不要把关键词散落在多个函数中

建议规则示例：

- `agent`：
  - agent
  - autonomous
  - workflow
  - multi-agent
  - assistant
- `model-capability`：
  - model
  - reasoning
  - benchmark
  - multimodal
  - inference
- `infra`：
  - gpu
  - chip
  - inference stack
  - datacenter
  - serving
  - training
- `open-source`：
  - open source
  - github
  - apache
  - community release
- `enterprise-app`：
  - enterprise
  - workflow
  - copilots
  - business automation
  - pricing
- `regulation`：
  - policy
  - regulation
  - compliance
  - governance
  - safety law

验收标准：

- 任意一批日报都能得到稳定主题统计结果
- 输出不是纯文本摘要，而是结构化主题分布

### 10.6 第六步：实现 AI 趋势结论生成

目标：

- 基于主题统计结果生成 AI 趋势结论

需要做的事：

1. 根据主题分布选出：
   - 主导主题
   - 次主导主题
   - 新增主题热点
2. 从最近若干篇日报中提炼：
   - 重点信号
   - 风险提示
   - 代表性标题
3. 输出短摘要：
   - 1 到 3 句固定风格总结
4. 输出主题排名列表
5. 输出证据列表

建议结论结构包括：

- `dominantThemes`
- `emergingThemes`
- `headlineSignals`
- `summary`
- `evidence`

结论生成规则建议：

- 如果某主题命中占比明显最高，则进入 `dominantThemes`
- 如果某主题主要集中在窗口后半段新出现，则进入 `emergingThemes`
- 如果数据量不足，不应硬给强结论，应降低 `confidence`

信心值建议：

- `high`
- `medium`
- `low`

决定依据：

- 样本数
- 主题分布是否集中
- 证据数量是否足够

验收标准：

- AI 趋势接口能输出结论、主题、证据、风险、可信度
- 样本不足时不会伪造强结论

### 10.7 第七步：实现 AI 市场数据读取

目标：

- 为市场趋势分析准备输入数据

需要做的事：

1. 查询 `TechMarketSnapshot`
2. 查询 `PreciousMetalSnapshot`
3. 按窗口过滤 `FetchedAt`
4. 按 `Symbol` 分组
5. 每个标的至少提取：
   - 窗口起点价格
   - 窗口终点价格
   - 最新价格
   - 最近更新时间
6. 允许某些标的样本点较少，但必须有最小历史长度
7. 需要把字符串价格解析为数值后再做计算

价格解析规则必须固定：

- 去掉千分位分隔符，如 `,`
- 去掉百分号 `%` 后再解析百分比字段
- 空字符串、`-`、`--`、`N/A` 视为无效值
- 无法解析的标的不参与涨跌幅计算，并在 `dataStatus.note` 中体现

重点：

- `TechMarketSnapshot` 需要关注：
  - `NDX`
  - `QQQ`
  - `XLK`
  - `SMH`
  - `IGV`
- `PreciousMetalSnapshot` 需要关注：
  - `XAU`
  - `XAG`
  - `XPT`
  - `XPD`

补充约束：

- 首期分析标的白名单以现有同步服务中已经稳定抓取的 symbol 为准
- 如果后续同步服务扩充 symbol，分析模块可在后续版本扩展，不要求首期自动全量接入

错误处理：

- 如果关键市场样本不足，返回：
  - `insufficient market history for analysis`

验收标准：

- 可以从窗口内数据中算出每个标的方向与变化幅度
- 缺少关键历史时接口能明确报错

### 10.8 第八步：实现市场方向判断

目标：

- 把一堆市场价格记录转换成可理解的市场状态

需要做的事：

1. 计算每个科技标的窗口变化率
2. 计算每个贵金属标的窗口变化率
3. 分别形成：
   - 科技风险偏好分数
   - 避险偏好分数
4. 综合判断市场状态：
   - `risk-on`
   - `risk-off`
   - `mixed`

建议判断逻辑：

- 如果多数科技标的为正、涨幅集中，同时贵金属偏弱：
  - `risk-on`
- 如果科技标的明显偏弱，同时黄金或白银偏强：
  - `risk-off`
- 其余情况：
  - `mixed`

建议分数来源：

- 科技组上涨标的占比
- 科技组平均变化率
- 贵金属组上涨标的占比
- 黄金、白银的方向权重略高于铂钯

输出应包含：

- `marketRegime`
- `techMomentum`
- `safeHavenMomentum`
- `leaders`
- `laggards`

验收标准：

- 市场接口能稳定给出三态判断
- 输出同时保留底层证据，不是只给一个标签

### 10.9 第九步：实现综合联动分析

目标：

- 把 AI 信息面与市场面联动，形成更有价值的综合结论

需要做的事：

1. 在 `AnalyzeOverview` 中复用：
   - `AnalyzeAITrend`
   - `AnalyzeMarketTrend`
2. 不要重新查询和重复计算同一批规则
3. 首期 `overview` 采用严格成功策略：
   - 任一子分析返回数据不足时，`overview` 直接返回 `422`
   - 首期不做部分成功的 overview 响应
4. 根据两边结果做联动判断：
   - AI 热点是否与科技风险偏好一致
   - AI 热点是否偏基础设施而市场偏弱
   - 是否存在题材热但价格未跟进
4. 生成综合标签

建议标签示例：

- `infra-chip-alignment`
- `app-pricing-gap`
- `policy-overhang`
- `speculative-risk-on`
- `defensive-rotation`
- `mixed-conviction`

建议联动规则示例：

- 当 `infra` 为主导主题，且 `SMH/QQQ/NDX` 同步走强：
  - `infra-chip-alignment`
- 当 `enterprise-app` 或应用类主题升温，但科技市场未跟涨：
  - `app-pricing-gap`
- 当 `regulation` 占比升高，且市场偏弱：
  - `policy-overhang`

输出应包含：

- 综合摘要
- 联动标签
- 关键矛盾点
- 关键一致点
- 数据充分性说明

验收标准：

- `overview` 不是简单拼接两个接口原样结果
- 确实新增了“联动解释”这一层价值

### 10.10 第十步：新增 analysis handler

目标：

- 把 service 结果暴露成标准 HTTP 接口

需要做的事：

1. 在 `internal/handler/analysis.go` 中新增 `AnalysisHandler`
2. `AnalysisHandler` 至少持有：
   - `analysisService *service.AnalysisService`
3. 新增构造函数：
   - `NewAnalysisHandler(analysisService *service.AnalysisService) *AnalysisHandler`
4. 新增三个 handler 方法：
   - `GetAITrend`
   - `GetMarketTrend`
   - `GetOverview`

每个 handler 都要做的事情：

1. 读取 `window` query
2. 解析窗口参数
3. 调用对应 service 方法
4. 根据错误类型返回正确状态码
5. 输出 JSON

状态码约定：

- `400`：参数错误
- `422`：数据不足，无法形成有效分析
- `500`：服务内部错误

错误文案建议固定：

- `invalid analysis window`
- `insufficient ai daily data for analysis`
- `insufficient market history for analysis`
- `analysis computation failed`

错误响应体建议统一为：

```json
{
  "message": "invalid analysis window",
  "code": "INVALID_ANALYSIS_WINDOW"
}
```

其中 `code` 首期建议固定枚举：

- `INVALID_ANALYSIS_WINDOW`
- `INSUFFICIENT_AI_DAILY_DATA`
- `INSUFFICIENT_MARKET_HISTORY`
- `ANALYSIS_COMPUTATION_FAILED`

验收标准：

- handler 不写复杂分析逻辑
- 参数解析和状态码处理一致

### 10.11 第十一步：注册分析路由

目标：

- 正式把接口接入服务启动链路

需要做的事：

1. 在 `internal/server/server.go` 中给 `Server` 新增：
   - `analysisHandler *handler.AnalysisHandler`
2. 在 `Init` 方法中：
   - 创建 `analysisService := service.NewAnalysisService(db)`
   - 创建 `analysisHandler := handler.NewAnalysisHandler(analysisService)`
3. 在 `registerRoutes()` 中新增：
   - `api.GET("/analysis/ai-trend", s.analysisHandler.GetAITrend)`
   - `api.GET("/analysis/market-trend", s.analysisHandler.GetMarketTrend)`
   - `api.GET("/analysis/overview", s.analysisHandler.GetOverview)`

设计要求：

- 三个分析接口均为公开只读接口
- 首期不加登录限制
- 继续挂在 `/api/v1` 下，与现有 API 风格保持一致

验收标准：

- 启动后可直接请求到三个新接口
- 路由命名与现有风格一致

### 10.12 第十二步：补测试

目标：

- 保证规则类逻辑可回归、可维护

需要做的事：

1. 在 `internal/service/analysis_test.go` 中添加单元测试
2. 测试重点不是 HTTP 层，而是分析规则层
3. 至少覆盖以下场景：

AI 分析：

- 多篇日报集中命中 `infra`
- 多篇日报集中命中 `regulation`
- 窗口内样本不足
- 同一篇日报命中多个主题

市场分析：

- 科技组明显上涨、贵金属偏弱，结果应为 `risk-on`
- 科技组明显下跌、黄金偏强，结果应为 `risk-off`
- 双方分化，结果应为 `mixed`
- 历史样本不足返回错误

综合分析：

- `infra` 升温且 `SMH/QQQ` 强势时应命中 `infra-chip-alignment`
- 应用类升温但科技市场平淡时应命中 `app-pricing-gap`

实现建议：

- 分析规则尽量拆成小函数，便于直接传入假数据测试
- 测试不强依赖真实数据库时，可优先测纯规则函数
- 如果 service 层强依赖数据库，可考虑补少量集成型测试，但不是首期重点

验收标准：

- 关键规则有自动化测试覆盖
- 后续调关键词或阈值时能快速发现回归

### 10.13 第十三步：补文档

目标：

- 让接口可被前端和后续维护者直接使用

需要做的事：

1. 更新 `API.md`
2. 新增三个接口说明：
   - query 参数
   - 返回示例
   - 错误示例
   - 字段含义
3. 如有必要，更新 `README.md`
4. 在 spec 中保留后续前端可接入点说明

验收标准：

- 新接口能在文档中完整找到
- 前端不需要读源码就能对接

## 11. 接口设计

### 11.1 `GET /api/v1/analysis/ai-trend`

用途：

- 返回指定窗口内 AI 日报的结构化趋势分析

查询参数：

- `window`：可选，`1d` / `7d` / `30d`，默认 `7d`

成功响应 `200` 示例：

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
  "summary": "最近 7 天 AI 主题主要集中在基础设施与模型能力，基础设施相关信息出现频率更高，显示市场关注点仍偏底层算力与推理能力建设。",
  "dominantThemes": [
    {
      "theme": "infra",
      "count": 5
    },
    {
      "theme": "model-capability",
      "count": 4
    }
  ],
  "emergingThemes": [
    {
      "theme": "enterprise-app",
      "count": 2
    }
  ],
  "headlineSignals": [
    "多篇日报提到 GPU、推理、数据中心扩容",
    "模型能力相关更新集中在推理与多模态",
    "企业应用主题开始升温，但占比仍次于基础设施"
  ],
  "risks": [
    "样本规模有限，更多反映近期信息热度而非长期趋势",
    "关键词分类为规则法，可能遗漏隐含主题"
  ],
  "confidence": "medium",
  "evidence": [
    {
      "title": "Sample Daily A",
      "publishedDate": "2026-05-20",
      "themes": ["infra", "model-capability"]
    },
    {
      "title": "Sample Daily B",
      "publishedDate": "2026-05-19",
      "themes": ["infra"]
    }
  ]
}
```

错误响应：

- `400`
- `422`
- `500`

### 11.2 `GET /api/v1/analysis/market-trend`

用途：

- 返回指定窗口内 AI / 科技市场和贵金属市场的结构化分析

查询参数：

- `window`：可选，`1d` / `7d` / `30d`，默认 `7d`

成功响应 `200` 示例：

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
  "summary": "科技风险资产整体偏强，贵金属分化偏弱，市场处于 risk-on 状态。",
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
    "窗口内点位为抓取快照，不是交易所级高频行情",
    "部分标的样本数量可能不完全一致"
  ],
  "confidence": "medium",
  "evidence": [
    {
      "symbol": "QQQ",
      "startPrice": "700.10",
      "endPrice": "719.70",
      "changePercent": 2.8
    },
    {
      "symbol": "XAU",
      "startPrice": "3368.2",
      "endPrice": "3344.5",
      "changePercent": -0.7
    }
  ]
}
```

### 11.3 `GET /api/v1/analysis/overview`

用途：

- 组合 AI 趋势与市场趋势结果，返回联动分析

查询参数：

- `window`：可选，`1d` / `7d` / `30d`，默认 `7d`

成功响应 `200` 示例：

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
  "summary": "AI 信息面偏向基础设施与模型能力，科技市场同步偏强，说明当前叙事与风险偏好存在一致性。",
  "alignment": "aligned",
  "linkageTags": [
    "infra-chip-alignment"
  ],
  "keyAgreements": [
    "基础设施主题升温，同时半导体与科技 ETF 走强",
    "模型能力叙事增强，科技风险偏好同步改善"
  ],
  "keyTensions": [
    "企业应用主题开始升温，但价格反馈仍不明显"
  ],
  "aiTrend": {
    "summary": "AI 主题主要集中在基础设施与模型能力。",
    "dominantThemes": ["infra", "model-capability"],
    "confidence": "medium"
  },
  "marketTrend": {
    "summary": "科技风险资产整体偏强，市场处于 risk-on 状态。",
    "marketRegime": "risk-on",
    "confidence": "medium"
  },
  "evidence": [
    {
      "type": "theme-market-alignment",
      "theme": "infra",
      "symbols": ["SMH", "QQQ", "NDX"],
      "note": "基础设施主题升温，且半导体与科技风险资产同步走强"
    }
  ],
  "risks": [
    "综合判断依赖规则联动，不代表长期因果关系",
    "短窗口下市场反馈可能滞后于信息面变化"
  ],
  "confidence": "medium"
}
```

## 12. 接口字段详细定义

这一章要求把字段定义写得足够细，避免实现时每个人理解不一致。

### 12.1 通用字段

三个分析接口都建议包含以下通用字段：

- `window`
- `generatedAt`
- `dataStatus`
- `summary`
- `risks`
- `confidence`

补充说明：

- `evidence` 对 `ai-trend` 与 `market-trend` 为必备字段
- `overview` 建议提供 `evidence`，用于表达联动判断证据；若首期实现成本过高，也可以在 `overview` 中降级为可选字段，但示例与文档需保持一致

#### `window`

类型：

- `string`

可选值：

- `1d`
- `7d`
- `30d`

含义：

- 当前分析使用的数据窗口

要求：

- 必须与请求参数或默认值一致
- 不能返回其他非约定值

#### `generatedAt`

类型：

- `string`
- RFC3339 时间格式

含义：

- 本次分析结果生成时间

要求：

- 由服务端实时生成
- 不是数据源更新时间
- 前端可直接显示“分析生成于”

#### `dataStatus`

类型：

- `object`

用途：

- 告知调用方本次分析的数据充分性和可靠性基础

建议基础字段：

- `sufficient`
- `partial`
- `windowStart`
- `windowEnd`
- `note`

AI 接口扩展字段：

- `sampleCount`

市场接口扩展字段：

- `techCoveredSymbolCount`
- `metalCoveredSymbolCount`
- `expectedSymbols`
- `coveredSymbols`

综合接口扩展字段：

- `aiSampleCount`
- `techCoveredSymbolCount`
- `metalCoveredSymbolCount`
- `expectedSymbols`
- `coveredSymbols`

字段说明：

- `sufficient`：
  - `boolean`
  - 表示是否达到首期分析的最小样本要求
- `sampleCount`：
  - `number`
  - AI 日报类接口用于表示窗口内日报数
- `techCoveredSymbolCount`：
  - `number`
  - 市场接口或综合接口中，科技组成功参与计算的 symbol 数
- `metalCoveredSymbolCount`：
  - `number`
  - 市场接口或综合接口中，贵金属组成功参与计算的 symbol 数
- `coveredSymbols`：
  - `array[string]`
  - 实际覆盖到并参与判断的 symbol 列表
- `expectedSymbols`：
  - `array[string]`
  - 首期规则预期关注的 symbol 白名单
- `note`：
  - `string`
  - 用于表达“样本偏少”“市场数据存在部分缺口”等说明

补充约束：

- `sampleCount` 仅用于 AI 日报篇数，不用于市场接口
- 市场接口不要再使用语义模糊的 `techSamples` / `metalSamples`
- 市场侧如果要表达覆盖程度，统一使用 `techCoveredSymbolCount` / `metalCoveredSymbolCount`
- 如果将来需要表达窗口内原始快照总数，应另行使用 `techSnapshotCount` / `metalSnapshotCount`，不要复用 `sampleCount`

要求：

- 如果接口最终返回 `422`，仍建议内部按同样口径构建数据充分性判断
- 但 `422` 响应体可以简化为错误结构，不必完整返回分析结果

#### `summary`

类型：

- `string`

用途：

- 提供一段适合前端直接展示的简短摘要

要求：

- 控制在 1 到 3 句
- 使用明确陈述，不要写模糊营销文案
- 必须与结构化结果一致，不能和实际字段冲突

不允许：

- 输出“建议买入”“建议卖出”
- 输出无依据的长期判断
- 输出与 `marketRegime` 或 `dominantThemes` 相矛盾的描述

#### `risks`

类型：

- `array[string]`

用途：

- 告知本次分析自身的局限性或当前数据风险

建议来源：

- 样本量偏少
- 市场快照不等频
- 关键词匹配可能漏掉隐含主题
- 窗口过短导致结论易波动

要求：

- 至少输出 0 到 3 条
- 如果没有明显风险，也建议保留一条通用提示，避免结果看起来“绝对正确”

#### `confidence`

类型：

- `string`

可选值：

- `low`
- `medium`
- `high`

用途：

- 表示本次分析结论的置信度

要求：

- 必须有可追溯规则
- 不能随意拍脑袋赋值

首期建议规则：

- `high`：
  - 样本充足
  - 主要主题或市场方向明显集中
  - 证据项足够
- `medium`：
  - 样本基本充足
  - 但结果存在一定分化
- `low`：
  - 样本少
  - 或结果高度分散
  - 或方向不明显

#### `evidence`

类型：

- `array[object]`

用途：

- 提供支撑结论的底层证据项

要求：

- 证据项类型可因接口不同而不同
- 但整体必须是“前端可直接渲染列表”的结构
- 不要求返回所有原始数据，只返回关键证据

### 12.2 AI 趋势接口字段

建议返回结构：

```json
{
  "window": "7d",
  "generatedAt": "2026-05-21T10:30:00+08:00",
  "dataStatus": {
    "sampleCount": 7,
    "sufficient": true,
    "note": ""
  },
  "summary": "最近 7 天 AI 主题主要集中在基础设施与模型能力。",
  "dominantThemes": [],
  "emergingThemes": [],
  "headlineSignals": [],
  "risks": [],
  "confidence": "medium",
  "evidence": []
}
```

#### `dominantThemes`

类型：

- `array[object]`

建议子字段：

- `theme`
- `count`
- `share`

字段说明：

- `theme`：
  - `string`
  - 主题编码，例如 `infra`
- `count`：
  - `number`
  - 命中该主题的日报篇数
- `share`：
  - `number`
  - 该主题占窗口内全部日报的比例，建议返回 0 到 1 小数

要求：

- 数组按强度降序
- 首期最多返回前 3 个

#### `emergingThemes`

类型：

- `array[object]`

建议子字段：

- `theme`
- `count`
- `reason`

用途：

- 表示近期新增升温、但未必是总量最高的主题

`reason` 示例：

- `clustered-in-recent-days`
- `new-topic-appearance`
- `late-window-acceleration`

要求：

- 首期可先用简单规则
- 例如同一主题主要集中在窗口后半段，则视为 emerging

#### `headlineSignals`

类型：

- `array[string]`

用途：

- 把结构化主题统计翻译成更可读的短信号

示例：

- `多篇日报集中提到 GPU、推理和数据中心扩容`
- `模型能力更新集中在多模态与推理能力`
- `企业应用主题开始出现，但仍弱于基础设施`

要求：

- 每条必须对应某种实际统计或证据
- 不要生成没有依据的漂亮句子

#### AI 接口 `evidence`

建议子字段：

- `title`
- `publishedDate`
- `themes`

说明：

- `title`：
  - 日报标题
- `publishedDate`：
  - 日报发布日期
- `themes`：
  - 命中的主题列表

要求：

- 首期最多返回 5 到 8 条
- 优先返回具有代表性的日报，不必全部返回

### 12.3 市场趋势接口字段

建议返回结构：

```json
{
  "window": "7d",
  "generatedAt": "2026-05-21T10:30:00+08:00",
  "dataStatus": {
    "techCoveredSymbolCount": 5,
    "metalCoveredSymbolCount": 4,
    "sufficient": true,
    "coveredSymbols": ["NDX", "QQQ", "XLK", "SMH", "IGV", "XAU", "XAG", "XPT", "XPD"],
    "expectedSymbols": ["NDX", "QQQ", "XLK", "SMH", "IGV", "XAU", "XAG", "XPT", "XPD"],
    "note": ""
  },
  "summary": "科技风险资产整体偏强，贵金属分化偏弱，市场处于 risk-on 状态。",
  "marketRegime": "risk-on",
  "techMomentum": {},
  "safeHavenMomentum": {},
  "leaders": [],
  "laggards": [],
  "risks": [],
  "confidence": "medium",
  "evidence": []
}
```

#### `marketRegime`

类型：

- `string`

可选值：

- `risk-on`
- `risk-off`
- `mixed`

要求：

- 必须由固定规则得出
- 不能由摘要文案反推

#### `techMomentum`

类型：

- `object`

建议字段：

- `averageChangePercent`
- `advancers`
- `decliners`

说明：

- `averageChangePercent`
  - 科技组窗口内平均变化率
- `advancers`
  - 上涨标的数量
- `decliners`
  - 下跌标的数量

要求：

- 科技组标的是固定集合
- 若个别标的缺样本，需在 `dataStatus.note` 或 `risks` 中说明

#### `safeHavenMomentum`

类型：

- `object`

建议字段：

- `averageChangePercent`
- `advancers`
- `decliners`

说明：

- 用于描述贵金属组表现

#### `leaders`

类型：

- `array[object]`

建议字段：

- `symbol`
- `changePercent`

用途：

- 展示窗口内表现最强的若干标的

要求：

- 按变化率降序
- 建议最多返回前 3 个

#### `laggards`

类型：

- `array[object]`

建议字段：

- `symbol`
- `changePercent`

用途：

- 展示窗口内表现最弱的若干标的

要求：

- 按变化率升序
- 建议最多返回前 3 个

#### 市场接口 `evidence`

建议子字段：

- `symbol`
- `startPrice`
- `endPrice`
- `changePercent`

要求：

- 优先返回关键标的：
  - 科技组可优先 `QQQ`, `SMH`, `NDX`
  - 避险组可优先 `XAU`, `XAG`

### 12.4 综合分析接口字段

建议返回结构：

```json
{
  "window": "7d",
  "generatedAt": "2026-05-21T10:30:00+08:00",
  "dataStatus": {
    "aiSampleCount": 7,
    "techCoveredSymbolCount": 5,
    "metalCoveredSymbolCount": 4,
    "sufficient": true,
    "coveredSymbols": ["NDX", "QQQ", "XLK", "SMH", "IGV", "XAU", "XAG", "XPT", "XPD"],
    "expectedSymbols": ["NDX", "QQQ", "XLK", "SMH", "IGV", "XAU", "XAG", "XPT", "XPD"],
    "note": ""
  },
  "summary": "AI 信息面偏向基础设施与模型能力，科技市场同步偏强，说明当前叙事与风险偏好存在一致性。",
  "alignment": "aligned",
  "linkageTags": [],
  "keyAgreements": [],
  "keyTensions": [],
  "aiTrend": {},
  "marketTrend": {},
  "risks": [],
  "confidence": "medium"
}
```

#### `alignment`

类型：

- `string`

可选值建议：

- `aligned`
- `diverging`
- `mixed`

含义：

- AI 叙事与市场表现整体是否一致

判定建议：

- `aligned`
  - AI 热门主题与科技市场方向同向
- `diverging`
  - AI 热门主题明显升温，但市场未响应或相反
- `mixed`
  - 局部一致、局部冲突

#### `linkageTags`

类型：

- `array[string]`

建议值：

- `infra-chip-alignment`
- `app-pricing-gap`
- `policy-overhang`
- `speculative-risk-on`
- `defensive-rotation`
- `mixed-conviction`

要求：

- 首期最多返回 1 到 3 个
- 必须有明确规则，不要“看着像就贴标签”

#### `keyAgreements`

类型：

- `array[string]`

用途：

- 列出 AI 信息面与市场面一致的点

示例：

- `基础设施主题升温，同时半导体与科技 ETF 走强`
- `模型能力叙事增强，科技风险偏好同步改善`

#### `keyTensions`

类型：

- `array[string]`

用途：

- 列出 AI 信息面与市场面冲突的点

示例：

- `企业应用叙事增多，但市场并未给出对应定价反馈`
- `监管主题升温，市场风险偏好没有同步改善`

#### `aiTrend` 与 `marketTrend`

类型：

- `object`

用途：

- 可选返回精简版子结果
- 供前端 overview 页面同时展示两边摘要

要求：

- 不建议原样嵌完整明细，避免 payload 过大
- 可以只保留摘要字段和关键标签

## 13. 内部实现细化

这一章写“代码里具体怎么落”。

### 13.1 `AnalysisService` 建议结构

建议结构如下：

```go
type AnalysisService struct {
    db *gorm.DB
}
```

建议包含的公开方法：

```go
func NewAnalysisService(db *gorm.DB) *AnalysisService
func (s *AnalysisService) AnalyzeAITrend(window AnalysisWindow) (*AITrendAnalysisResponse, error)
func (s *AnalysisService) AnalyzeMarketTrend(window AnalysisWindow) (*MarketTrendAnalysisResponse, error)
func (s *AnalysisService) AnalyzeOverview(window AnalysisWindow) (*OverviewAnalysisResponse, error)
```

建议包含的私有辅助方法：

- `windowStart(window AnalysisWindow, now time.Time) time.Time`
- `listAIDailyInputs(window AnalysisWindow) ([]aiDailyAnalysisInput, error)`
- `listTechMarketInputs(window AnalysisWindow) ([]techMarketAnalysisInput, error)`
- `listMetalMarketInputs(window AnalysisWindow) ([]metalMarketAnalysisInput, error)`
- `classifyAIDailyThemes(input aiDailyAnalysisInput) []string`
- `computeAIThemeStats(inputs []aiDailyAnalysisInput) aiThemeStats`
- `computeMarketRegime(tech []marketSeriesPoint, metals []marketSeriesPoint) marketRegimeResult`
- `buildOverviewLinkage(ai *AITrendAnalysisResponse, market *MarketTrendAnalysisResponse) overviewLinkageResult`

重点要求：

- 把“查库”和“规则计算”尽量分开
- 把“规则计算”和“HTTP handler”彻底分开
- 尽量让核心规则函数可直接单测

### 13.2 AI 内部输入结构建议

不要直接在规则里使用 `database.AIDailySnapshot`。

建议转换成内部输入结构，例如：

```go
type aiDailyAnalysisInput struct {
    Title         string
    Summary       string
    Content       string
    PublishedDate string
    Sections      []AIDailySection
    FetchedAt     time.Time
}
```

这样做的好处：

- 规则层不依赖 GORM model
- 以后来源换掉也不影响规则函数
- 测试更容易手工构造输入

实现要求：

- `SectionsJSON` 在进入规则层前就完成反序列化
- 解析失败时：
  - 不要直接整批失败
  - 可以记录为空切片继续分析
  - 除非大量核心字段损坏

### 13.3 市场内部输入结构建议

建议先把快照按 symbol 分组成统一结构：

```go
type marketSeriesPoint struct {
    Symbol    string
    Name      string
    Price     float64
    FetchedAt time.Time
}
```

对科技和贵金属可以分别附加分组信息：

```go
type techMarketSeries struct {
    Symbol string
    Points []marketSeriesPoint
}
```

```go
type metalMarketSeries struct {
    Symbol string
    Points []marketSeriesPoint
}
```

关键要求：

- `Price` 必须转成数值再参与计算
- 原表里价格是字符串，需要实现安全解析
- 解析失败的点位应跳过，不应直接导致整个 symbol 报废，除非该 symbol 无法形成起止价格

### 13.4 价格解析规则

当前市场价格字段是字符串，例如：

- `"3348.25"`
- `"714.71"`
- 也可能带逗号、空格、括号、百分号等变体

需要做的事：

1. 新增统一解析函数
2. 去掉常见噪音字符
3. 转为 `float64`
4. 返回解析错误给上层决定是否丢弃

建议函数职责：

- 输入原始字符串
- 清洗后转数值
- 不直接吞掉错误

要求：

- 不要在多个地方各自解析
- 避免科技组和贵金属组各写一套重复逻辑

验收标准：

- 同一种价格格式在所有分析路径下处理一致

## 14. AI 规则细化

### 14.1 主题关键词组织方式

建议在 `analysis.go` 中集中定义：

```go
var aiThemeKeywords = map[string][]string{
    "agent": {...},
    "model-capability": {...},
    "infra": {...},
    "open-source": {...},
    "enterprise-app": {...},
    "regulation": {...},
}
```

要求：

- 所有主题定义放在同一区域
- 后续维护时能一眼看清全部规则
- 不要分散在多个函数中

### 14.2 匹配文本来源

建议对以下字段进行拼接后统一匹配：

- `Title`
- `Summary`
- `Content`
- `Sections[].Heading`
- `Sections[].Items`

要求：

- 匹配前统一转小写
- 合并空格
- 去除明显的换行噪音
- 不需要做 NLP 分词，首期规则法足够

### 14.3 单篇日报主题判定

建议规则：

- 只要某主题任一关键词命中，即认为该篇日报命中该主题
- 同一主题在同一篇日报中命中多次，也只记为“该篇命中一次”
- 同一篇日报允许同时命中多个主题

这样做的原因：

- 首期目标是“主题覆盖分布”，不是做复杂打分模型
- 能显著降低实现复杂度和误差放大

### 14.4 主导主题判定

建议规则：

- 统计窗口内每个主题的命中篇数
- 按命中篇数降序排序
- 命中篇数大于等于 2 且占比达到一定阈值的，进入主导主题列表

建议阈值：

- `7d` 和 `30d`：
  - 占样本数至少 20%
- `1d`：
  - 只要命中即可列出，但 `confidence` 通常不高

### 14.5 Emerging 主题判定

首期建议采用最小规则：

- 把窗口内日报按时间排序
- 分成前半段和后半段
- 某主题如果主要出现在后半段，且前半段弱、后半段明显增强，则视为 `emerging`

示例规则：

- 前半段命中数 `<= 1`
- 后半段命中数 `>= 2`

这样做的优点：

- 简单
- 可解释
- 不需要额外时间序列算法

## 15. 市场规则细化

### 15.1 窗口内起止点选择

同一标的在窗口内可能有多条快照。

建议规则：

- 起点价格：
  - 使用窗口内最早有效价格
- 终点价格：
  - 使用窗口内最新有效价格

要求：

- 必须按 `FetchedAt` 排序后取值
- 无效价格点位跳过

### 15.2 变化率计算

建议公式：

```text
changePercent = ((endPrice - startPrice) / startPrice) * 100
```

要求：

- `startPrice == 0` 时直接视为无效，不参与计算
- 保留合理小数位，前端可直接展示

### 15.3 市场状态判定规则

建议最小规则：

#### 判定 `risk-on`

满足大多数条件即可：

- 科技组上涨标的数大于下跌标的数
- 科技组平均变化率为正
- 贵金属组平均变化率不强或为负

#### 判定 `risk-off`

满足大多数条件即可：

- 科技组下跌标的数大于上涨标的数
- 科技组平均变化率为负
- 黄金或白银表现为正，且贵金属整体偏强

#### 判定 `mixed`

其他所有情况：

- 科技组和贵金属组各自分化
- 科技上涨但黄金也强
- 科技下跌但贵金属没有明显避险走强

### 15.4 关键标的权重建议

虽然首期不做复杂加权模型，但可在规则中体现轻微优先级：

科技组重点：

- `QQQ`
- `SMH`
- `NDX`

贵金属组重点：

- `XAU`
- `XAG`

原因：

- 更能代表科技风险偏好与避险倾向

要求：

- 即使加入优先级，也不要做复杂黑盒权重
- 规则必须写得让维护者看得懂

## 16. 综合联动规则细化

### 16.1 联动分析目标

综合接口不是把两个结果拼一起，而是回答：

- AI 行业叙事与市场价格反馈是否一致
- 一致体现在哪里
- 不一致体现在哪里
- 哪类主题正在获得市场确认，哪类主题仍停留在信息层

### 16.2 联动标签首期规则建议

#### `infra-chip-alignment`

命中条件建议：

- `infra` 在 `dominantThemes` 中
- 科技市场为 `risk-on` 或科技组明显偏强
- `SMH` 或 `QQQ` 在 `leaders` 中

#### `app-pricing-gap`

命中条件建议：

- `enterprise-app` 为主导或 emerging
- 市场不是明显 `risk-on`
- 科技组对应用叙事未形成强跟涨

#### `policy-overhang`

命中条件建议：

- `regulation` 占比较高
- 市场为 `risk-off` 或 `mixed`
- 综合摘要中应强调政策不确定性压制风险偏好

#### `speculative-risk-on`

命中条件建议：

- `agent`、`model-capability` 热度高
- 科技组整体上涨明显
- 贵金属不强

#### `defensive-rotation`

命中条件建议：

- AI 叙事不弱，但市场偏 `risk-off`
- 黄金或白银明显偏强

#### `mixed-conviction`

命中条件建议：

- AI 热点分散
- 市场方向也不明确
- 一致性不足

### 16.3 综合摘要写法要求

综合摘要必须回答两个问题：

- 信息面在讲什么
- 市场面是否认可

推荐句式：

- `AI 信息面偏向基础设施与模型能力，科技市场同步偏强，说明当前叙事与风险偏好存在一致性。`
- `企业应用主题开始升温，但科技市场未给出同等幅度的价格反馈，当前更像叙事先行。`
- `监管相关信息占比上升，同时市场转向 mixed，说明风险偏好受到一定压制。`

要求：

- 用结构化结果驱动文案
- 不要写空泛总结

## 17. 错误处理规范

### 17.1 错误分类

建议分三类：

- 参数错误
- 数据不足错误
- 内部计算错误

### 17.2 参数错误

场景：

- `window=2d`
- `window=abc`

返回：

- `400 Bad Request`

响应示例：

```json
{
  "message": "invalid analysis window"
}
```

### 17.3 数据不足错误

场景：

- AI 日报样本过少
- 市场窗口内有效历史不足
- 综合接口任一核心输入不足

返回：

- `422 Unprocessable Entity`

响应示例：

```json
{
  "message": "insufficient ai daily data for analysis"
}
```

或：

```json
{
  "message": "insufficient market history for analysis"
}
```

### 17.4 内部错误

场景：

- JSON 解析异常超出容忍范围
- 数据库查询失败
- 关键计算逻辑异常

返回：

- `500 Internal Server Error`

响应示例：

```json
{
  "message": "analysis computation failed"
}
```

要求：

- 不向前端暴露内部 stack 或 SQL 错误
- 服务端日志可记录原始错误细节

## 18. 测试计划

### 18.1 单元测试优先级

首期最值得测试的是规则函数，不是 handler。

优先测试：

- 窗口解析
- AI 主题归类
- AI 主导主题判定
- emerging 主题判定
- 价格解析
- 变化率计算
- 市场 regime 判定
- 综合 linkage tag 判定

### 18.2 建议测试清单

#### 窗口解析测试

覆盖：

- 空值返回默认 `7d`
- `1d` 合法
- `7d` 合法
- `30d` 合法
- 大写非法
- 未知值非法

#### AI 主题分类测试

覆盖：

- 单篇命中单主题
- 单篇命中多主题
- 无关键词命中
- 章节文本可触发主题
- 大小写不影响结果

#### AI 趋势测试

覆盖：

- `infra` 明显主导
- `regulation` 后半段升温形成 emerging
- 样本不足时报错
- 主题非常分散时 `confidence` 降低

#### 市场分析测试

覆盖：

- 科技组普涨、贵金属偏弱 => `risk-on`
- 科技组走弱、黄金白银走强 => `risk-off`
- 两边都分化 => `mixed`
- 某些 symbol 缺历史但整体仍可分析
- 关键 symbol 全部缺失时报错

#### 综合分析测试

覆盖：

- `infra + SMH/QQQ 强` => `infra-chip-alignment`
- `enterprise-app` 热但市场平 => `app-pricing-gap`
- `regulation` 热且市场弱 => `policy-overhang`

### 18.3 Handler 层测试

首期可以少量覆盖：

- 合法 query 返回 `200`
- 非法窗口返回 `400`
- 数据不足映射到 `422`
- 内部错误映射到 `500`

## 19. 文档更新要求

### 19.1 更新 `API.md`

必须新增三个接口完整文档：

- `GET /api/v1/analysis/ai-trend`
- `GET /api/v1/analysis/market-trend`
- `GET /api/v1/analysis/overview`

每个接口要写：

- 接口用途
- query 参数
- 默认值
- 成功响应示例
- 错误响应示例
- 字段说明

### 19.2 `README.md` 是否更新

如果 README 中已有能力概述，建议补一段：

- 项目现在除了论坛、市场、AI 日报，还支持结构化分析接口

如果 README 只是启动文档，可以不强制改。

## 20. 实施顺序建议

为了降低返工，建议按下面顺序实施，不要跳步。

### 阶段 1：骨架阶段

1. 新增 `analysis.go`
2. 定义 `AnalysisService`
3. 定义窗口类型
4. 定义响应结构
5. 定义错误常量或错误分类方式

目标：

- 先稳定接口边界和代码骨架

### 阶段 2：AI 分析阶段

1. 读取 AI 日报数据
2. 解析 sections
3. 实现主题分类
4. 实现主题统计
5. 实现 AI 趋势响应组装
6. 补 AI 相关单测

目标：

- 先跑通 `GET /api/v1/analysis/ai-trend`

### 阶段 3：市场分析阶段

1. 读取科技市场与贵金属数据
2. 实现价格解析
3. 实现按 symbol 分组
4. 实现变化率计算
5. 实现 `risk-on/risk-off/mixed`
6. 补市场相关单测

目标：

- 跑通 `GET /api/v1/analysis/market-trend`

### 阶段 4：综合分析阶段

1. 复用 AI 趋势结果
2. 复用市场趋势结果
3. 实现联动标签
4. 实现一致/冲突摘要
5. 补 overview 相关测试

目标：

- 跑通 `GET /api/v1/analysis/overview`

### 阶段 5：接入阶段

1. 新增 `analysis handler`
2. 在 `server.go` 注册路由
3. 做基础联调
4. 更新 `API.md`

目标：

- 从服务启动到接口文档全链路完成

## 21. 验收标准

### 21.1 功能验收

必须满足：

- 能新增 3 个只读分析接口
- `window` 支持 `1d/7d/30d`
- 非法窗口返回 `400`
- 数据不足返回 `422`
- 内部错误返回 `500`
- AI 趋势返回结构化主题结果
- 市场趋势返回 `marketRegime`
- 综合接口返回联动标签和摘要

### 21.2 代码结构验收

必须满足：

- 分析逻辑位于独立 `AnalysisService`
- HTTP 层位于独立 `AnalysisHandler`
- 不把复杂规则塞回 `ForumService`
- 规则函数具备单测入口

### 21.3 可维护性验收

必须满足：

- 主题关键词集中定义
- 市场 regime 规则集中定义
- linkage tag 规则集中定义
- API 字段命名一致、清晰、稳定

## 22. 风险与后续演进

### 22.1 首期风险

#### 关键词规则偏硬

风险：

- 可能漏掉语义相近但未收录的表述

缓解：

- 先把关键词集中配置
- 后续按真实数据逐步补充

#### 市场数据是快照，不是高频 K 线

风险：

- 窗口内样本点不均匀，结论可能偏粗

缓解：

- 在 `risks` 和 `dataStatus.note` 中明确说明
- 首期只做方向性判断，不做精细量化结论

#### 样本规模受同步频率影响

风险：

- `1d` 窗口下数据可能很少

缓解：

- 明确 `422` 阈值
- 默认窗口使用 `7d`

### 22.2 后续演进方向

后续可以扩展：

1. 分析结果缓存
2. 分析结果入库与历史快照
3. 前端分析页
4. 周报/月报生成
5. 接入论坛讨论热度作为辅助因子
6. 接入 LLM 仅做自然语言润色，不替代规则层
7. 做更细粒度主题体系
8. 支持可配置规则

## 23. 开发时的具体执行清单

这是最贴近“照着做”的 checklist。

### 23.1 新增文件

- `internal/service/analysis.go`
- `internal/handler/analysis.go`
- `internal/service/analysis_test.go`

### 23.2 修改文件

- `internal/server/server.go`
- `API.md`
- 可选：`README.md`

### 23.3 `analysis.go` 先写的内容

先写：

- `AnalysisWindow`
- `AnalysisService`
- 响应 struct
- 内部输入 struct
- 主题关键词定义
- 窗口解析函数
- 基础错误定义

再写：

- AI 数据读取
- AI 主题分析
- 市场数据读取
- 市场方向分析
- overview 联动分析

### 23.4 `analysis.go` 最后补的内容

最后补：

- 风险文案收敛
- confidence 规则收敛
- evidence 精简策略
- 注释与命名统一

### 23.5 `analysis.go` 不要做的事

不要做：

- 不要直接写进 `ForumService`
- 不要一开始就引入缓存
- 不要一开始就接 LLM
- 不要把字符串常量散落在各处
- 不要让 handler 承担分析逻辑

## 24. 最终建议的接口响应结构

这一章的目标不是再讲概念，而是把“最终最好长什么样”固定下来，减少实现时反复改字段。

### 24.1 AI 趋势接口最终建议结构

```json
{
  "window": "7d",
  "generatedAt": "2026-05-21T10:30:00+08:00",
  "dataStatus": {
    "sampleCount": 7,
    "sufficient": true,
    "note": ""
  },
  "summary": "最近 7 天 AI 主题主要集中在基础设施与模型能力，显示行业关注点仍偏算力、推理与底层能力建设。",
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
    "多篇日报集中提到 GPU、推理服务与数据中心扩容",
    "模型能力更新以推理和多模态为主",
    "企业应用话题开始升温，但尚未成为主导叙事"
  ],
  "risks": [
    "关键词分类为规则法，可能遗漏隐含主题",
    "短窗口结果更反映近期热度，不等于长期趋势"
  ],
  "confidence": "medium",
  "evidence": [
    {
      "title": "AI Daily A",
      "publishedDate": "2026-05-20",
      "themes": ["infra", "model-capability"]
    },
    {
      "title": "AI Daily B",
      "publishedDate": "2026-05-19",
      "themes": ["infra"]
    }
  ]
}
```

实现要求：

- `dominantThemes` 必须已经排序
- `share` 统一保留 2 位或 3 位小数即可，但同一接口内部要一致
- `headlineSignals` 不要过长，适合前端直接渲染成列表
- `evidence` 只放代表性条目，不要把所有日报塞进去

### 24.2 市场趋势接口最终建议结构

```json
{
  "window": "7d",
  "generatedAt": "2026-05-21T10:30:00+08:00",
  "dataStatus": {
    "techCoveredSymbolCount": 5,
    "metalCoveredSymbolCount": 4,
    "sufficient": true,
    "coveredSymbols": ["NDX", "QQQ", "XLK", "SMH", "IGV", "XAU", "XAG", "XPT", "XPD"],
    "expectedSymbols": ["NDX", "QQQ", "XLK", "SMH", "IGV", "XAU", "XAG", "XPT", "XPD"],
    "note": ""
  },
  "summary": "科技风险资产整体偏强，贵金属分化偏弱，市场处于 risk-on 状态。",
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
    },
    {
      "symbol": "XAG",
      "changePercent": -0.2
    }
  ],
  "risks": [
    "市场数据来自抓取快照，不是交易所级高频数据",
    "不同标的窗口内样本点数量可能不完全一致"
  ],
  "confidence": "medium",
  "evidence": [
    {
      "symbol": "QQQ",
      "startPrice": "700.10",
      "endPrice": "719.70",
      "changePercent": 2.8
    },
    {
      "symbol": "SMH",
      "startPrice": "241.00",
      "endPrice": "250.88",
      "changePercent": 4.1
    },
    {
      "symbol": "XAU",
      "startPrice": "3368.20",
      "endPrice": "3344.50",
      "changePercent": -0.7
    }
  ]
}
```

实现要求：

- `leaders` 和 `laggards` 最好来自同一套变化率结果，不要重复计算
- `evidence` 要兼顾科技组和贵金属组
- `marketRegime` 必须和 `summary` 一致

### 24.3 综合接口最终建议结构

```json
{
  "window": "7d",
  "generatedAt": "2026-05-21T10:30:00+08:00",
  "dataStatus": {
    "aiSampleCount": 7,
    "techCoveredSymbolCount": 5,
    "metalCoveredSymbolCount": 4,
    "sufficient": true,
    "coveredSymbols": ["NDX", "QQQ", "XLK", "SMH", "IGV", "XAU", "XAG", "XPT", "XPD"],
    "expectedSymbols": ["NDX", "QQQ", "XLK", "SMH", "IGV", "XAU", "XAG", "XPT", "XPD"],
    "note": ""
  },
  "summary": "AI 信息面偏向基础设施与模型能力，科技市场同步偏强，说明当前叙事与风险偏好存在较强一致性。",
  "alignment": "aligned",
  "linkageTags": [
    "infra-chip-alignment"
  ],
  "keyAgreements": [
    "基础设施主题升温，同时半导体和科技 ETF 走强",
    "模型能力叙事增强，市场风险偏好同步改善"
  ],
  "keyTensions": [
    "企业应用主题开始出现，但价格反馈仍不明显"
  ],
  "aiTrend": {
    "summary": "AI 主题主要集中在基础设施与模型能力。",
    "dominantThemes": ["infra", "model-capability"],
    "confidence": "medium"
  },
  "marketTrend": {
    "summary": "科技风险资产整体偏强，市场处于 risk-on 状态。",
    "marketRegime": "risk-on",
    "confidence": "medium"
  },
  "risks": [
    "综合判断依赖规则联动，不代表长期因果关系",
    "市场反馈可能滞后于信息面变化"
  ],
  "confidence": "medium"
}
```

实现要求：

- `aiTrend` 和 `marketTrend` 在综合接口里建议返回精简版
- `alignment`、`linkageTags`、`keyAgreements`、`keyTensions` 才是 `overview` 的核心新增价值
- 如果 AI 和市场都能分析，但联动不明显，也应返回正常 `200`，不要因为“看不出强关系”就报错

## 25. Handler 设计细化

### 25.1 `AnalysisHandler` 职责边界

`AnalysisHandler` 只负责：

- 解析 query 参数
- 调用 service
- 映射错误到状态码
- 输出 JSON

`AnalysisHandler` 不负责：

- 主题分类
- 市场方向判断
- 综合标签判定
- 价格计算
- 数据库查询拼装逻辑

这样做的原因：

- handler 应保持薄
- 规则逻辑必须留在 service 层，便于测试和维护

### 25.2 Handler 方法建议

建议方法名：

- `GetAITrend`
- `GetMarketTrend`
- `GetOverview`

每个方法内部执行步骤统一为：

1. 取 `window := c.Query("window")`
2. 调 `parseAnalysisWindow`
3. 若参数错，返回 `400`
4. 调对应 `AnalysisService`
5. 根据错误类型返回 `422` 或 `500`
6. 成功返回 `200` JSON

这样做的好处：

- 三个接口处理流程完全一致
- 用户后续读 handler 代码时更容易理解

### 25.3 错误映射建议

建议 service 层通过可识别错误返回，handler 再统一映射。

可以采用的思路：

- 参数错误单独处理
- 数据不足错误用固定 sentinel error
- 其余错误都映射成内部错误

虽然现在还是 plan，不直接写代码，但实现时建议保持简单，不要一开始设计过于复杂的错误体系。

## 26. `server.go` 接入细化

### 26.1 `Server` 结构新增项

当前 `Server` 已有：

- `authHandler`
- `forumHandler`

建议新增：

- `analysisHandler`

### 26.2 `Init()` 里的新增步骤

在 `Init(db, cfg)` 中建议新增：

1. `analysisService := service.NewAnalysisService(db)`
2. `s.analysisHandler = handler.NewAnalysisHandler(analysisService)`

要求：

- 放在已有 service/handler 初始化区块内
- 继续沿用当前项目的依赖注入风格
- 不需要额外改配置文件

### 26.3 `registerRoutes()` 里的新增路由

建议新增到 `/api/v1` group 下：

- `GET /analysis/ai-trend`
- `GET /analysis/market-trend`
- `GET /analysis/overview`

要求：

- 使用 `api.GET(...)`
- 继续走 `optionalAuth`
- 不加 `authGuard`

补充说明：

- `optionalAuth` 的语义必须是不拦截匿名访问，只在存在登录态时注入可选用户上下文
- 如果现有项目中的 `optionalAuth` 会影响匿名访问，analysis 路由就不应挂它
- 这三个接口本身不依赖用户身份，不得因为未登录而返回鉴权失败

原因：

- 这三个接口是只读分析能力
- 没有用户私有数据
- 适合公开消费

## 27. 数据读取细化

### 27.1 AI 日报读取要求

读取时要注意几个问题：

#### 问题 1：同一篇日报可能存在重复快照

虽然 `AIDailySnapshot` 通过 `source + slug` 有唯一约束，但窗口内仍要以当前表中实际记录为准。

实现建议：

- 正常读取即可
- 如果未来真的出现重复异常，分析层再保底按 `slug` 去重
- 首期不要因为极端情况把查询做得过度复杂

#### 问题 2：`SectionsJSON`、`LinksJSON`、`MetaJSON` 是字符串

要求：

- 进入规则层前完成必要 JSON 反序列化
- 反序列化失败时，优先降级处理而不是整批失败

建议策略：

- `SectionsJSON` 失败：
  - sections 视为空
- `LinksJSON` 失败：
  - 忽略即可，因为首期分析核心不依赖 links
- `MetaJSON` 失败：
  - 忽略即可，除非后续规则确实依赖

#### 问题 3：`PublishedDate` 可能为空或格式不完全一致

要求：

- 首期展示时以原始字符串为主
- 不要强依赖 `PublishedDate` 做核心时间逻辑
- 核心窗口判断继续依赖 `FetchedAt`

这是非常重要的边界：

- `FetchedAt` 决定“这条数据何时进入系统”
- `PublishedDate` 更适合做展示和证据说明
- 不建议首期拿 `PublishedDate` 作为严格窗口过滤依据

### 27.2 市场快照读取要求

读取市场数据时要特别注意：

#### 问题 1：同一个 symbol 在窗口内会有多条记录

要求：

- 先按 `Symbol` 分组
- 每组按 `FetchedAt` 升序
- 找最早有效点和最晚有效点

#### 问题 2：价格字段是字符串

要求：

- 统一用一个解析函数转换
- 转不了的点位直接跳过
- 如果整个 symbol 没有两个有效点，则该 symbol 不能参与变化率分析

#### 问题 3：窗口内不同 symbol 的点位数量不同

这不是错误，而是数据现实。

要求：

- 允许样本不完全等长
- 只要某个 symbol 有起止有效价格，就可参与
- 如果关键 symbol 大量缺失，需要降低 `confidence` 或返回 `422`

## 28. `confidence` 规则细化

这是很容易写得模糊的一部分，所以 spec 要先钉死。

### 28.1 AI 接口 `confidence`

建议规则：

#### `high`

满足大部分条件：

- 样本数显著高于最小阈值
- 主导主题前两名明显高于其他主题
- 证据条目足够
- emerging 与 dominant 结果不冲突

#### `medium`

满足：

- 样本达到分析阈值
- 有主导趋势，但不极端明显
- 或主题之间存在一定分散

#### `low`

满足任一即可：

- 样本只刚刚够线
- 主题高度分散
- 主导主题不明显
- sections/content 可用信息偏少

### 28.2 市场接口 `confidence`

建议规则：

#### `high`

- 多数关键 symbol 都有有效起止点
- 科技组与贵金属组方向都较明确
- `risk-on/risk-off` 结论不是勉强得出

#### `medium`

- 有足够样本形成方向判断
- 但部分 symbol 缺失
- 或走势存在一定分化

#### `low`

- 仅少量 symbol 可用
- 科技与贵金属方向均不明显
- `mixed` 是由样本贫弱导致，而不是由真实分化导致

### 28.3 综合接口 `confidence`

综合接口的 `confidence` 不应高于两个子分析里更弱的一方太多。

建议原则：

- 如果任一子分析是 `low`，overview 通常最多 `low` 或 `medium`
- 只有 AI 和市场都至少 `medium`，overview 才有可能是 `high`
- overview 的高置信度必须建立在“子结果强 + 联动明确”之上

## 29. `risks` 文案来源建议

为了避免最后每个接口随手拼风险文案，建议把风险来源收敛成固定几类。

### 29.1 AI 风险来源

可选风险文案：

- `关键词分类为规则法，可能遗漏隐含主题`
- `短窗口结果更反映近期热度，不代表长期趋势`
- `部分日报主题可能同时跨多个分类，主题边界并非绝对互斥`
- `样本数量有限，结论更适合作为方向性参考`

### 29.2 市场风险来源

可选风险文案：

- `市场数据来自抓取快照，不是交易所级高频数据`
- `不同标的窗口内样本点数量可能不完全一致`
- `窗口内起止价格受采样时点影响，结果更适合方向性判断`
- `贵金属与科技资产并不总是形成稳定镜像关系`

### 29.3 综合风险来源

可选风险文案：

- `综合判断依赖规则联动，不代表长期因果关系`
- `市场反馈可能滞后于信息面变化`
- `信息热度与价格表现之间可能存在时间错位`
- `综合标签反映当前窗口结构，不代表稳定中长期结论`

## 30. 边界条件与降级策略

这一章很关键，避免实现时“理想情况能跑，真实情况一出问题就崩”。

### 30.1 AI 日报样本刚好达到阈值

处理方式：

- 允许分析
- 但 `confidence` 倾向 `low` 或 `medium`
- `risks` 中明确提示样本有限

### 30.2 AI 日报正文为空，但标题和摘要存在

处理方式：

- 允许继续分析
- 只用 `title + summary + sections`
- 不要直接判为失败

### 30.3 `SectionsJSON` 解析失败

处理方式：

- 该篇日报的 sections 视为空
- 不让整个接口失败
- 若失败比例很高，可在 `risks` 中提示文本结构不完整

### 30.4 某个市场 symbol 只有一个有效点

处理方式：

- 该 symbol 不参与变化率计算
- 不让整个接口失败
- 但若关键 symbol 大量如此，需要影响 `dataStatus` 和 `confidence`

### 30.5 科技组数据足够，贵金属组数据不足

处理方式：

- 允许返回 `200`
- 在 `dataStatus.note` 中明确说明贵金属样本不足或部分缺失
- 将 `confidence` 至少下调一级
- 在 `risks` 中补充“避险组样本不完整，市场判断更偏科技风险偏好视角”
- 仅当整体市场分析已无法形成基本方向判断时，才返回 `422`

这是一项明确设计决策，不允许实现时临时改成更严格模式，否则会导致接口可用性与 spec 不一致。

### 30.6 AI 能分析、市场不能分析时的 `overview`

建议：

- `overview` 依赖两边结果
- 任一核心输入不足时，`overview` 返回 `422`

原因：

- `overview` 的价值在“联动”
- 缺一边就不是完整 overview

## 31. 开发任务拆解表

这章适合直接放到 spec 最后，方便后续按任务执行。

### 31.1 Task 1：搭分析模块骨架

目标：

- 新建 service、handler、类型定义、窗口解析、错误结构

涉及文件：

- `internal/service/analysis.go`
- `internal/handler/analysis.go`
- `internal/server/server.go`

输出：

- 编译可过的分析骨架
- 3 个空实现或最小实现方法
- 路由占位接入方案明确

验收：

- 代码结构完整
- 还没写完逻辑也可以先通过编译

### 31.2 Task 2：实现 AI 趋势分析

目标：

- 从 AI 日报快照中输出主题分析结果

涉及文件：

- `internal/service/analysis.go`
- `internal/service/analysis_test.go`

输出：

- AI 数据读取
- 主题分类
- 主导主题
- emerging 主题
- AI summary / evidence / confidence / risks

验收：

- `GET /api/v1/analysis/ai-trend?window=7d` 可返回正常结果
- 样本不足时返回 `422`

### 31.3 Task 3：实现市场趋势分析

目标：

- 从科技市场和贵金属快照中输出市场结构分析

涉及文件：

- `internal/service/analysis.go`
- `internal/service/analysis_test.go`

输出：

- 价格解析
- 起止点提取
- 变化率计算
- market regime 判定
- leaders / laggards / evidence / confidence / risks

验收：

- `GET /api/v1/analysis/market-trend?window=7d` 可返回正常结果
- 参数错返回 `400`
- 历史不足时返回 `422`

### 31.4 Task 4：实现综合联动分析

目标：

- 基于 AI 和市场结果输出 overview

涉及文件：

- `internal/service/analysis.go`
- `internal/service/analysis_test.go`

输出：

- alignment
- linkageTags
- keyAgreements
- keyTensions
- overview summary
- 精简版 `aiTrend` / `marketTrend`

验收：

- `GET /api/v1/analysis/overview?window=7d` 可返回正常结果
- 两边任一不足时返回 `422`

### 31.5 Task 5：接 handler 和路由

目标：

- 对外暴露三个分析接口

涉及文件：

- `internal/handler/analysis.go`
- `internal/server/server.go`

输出：

- 三个 GET 接口可访问
- 错误状态码映射正确

验收：

- 本地启动后可用 curl 或前端直接请求验证

### 31.6 Task 6：补 API 文档

目标：

- 更新文档，供前端直接对接

涉及文件：

- `API.md`
- 可选：`README.md`

输出：

- 接口用途、参数、成功示例、错误示例、字段说明

验收：

- 不读源码也能理解怎么调接口

## 32. 联调与验收建议

### 32.1 本地联调前置条件

需要先保证数据库里有基础数据。

建议本地准备顺序：

1. 启动数据库
2. 启动后端
3. 至少执行一次：
   - AI 日报同步
   - 科技市场同步
   - 贵金属同步

否则分析接口可能只会返回数据不足。

### 32.2 联调顺序建议

建议按这个顺序验：

1. `GET /api/v1/analysis/ai-trend`
2. `GET /api/v1/analysis/market-trend`
3. `GET /api/v1/analysis/overview`

原因：

- 先验证两个子分析
- 再验证综合分析
- 更容易定位问题

### 32.3 手工验收点

#### AI 接口

检查：

- `window` 是否正确
- `sampleCount` 是否合理
- `dominantThemes` 是否排序
- `summary` 是否与主题结果一致
- `confidence` 是否符合样本规模

#### 市场接口

检查：

- `marketRegime` 是否和 leaders/laggards 一致
- `averageChangePercent` 是否合理
- `evidence` 起止价格是否能对上变化率
- 缺样本时是否有风险提示

#### 综合接口

检查：

- `alignment` 是否与两边 summary 一致
- `linkageTags` 是否有明确理由
- `keyAgreements` / `keyTensions` 是否不是空泛句子

## 33. 推荐写入 spec 的最终结论

如果要把整篇 spec 收尾成一句执行导向的结论，建议这样写：

本次改造将为项目新增一个独立的结构化分析模块，通过 `AI 日报`、`AI / 科技市场` 和 `贵金属市场` 三类已入库数据，输出 `AI 趋势分析`、`市场趋势分析` 和 `综合联动分析` 三个只读接口。首期坚持规则优先、可解释优先、最小可用优先，不依赖 LLM、不新增分析表、不改现有同步链路，先把分析能力稳定沉淀为后端可复用接口，为后续前端分析页、报告快照与智能总结打基础。

## 34. 最终决策记录

本次 spec 已明确以下实现决策：

- 市场接口在“科技组样本足够、贵金属组样本不足”时，不强制返回 `422`
- 允许返回 `200`
- 但必须在 `dataStatus.note` 中明确说明样本缺口
- 必须下调 `confidence`
- 必须在 `risks` 中提示结论偏向科技风险偏好视角
- 只有当整体市场方向已无法形成基本判断时，才返回 `422`

这个决策已经确认，后续实现与验收都应按该规则执行。
