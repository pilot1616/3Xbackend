# 多 Agent 协作配置

本项目已经补了一份项目级多 agent 协作配置文件：

- 配置文件：[.claude/multi-agent.yaml](/Users/zhangxinghui/Desktop/web/3Xbackend/.claude/multi-agent.yaml)

## 角色

当前定义了 6 个固定角色：

1. `code_reading`
   负责建立上下文，输出关键文件、当前行为、改动切入点和风险。

2. `plan_generation`
   负责把阅读结果拆成可执行步骤，并标记并行项与阻塞项。

3. `plan_decision`
   负责在多个方案中做取舍，控制复杂度、风险和提交切分。

4. `code_writing`
   负责按既定方案修改代码，只改自己负责的文件范围，并执行最小必要验证。

5. `code_review`
   负责审查回归、边界条件、接口契约、数据一致性和遗漏验证。

6. `feature_check`
   负责从最终功能视角做构建、类型检查、路径验证和发布前判断。

## 默认流程

常规功能开发：

1. `code_reading`
2. `plan_generation`
3. `plan_decision`
4. `code_writing`
5. `code_review`
6. `feature_check`

快速修 bug：

1. `code_reading`
2. `plan_decision`
3. `code_writing`
4. `feature_check`

后端接口变更：

1. `code_reading`
2. `plan_generation`
3. `plan_decision`
4. `code_writing`
5. `code_review`
6. `feature_check`

额外要求：

- 只要后端接口行为、参数、字段、状态码变化，就必须检查并更新 [API.md](/Users/zhangxinghui/Desktop/web/3Xbackend/API.md)
- 每完成一个明确功能点后单独提交
- `code_review` 优先报告问题，不负责替代实现

## 交接格式

每个角色交接时至少要包含：

- `goal`
- `inputs`
- `assumptions`
- `touched_files`
- `risks`
- `next_action`

## 并行规则

- 阅读阶段可以按前端、后端、文档并行。
- 编写阶段只有在文件责任边界清晰时才允许并行。
- 多个编写角色禁止同时修改同一文件。
- 审查和功能检查可以并行，但审查结论优先级更高。

## 推荐映射

- 前端阅读：`front/src/pages`、`front/src/components`、`front/src/styles.css`
- 后端阅读：`internal/handler`、`internal/service`、`internal/server`
- 前端编写：`front/src/**`
- 后端编写：`internal/**`、`cmd/**`
- 审批：仅审查改动文件
- 检查：构建、类型检查、必要测试、手工主路径验证
