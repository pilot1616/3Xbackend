# Agent 计划

目标是在 `agent/` 下新增一个独立的 AI Agent 服务，能够：

1. 监听一个端口接收外部 prompt
2. 连接数据库读取数据
3. 调用 LLM 对数据做分析
4. 返回结构化结果

当前第一版先用 LangGraph 组织流程，优先做可运行的最小闭环。

## 1. 范围

- 独立于现有主 API 服务运行
- 先只读数据库，不做写操作
- 先支持单一 HTTP 接口接收 prompt
- 先支持一种数据库连接方式，后续再扩展
- 先支持一种 LLM 提供方，后续留适配层

## 2. 目录规划

预计在 `agent/` 下拆成这些部分：

- `agent/server/`：HTTP 服务入口
- `agent/graph/`：LangGraph 工作流定义
- `agent/tools/db/`：数据库查询封装
- `agent/tools/llm/`：LLM 调用封装
- `agent/types/`：请求和响应结构
- `agent/config/`：端口、数据库、模型配置
- `agent/README.md`：启动和使用说明

## 3. 接口设计

先设计一个简单接口：

- `POST /prompt`

请求示例：

```json
{
  "prompt": "分析过去 7 天订单量变化",
  "context": {},
  "db_scope": "orders"
}
```

返回示例：

```json
{
  "answer": "......",
  "query_summary": "......",
  "sources": [],
  "error": ""
}
```

## 4. LangGraph 流程

第一版流程按下面几个节点实现：

1. `parse_prompt`  
   解析用户输入，识别分析目标和约束。

2. `plan_query`  
   生成数据库查询意图，决定需要查哪些表或字段。

3. `run_db_query`  
   执行只读查询并收集原始数据。

4. `analyze_data`  
   将查询结果交给 LLM，生成分析结论。

5. `format_response`  
   整理成统一输出结构，供外部调用方消费。

后续如果需要，再扩展：

- 查询失败重试
- 多轮澄清
- SQL 校验
- 结果压缩和分页
- 多数据源路由

## 5. 数据库接入

计划先做这些能力：

- 从环境变量读取数据库连接信息
- 建立只读连接池
- 统一封装查询方法
- 限制可访问的表或视图范围

默认假设：

- 数据库以 MySQL 为主
- 查询以读操作为主
- 查询结果尽量保持结构化

## 6. LLM 接入

LLM 适配层需要支持：

- system prompt
- 用户 prompt
- 数据库查询结果注入
- 超时和重试
- 结构化输出

这一层先做成独立封装，避免后面切模型时影响工作流主体。

建议先按 OpenAI 兼容接口接入，当前可用的调用形态如下：

```bash
curl https://ai-api-gateway.app.baizhi.cloud/api/openai/chat/completions \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "model": "dev/gpt-5.5",
  "messages": [
    {
      "role": "system",
      "content": "你是一个企业内部智能助手。"
    },
    {
      "role": "user",
      "content": "请总结今天日志里的失败请求。"
    }
  ],
  "stream": true
}'
```

计划里对应的配置项建议是：

- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`

## 7. 日志与可观测性

建议至少记录：

- 收到的 prompt
- 生成的查询意图
- 执行的查询摘要
- LLM 输入输出摘要
- 错误信息和耗时

这样后面排查问题会比较直接。

## 8. 实施顺序

1. 明确 agent 入口和配置加载方式
2. 搭 HTTP 服务和 `/prompt` 接口
3. 搭数据库只读查询层
4. 搭 LLM 调用层
5. 用 LangGraph 串起完整流程
6. 补最小测试和手工验证
7. 再决定是否接入现有 `Taskfile`、`docker-compose` 或主服务启动流程

## 9. 验收标准

- 服务可单独启动
- 外部可以发 prompt 到监听端口
- Agent 能查到数据库数据
- LLM 能基于查询结果返回分析
- 返回值是稳定结构
- 代码和配置都能清楚定位
