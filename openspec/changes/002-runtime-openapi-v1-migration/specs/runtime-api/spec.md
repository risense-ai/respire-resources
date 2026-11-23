# Delta Spec: Runtime OpenAPI 3.1 & Transition Contract (`002`)

## ADDED Requirements

### Requirement: OpenAPI 3.1 作为 Runtime 唯一外部契约
`respire-resources/contracts/runtime-api/openapi.yaml` MUST 作为 `respire-runtime` HTTP REST + SSE 接口的唯一机器可读事实源；客户端（CLI、Client2、MCP、插件）消费的强类型 SDK MUST 由该契约自动生成，禁止在各端手写重复 DTO。

#### Scenario: 新增或变更 Runtime 接口
- **GIVEN** 某项需求需要为 Runtime 增加新的业务参数或状态字段
- **WHEN** 开发者提交变更 PR
- **THEN** PR MUST 先更新 `openapi.yaml` 与重新生成的 SDK 并通过 `oasdiff` 兼容性校验，否则 CI MUST 阻断合并

### Requirement: 异步任务与 SSE 事件流取代高频全量轮询
模型下载、索引重建、模型热切换及全量同步等长耗时操作 MUST 返回 `202 Accepted` 与 `operation_id`，并通过 `GET /v1/operations/{id}/events`（`text/event-stream`）推送进度及终态；取消操作 MUST 通过 `DELETE /v1/operations/{id}` 触发。

#### Scenario: 桌面端订阅模型切换进度
- **GIVEN** Client2 发起模型切换请求并收到 `202 Accepted` 与 `operation_id`
- **WHEN** Client2 建立 SSE 连接到 `/v1/operations/{id}/events`
- **THEN** Runtime SHALL 按节流策略推送 `progress` 事件并在结束时发送 `completed` 或 `failed`（附 RFC 9457 `ProblemDetails`），前端无需再高频轮询全量 `/api/state`

### Requirement: 能力位协商与旧版本向后兼容过渡
Runtime MUST 在 `/v1/health` 与兼容端点声明 `capabilities` 集合，新客户端 MUST 仅依据 `capabilities` 决定启用 OpenAPI/SSE 或降级，严禁解析对比 Runtime 版本号；过渡期内旧 JSON-RPC 入口 SHALL 保持可用并与 `/v1/*` 共享同一领域服务层。

#### Scenario: 新版本客户端连接旧版本 Runtime
- **GIVEN** 新版 CLI 或 Client2 连接到尚未宣告 `openapi.v1` 能力位的老版 Runtime
- **WHEN** 客户端探测健康检查端点
- **THEN** 客户端 MUST 不抛出协议崩溃错误，对基础只读/写入走兼容降级路径，对老端不具备的重事务能力给出明确的 Runtime 升级提示

### Requirement: 插件脱离 Windows 命令行参数约束
外部插件与本地工具集成 MUST 优先通过本地 HTTP OpenAPI 3.1 或 `rsrs mcp` stdio 桥接发送 JSON 请求体，不再依赖拼接长命令行参数传递业务正文。

#### Scenario: Windows 下插件写入超长 UTF-8 记忆内容
- **GIVEN** 运行在 Windows 上的插件需要向 Runtime 提交 64 KB 以上的 UTF-8 文本与嵌套元数据
- **WHEN** 插件通过 `POST /v1/memories` 或 MCP 工具调用提交请求
- **THEN** Runtime SHALL 完整接收并持久化原始 UTF-8 内容，不发生命令行长度截断或引号转义损坏
