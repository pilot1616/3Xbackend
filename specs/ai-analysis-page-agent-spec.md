# AI 分析页 Agent 全链路落地 Spec

## 0. 状态

- 状态：`proposed`
- 适用范围：`3Xbackend` 当前仓库内的前端与后端联动实现
- 目标阶段：在现有后端分析接口已经完成的前提下，继续把能力接到页面，直到用户可以在站内直接使用这个 agent 功能

## 1. 背景

当前项目已经完成 AI 分析能力的后端第一阶段落地：

- `GET /api/v1/analysis/ai-trend`
- `GET /api/v1/analysis/market-trend`
- `GET /api/v1/analysis/overview`

这些接口已经可以输出结构化分析结果，但产品层仍然缺失最后一段闭环：

- 前端没有分析页入口
- 前端没有 analysis API client 和类型定义
- 用户无法在页面上切换窗口并查看分析结果
- 用户无法把 `AI 趋势`、`市场趋势`、`综合结论` 当作一个完整 agent 能力来使用

因此，本次需要新增一份二期 spec，把这个“分析 agent”从后端接口推进到站内可用产品功能。

## 2. 目标

本次目标：

- 新增一个站内可访问的 `AI 分析` 页面
- 页面可直接消费现有 3 个 analysis 接口
- 用户可以切换 `1d / 7d / 30d` 窗口查看结果
- 用户可以在一个页面内同时看到：
  - AI 信息面趋势
  - 市场风险偏好趋势
  - 两者联动后的综合判断
- 页面必须正确展示：
  - 结论
  - 证据
  - 风险
  - 数据充分性
  - 部分降级状态
- 页面要达到“可以给真实用户使用”的程度，而不是只展示原始 JSON
- 保持当前产品视觉体系一致，不做脱离现有站点的独立设计语言

非目标：

- 本次不新增聊天式对话框
- 本次不接入 LLM
- 本次不新增分析结果落库
- 本次不做用户级收藏、订阅、分享
- 本次不做图表化时间序列回放
- 本次不改现有 analysis 后端契约，除非前端接入过程中发现缺口并单独评估

## 3. 产品定位

这里的 agent 不是“聊天机器人”，而是“站内可交互的分析工作台”。

用户使用方式应当是：

- 进入页面
- 选择分析窗口
- 查看系统给出的结构化结论
- 根据证据与风险判断当前 AI 与市场状态

这个页面本质上是“analysis engine 的产品化入口”。

## 4. 用户故事

### 4.1 普通访客

作为访客，我希望：

- 不需要登录也能打开分析页
- 一进入页面就能看到最近窗口下的 AI 趋势与市场趋势
- 可以切换 `1d / 7d / 30d` 看短线和中期差异
- 可以快速看懂当前结论的可信度、证据和风险

### 4.2 轻度使用者

作为经常浏览站内内容的用户，我希望：

- 有一个稳定入口，而不是去手拼接口
- 不需要自己把 3 个接口结果脑补拼起来
- 页面可以明确告诉我哪些结论是“部分样本下的结论”

### 4.3 维护者

作为维护者，我希望：

- 前端接入复用当前 API client、类型定义、页面风格
- 页面结构可测、状态可控、错误呈现清晰
- 如果后续要加缓存、图表、报告或聊天层，不需要推翻本次实现

## 5. 当前基础与约束

### 5.1 后端基础

当前已经存在并可用：

- `internal/handler/analysis.go`
- `internal/service/analysis.go`
- `internal/server/server.go`
- `API.md` 中对应 analysis 文档

当前分析接口已经支持：

- `window=1d|7d|30d`
- 空值默认 `7d`
- 明确错误码与错误文案
- 匿名访问

### 5.2 前端基础

当前前端代码位置：

- `front/src/App.tsx`
- `front/src/components/AppShell.tsx`
- `front/src/pages/MarketPage.tsx`
- `front/src/pages/AIDailyPage.tsx`
- `front/src/api/forum.ts`
- `front/src/types/api.ts`
- `front/src/styles.css`

当前事实：

- 站内已有 `/market` 和 `/ai-daily` 页面
- 导航结构在 `AppShell` 中统一维护
- API client 集中在 `front/src/api/forum.ts`
- 接口响应类型集中在 `front/src/types/api.ts`
- 样式目前是单文件 `styles.css`

### 5.3 实施约束

- 必须沿用现有 React + TypeScript 写法
- 必须沿用现有站点视觉语言，不能做完全割裂的新产品皮肤
- 尽量复用当前 `MarketPage` 的页面组织经验，但不能直接复制其“行情监控台”结构
- 页面必须支持移动端基本可用
- 接口失败、422 数据不足、500 计算失败都要有明确展示

## 6. 总体方案

本次新增一个独立页面：

- 路由：`/analysis`
- 导航文案：`AI 分析`
- 页面名称：`AnalysisPage`

页面作为一个完整分析工作台，由三块核心内容组成：

- `综合结论区`：优先展示 `overview`
- `AI 趋势区`：展示 `ai-trend`
- `市场趋势区`：展示 `market-trend`

页面顶部提供：

- 页面标题与说明
- 窗口切换器：`1d / 7d / 30d`
- 手动刷新按钮
- 最近生成时间

页面主体遵循“先结论，后证据”的结构，而不是“先技术细节，后摘要”。

## 7. 页面信息架构

### 7.1 顶部 Hero

展示内容：

- 标题：`AI 分析 Agent`
- 副标题：例如“把 AI 日报、科技市场与避险资产组合成一页可读的结构化判断”
- 当前窗口
- 最近生成时间
- 手动刷新按钮

交互要求：

- 窗口切换放在 Hero 右侧或下方首行，不可埋得太深
- 当前选中的窗口状态必须明显
- 刷新时有 loading 态

### 7.2 综合结论区

数据来源：

- `GET /api/v1/analysis/overview`

展示重点：

- `summary`
- `alignment`
- `linkageTags`
- `keyAgreements`
- `keyTensions`
- `confidence`
- `risks`
- `dataStatus`

设计要求：

- 这是页面视觉重心
- 要一眼看出“AI 面和市场面是否一致”
- `aligned / diverging / mixed` 需要有稳定的颜色或徽标语义

### 7.3 AI 趋势区

数据来源：

- `GET /api/v1/analysis/ai-trend`

展示重点：

- `summary`
- `dominantThemes`
- `emergingThemes`
- `headlineSignals`
- `confidence`
- `evidence`
- `risks`
- `dataStatus.sampleCount`
- `dataStatus.note`

设计要求：

- dominant theme 和 emerging theme 必须可视区分
- 证据条目更像“文章线索”，不是 market ticker
- 如果有 fallback note，要展示出来，不要吞掉

### 7.4 市场趋势区

数据来源：

- `GET /api/v1/analysis/market-trend`

展示重点：

- `summary`
- `marketRegime`
- `techMomentum`
- `safeHavenMomentum`
- `leaders`
- `laggards`
- `confidence`
- `evidence`
- `risks`
- `dataStatus.coveredSymbols`
- `dataStatus.expectedSymbols`
- `dataStatus.partial`
- `dataStatus.note`

设计要求：

- `risk-on / risk-off / mixed` 要有明确视觉区分
- `leaders` 与 `laggards` 要像“动向摘要”，不是原始表格
- 当贵金属组不足但整体允许降级成功时，要突出 `partial` 状态

### 7.5 数据状态区

页面需要一个统一的数据状态展示层，可放在 Hero 下面或各模块顶部。

需要表达：

- 当前是否 `sufficient`
- 是否 `partial`
- 窗口起止时间
- AI 样本数
- 市场覆盖 symbol 数
- 任何 note

原因：

- 这个 agent 强依赖“数据充分性”
- 如果不显式展示，用户会把低置信度结果误解为稳定结论

## 8. 前端数据模型设计

### 8.1 `front/src/types/api.ts` 需要新增的类型

建议新增：

- `AnalysisWindow = '1d' | '7d' | '30d'`
- `AnalysisDataStatus`
- `ThemeCount`
- `EmergingTheme`
- `AIEvidenceItem`
- `MarketMomentum`
- `MarketMover`
- `MarketEvidenceItem`
- `OverviewEvidenceItem`
- `AITrendAnalysisResponse`
- `MarketTrendAnalysisResponse`
- `OverviewAnalysisResponse`

要求：

- 字段名保持与后端 JSON 一致
- 不做前端私自重命名
- 可选字段必须按后端真实返回建模

### 8.2 `front/src/api/forum.ts` 需要新增的 API 方法

建议新增：

- `getAITrend(window?: AnalysisWindow)`
- `getMarketTrend(window?: AnalysisWindow)`
- `getOverview(window?: AnalysisWindow)`

建议保留统一 query 拼接方式，沿用现有 `toQueryString()`。

## 9. 页面状态管理设计

`AnalysisPage` 最小状态建议：

- `window`
- `loading`
- `refreshing`
- `message`
- `aiTrend`
- `marketTrend`
- `overview`

可选增强状态：

- `lastLoadedAt`
- `activeSection`

加载策略：

- 页面初次进入时并行请求 3 个 analysis 接口
- 切换窗口时重新并行请求
- 点击刷新时重新请求当前窗口
- 任何一次新请求开始时，要清理旧错误提示

并发要求：

- 3 个接口必须并行请求，不要串行
- 如果其中一个接口失败，不应直接让整个页面白屏

建议容错策略：

- `overview` 失败但子接口成功：页面仍显示 AI/市场两个模块，并在综合区显示错误卡
- `ai-trend` 失败但其余成功：保留其余模块，AI 区单独显示错误态
- `market-trend` 失败但其余成功：保留其余模块，市场区单独显示错误态

## 10. 错误与空态设计

### 10.1 400

场景：

- 非法 `window`

要求：

- 前端正常情况下不会发出非法值
- 如果出现，应展示“分析窗口无效，请刷新后重试”

### 10.2 422

场景：

- `INSUFFICIENT_AI_DAILY_DATA`
- `INSUFFICIENT_MARKET_HISTORY`

要求：

- 必须当作“业务型无结果”，不是“系统崩溃”
- 页面提示应说明：当前窗口数据不足，建议切到更长窗口
- 可以在错误卡中直接提供窗口切换 CTA

### 10.3 500

场景：

- `ANALYSIS_COMPUTATION_FAILED`

要求：

- 作为系统异常显示
- 保留“重试”按钮

### 10.4 部分成功

场景：

- `market-trend` 返回 `200` 但 `dataStatus.partial = true`

要求：

- 不能按成功静默处理
- 必须显示 `partial` 标识
- note 和 risks 需要显式呈现

## 11. 视觉与交互要求

### 11.1 风格原则

- 延续当前深色玻璃感和空间层次
- 但弱化 `MarketPage` 那种“实时行情控制台”的观感
- 更像“分析面板 + 研究摘要页”

### 11.2 命名要求

新增样式 class 建议使用：

- `analysis-page-*`
- `analysis-hero-*`
- `analysis-panel-*`
- `analysis-chip-*`
- `analysis-state-*`

不要继续复用：

- `market-*`
- `legacy-home-*`

### 11.3 组件层级建议

可在单文件页面中先落地，必要时再拆组件。

建议最小拆分：

- `AnalysisPage`
- `AnalysisWindowSwitcher`
- `AnalysisStatusStrip`
- `OverviewPanel`
- `AITrendPanel`
- `MarketTrendPanel`

如果实现时觉得拆分过重，可以先保留在一个页面文件内，只要结构清晰。

### 11.4 移动端要求

- 顶部 Hero 允许折行为两到三层
- 窗口切换按钮在移动端可横向排布或自动换行
- 三大分析区在移动端改为单列堆叠
- tag、risk、evidence 不能因为宽度不足而挤坏布局

## 12. 路由与导航设计

### 12.1 路由

在 `front/src/App.tsx` 中新增：

- `import { AnalysisPage } from './pages/AnalysisPage';`
- `<Route element={<AnalysisPage />} path="analysis" />`

### 12.2 导航

在 `front/src/components/AppShell.tsx` 主导航中新增：

- `AI 分析`

建议位置：

- 放在 `市场动态` 与 `AI 日报` 之间

原因：

- 语义上它介于原始市场页与原始日报页之上
- 能帮助用户理解这是一个“整合能力页”

## 13. 推荐实现步骤

### 13.1 第一步：补齐前端类型与 API client

涉及文件：

- `front/src/types/api.ts`
- `front/src/api/forum.ts`

完成标准：

- 3 个 analysis 接口可以被前端类型安全调用

### 13.2 第二步：新增页面与路由接入

涉及文件：

- `front/src/pages/AnalysisPage.tsx`
- `front/src/App.tsx`
- `front/src/components/AppShell.tsx`

完成标准：

- 用户能从导航进入 `/analysis`
- 页面初次进入能完成 3 接口并行加载

### 13.3 第三步：落地页面结构与样式

涉及文件：

- `front/src/pages/AnalysisPage.tsx`
- `front/src/styles.css`

完成标准：

- Hero、综合区、AI 区、市场区、错误态、空态完整可见
- Desktop 和 mobile 都不崩

### 13.4 第四步：补齐交互与容错

需要覆盖：

- 窗口切换
- 刷新
- 单模块失败
- 422 提示
- partial 提示

### 13.5 第五步：功能验收

至少完成：

- 路由可访问
- 页面渲染稳定
- analysis 接口切换窗口正确
- 错误提示可见
- 样式在手机宽度下可用

## 14. 验收标准

满足以下条件才算完成：

### 14.1 功能验收

- 用户能从导航进入 `AI 分析` 页
- 页面默认加载 `7d`
- 可以切换到 `1d` 与 `30d`
- 每次切换窗口后，3 个模块都刷新到对应结果
- 页面可展示 `overview`、`ai-trend`、`market-trend`
- `partial`、`confidence`、`risks`、`evidence` 都可见

### 14.2 体验验收

- 首屏优先看到综合结论，而不是一堆原始字段
- 页面不是 JSON dump
- 用户能快速分辨当前是 `aligned / diverging / mixed`
- 用户能快速分辨当前是 `risk-on / risk-off / mixed`

### 14.3 技术验收

- `npm` 对应前端构建通过
- TypeScript 类型检查通过
- 不引入未使用的大型状态管理库
- 不破坏现有 `/market`、`/ai-daily`、`/` 页面

## 15. 测试建议

至少做以下验证：

- 打开 `/analysis`，默认拉取 `7d`
- 切到 `1d`，观察 3 个请求 query 是否正确
- 切到 `30d`，观察 UI 是否更新
- 模拟一个接口 422，确认业务提示正常
- 模拟一个接口 500，确认错误卡正常
- 模拟 `market-trend.partial = true`，确认 partial 标识、note、risks 都显示
- 手机宽度下检查按钮换行、卡片堆叠、文本截断

## 16. 后续扩展位

本次实现完成后，可以自然演进到：

- 首页摘要卡接入 `overview`
- `AI 日报` 页面接入 AI trend 摘要条
- `市场动态` 页面接入 market trend 摘要条
- 分析结果快照缓存
- 图表联动
- 聊天式 agent 外壳

但这些都不属于本次必做范围。

## 17. 本次建议改动文件清单

预期至少会涉及：

- `front/src/pages/AnalysisPage.tsx`
- `front/src/App.tsx`
- `front/src/components/AppShell.tsx`
- `front/src/api/forum.ts`
- `front/src/types/api.ts`
- `front/src/styles.css`

如果后续发现后端接口字段仍有前端接入缺口，再另开补充 spec，不在本文件中隐式扩 scope。
