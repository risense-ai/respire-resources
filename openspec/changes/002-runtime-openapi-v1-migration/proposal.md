# Proposal: 002-runtime-openapi-v1-migration

- **Change ID**: `002-runtime-openapi-v1-migration`
- **Status**: `proposed`
- **Depends On**: `001-resources-openspec-foundation`

## 1. Why（为什么做）

当前 `respire-runtime` 对外暴露的还是十余个非标准 JSON-RPC 方法（如 `assets.status`、`cli.exec`、`model.catalog`、`model.switch`、`runtime.status` 等），既没有机器可读的 OpenAPI Schema，又缺乏标准异步事件推送通道：

1. 客户端与插件缺乏强类型 SDK，不得不在 `respire-cli` 和 `respire-client2` 中各自手写 DTO 与 `cli.exec` 参数拼接表，导致接口一改多端散弹式报错；
2. 缺乏异步长任务流，逼得 `respire-client2` 每 700ms 全量轮询 `/api/state` 和高频请求 `/api/health`；
3. 大量外部插件依赖拼装 CLI 命令行参数调用业务功能，在 Windows 上频发命令行长度上限、引号转义与编码故障。

同时，线上已存在大量旧版本 CLI、Client2 和插件，OpenAPI 3.1 改造必须**保持向后兼容过渡**，绝不允许一刀切破坏老客户端。

## 2. Goals（目标）

1. 将 `contracts/runtime-api/openapi.yaml`（OpenAPI 3.1 + SSE）确立为 `respire-runtime` 与一切客户端（CLI、Client2、MCP、插件）的**唯一接口契约**。
2. 覆盖全部核心业务域：`health`（含 `capabilities`）、`memories`、`diary`、`organize`、`models`（目录/活跃资产/热切换/托管下载）、`operations`（`202` 异步任务 + SSE 事件流 + 取消）、`spaces`、`accounts`/`host` 事务与 `sync`。
3. 统一使用 **RFC 9457 `ProblemDetails`** 结构作为全部非 2xx HTTP 错误响应格式。
4. 建立自动化代码生成链（产出于 Monorepo 的 `packages/runtime-sdk-rs`、`runtime-sdk-go`、`runtime-sdk-ts`）与 `oasdiff` 破坏性变更 CI 门禁。
5. 实现 Runtime 内“单领域核 + 双协议入口（REST/SSE 主入口 + `<200` 行冻结态旧 JSON-RPC 兼容层）”，保证老版本平滑过渡。
6. 彻底引导插件从 Windows CLI 参数传参迁移至本地 HTTP OpenAPI 或 `rsrs mcp` stdio。

## 3. Non-Goals（明确不做）

- 不改造 `respire-core` 与 `respire-runtime` 之间的 C ABI（仍由 `contracts/core-abi/` 独立契约管理）。
- 本阶段不立刻删除旧 JSON-RPC / `cli.exec` 兼容接口；退场仅在确认老客户端过渡期结束、经独立审批后触发。

## 4. Acceptance Criteria（验收标准）

1. `contracts/runtime-api/openapi.yaml` 覆盖所有 V1 核心端点并通过 OpenAPI 3.1 校验。
2. `oasdiff` 破坏性检查接入 CI，任何未经批准破坏 `/v1/*` 兼容性的改动自动失败。
3. Runtime 新旧两条路径（`/v1/*` 与旧 JSON-RPC）共用同一领域服务层，已有旧版 CLI/Client2 回归用例 100% 通过。
4. 插件与 MCP 调用长文本/超长 JSON 载荷在 Windows 下走 HTTP/stdio 实测通过，彻底消除命令行截断限制。
