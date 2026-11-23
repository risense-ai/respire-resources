# Design: 002-runtime-openapi-v1-migration

## 1. Runtime“单核双口”过渡架构

为避免维护两套业务逻辑，Runtime 内部必须将 **HTTP/RPC 传输解包** 与 **领域服务逻辑** 严格分离：

```text
OpenAPI 3.1 REST (/v1/*) + SSE ──┐
                                  ├──▶ 唯一领域服务层 (Domain Services) ──▶ Core ABI
冻结态旧 JSON-RPC (<200行适配) ──┘
```

- **新接口（主路径）**：所有新能力只加在 `contracts/runtime-api/openapi.yaml` 定义的 `/v1/*` 路由上。
- **旧接口（冻结兼容层）**：保留现有 `/rpc`（见下表），内部仅做参数映射并直接转发给同一个领域服务层函数，**严禁在兼容层内再加新功能或分叉状态**。

## 2. 存量 JSON-RPC → OpenAPI 3.1 完整映射表

盘点自 `respire-runtime/crates/commands/src/rpc_serve.rs` 的实际方法清单：

| 存量 RPC 方法 | OpenAPI 3.1 对应端点 | 过渡策略 |
| --- | --- | --- |
| `runtime.status` / `runtime.result` | `GET /v1/health`, `GET /v1/status/light` | 兼容期保留 `/rpc` 转发；`/v1/health` 声明 `capabilities` |
| `assets.status` / `model.catalog` | `GET /v1/models/catalog`, `GET /v1/models/active-assets` | 返回引擎 `available` 矩阵与活跃路径锁状态 |
| `model.configure` / `model.prepare` / `model.switch` / `model.resume` | `POST /v1/models/switch`, `POST /v1/models/downloads` | 统一返回 `202 Accepted` + `operation_id` |
| `model.progress` / `cli.progress` / `index.prepare` | `GET /v1/operations/{id}`, `GET /v1/operations/{id}/events` (SSE) | SSE 推送进度，保留旧轮询兼容至老端退场 |
| `runtime.stop` | 守护进程退出控制（仅升级/退出时调用） | 下载与改配置严禁触发停服 |
| `cli.exec`（记忆/日记/整理/空间/同步/账号） | `/v1/memories*`, `/v1/diary`, `/v1/organize/*`, `/v1/spaces*`, `/v1/sync/*`, `/v1/host/*` | 旧 `cli.exec` 收敛为 `<200` 行薄转发垫片，禁再扩参数 |

- **测试专有方法**（`runtime.test_native_fault` / `test_worker_hold` / `test_worker_lifecycle`）仅保留在 `#[cfg(test)]` 或测试特性开关内，不暴露进公开 OpenAPI 契约。

## 3. 统一错误体与能力位协商

- **RFC 9457 ProblemDetails**：所有非 2xx 错误统一返回 `{ type, title, status, detail, code, instance, retryable }`（Content-Type: `application/problem+json`）。
- **零版本号判断**：客户端探测 `GET /v1/health`（404 时回落旧 `runtime.status`），仅依据 `capabilities` 集合（`openapi.v1`、`sse.operations.v1`、`model.catalog.v2`、`model.active_assets`、`model.managed_download`、`host.transactions.v1`）决策走新 SDK 还是兼容路径。

## 4. 代码生成工具链与破坏性门禁

| 目标产物路径（位于 `respire` Monorepo） | 推荐生成工具链 | 用途与消费者 |
| --- | --- | --- |
| `packages/runtime-sdk-rs/` | `progenitor` 或 `openapi-generator` (`rust`) + `utoipa` DTO 校验 | `apps/cli` 与 `apps/runtime` 契约模型对照 |
| `packages/runtime-sdk-go/` | `oapi-codegen`（`-package runtimesdk`） | `apps/client2` 唯一后端调用入口 |
| `packages/runtime-sdk-ts/` | `openapi-typescript` + `openapi-fetch` | 前端页面、插件生态及 Playwright E2E |

- **CI 破坏性检查命令**：每次修改 `contracts/runtime-api/openapi.yaml` 必须执行：
  `oasdiff breaking origin/main:contracts/runtime-api/openapi.yaml contracts/runtime-api/openapi.yaml`
- **服务端路由一致性**：`apps/runtime` 单元测试加载同一份 `openapi.yaml`，断言已注册 Router 路径与 `paths` 键集合完全一致。

## 5. 插件脱离 Windows 命令行限制策略

- Runtime 启动后向约定运行态发现文件写入 `{ base_url, pid, auth_token_ref, capabilities }`。
- 插件直接用 `packages/runtime-sdk-ts`（或标准 HTTP）调 `POST /v1/memories` 等 REST 接口，或走 `rsrs mcp` stdio 桥接；保留 `rsrs` CLI 命令签名但内部全部切换调用 OpenAPI SDK，彻底消除 Windows `CreateProcess` 32KB 参数限制与引号转义问题。

## 6. Risks & Rollback

- **风险**：不同语言生成器对 OpenAPI 3.1 nullable（`type: [string, "null"]`）或 `oneOf` 兼容存在差异。
- **缓解**：限制 `openapi.yaml` 仅使用生成器验证通过的类型子集，并用跨语言黄金 JSON 往返测试在 `T02-02`/`T02-03` 阶段先跑通。
- **回滚**：`/v1/*` 与 `/rpc` 完全并行隔离，任何新路由异常均可通过能力位关闭快速切回兼容路径。
