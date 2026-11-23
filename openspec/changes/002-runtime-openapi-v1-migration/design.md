# Design: 002-runtime-openapi-v1-migration

## 1. Runtime“单核双口”过渡架构

为避免维护两套业务逻辑，Runtime 内部必须将 **HTTP/RPC 传输解包** 与 **领域服务逻辑** 严格分离：

```text
OpenAPI 3.1 REST (/v1/*) + SSE ──┐
                                  ├──▶ 唯一领域服务层 (Domain Services) ──▶ Core ABI
冻结态旧 JSON-RPC (<200行适配) ──┘
```

- **新接口（主路径）**：所有新能力（例如托管模型下载进度流、账户/空间事务 RPC、类型化记忆与树整理接口）**只加在 `/v1/*` OpenAPI 路由上**。
- **旧接口（冻结兼容层）**：保留现有 `/rpc`（含 `runtime.status`、`model.switch`、`cli.exec` 等），内部仅做参数映射并直接转发给同一个领域服务层函数，**严禁在兼容层内再加新功能或分叉业务状态**。

## 2. OpenAPI 3.1 核心设计规范

1. **资源化端点分组**：
   - `GET /v1/health`：返回运行态、实例 ID 与 `capabilities: string[]`（包含 `openapi.v1`、`sse.operations.v1`、`model.catalog.v2`、`model.active_assets`、`model.managed_download`、`host.transactions.v1`）。
   - `memories` / `diary` / `organize`：`/v1/memories`、`/v1/memories/recall`、`/v1/diary`、`/v1/organize/deepen` 等，长文本和复杂过滤统一放 JSON Body，脱离命令行长度限制。
   - `models`：`/v1/models/catalog`、`/v1/models/active-assets`、`/v1/models/switch`、`/v1/models/downloads`。
   - `operations` + **SSE**：任何耗时操作（下载、建索引、热切换、导入导出、同步）返回 `202 Accepted` 及 `operation_id`，客户端订阅 `GET /v1/operations/{id}/events`（`text/event-stream`，事件类型 `progress` / `completed` / `failed` / `cancelled`），取消统一调用 `DELETE /v1/operations/{id}`。
   - `host/transactions` & `spaces`：把原先散落在 Client2 Go 代码和 CLI `offline_keygen` 中的多步账户/登录/恢复/空间状态机收归 Runtime 原子接口。
2. **统一错误体（RFC 9457 ProblemDetails）**：所有 `4xx`/`5xx` 返回 `{ type, title, status, detail, code, instance, retryable }`，客户端透传展示不再吞错。

## 3. 能力位协商与三端无缝过渡策略

- **零版本字符串判断**：客户端启动后先探测 `GET /v1/health`（404 时回落旧 `runtime.status`），依据 `capabilities` 集合动态切换：
  - 若存在 `openapi.v1` + `sse.operations.v1`：全部走自动生成的 OpenAPI SDK + SSE；
  - 若面对未升级的老 Runtime：简单只读查询与基础写入走薄兼容垫片；若用户触发只有新版本才具备的重事务（如 `host.transactions.v1`），直接提示升级 Runtime，拒绝在客户端恢复第二套状态机。

## 4. 代码生成与路由防漂移机制

- **唯一输入**：`respire-resources/contracts/runtime-api/openapi.yaml`。
- **生成目标**（落入 `respire` Monorepo 的 `packages/`）：
  - `packages/runtime-sdk-rs`（供 `apps/cli` 与服务端 DTO 校验）；
  - `packages/runtime-sdk-go`（供 `apps/client2` 调用）；
  - `packages/runtime-sdk-ts`（供前端页面、插件生态及 Playwright 测试使用）。
- **防漂移门禁**：CI 比对代码生成的校验和 + 在 Runtime 单测内自动校验“已注册 HTTP 路由集合 === OpenAPI `paths` 集合”。

## 5. 插件迁移与兼容策略（消除 Windows 命令行痛点）

- `apps/runtime` 在本机启动后，向约定的运行态发现文件写入 `{ base_url, pid, auth_token_ref, capabilities }`。
- **插件推荐路径**：直接调用本地 OpenAPI HTTP（或通过 `rsrs mcp` stdio 桥）。
- **老插件过渡**：保留 `rsrs` CLI 的已有命令签名，但内部实现切换为调用 OpenAPI SDK；同时在文档与警告日志中标注命令行大载荷传参已废弃，避免新插件再踩 Windows `CreateProcess` 长度限制坑。

## 6. Risks & Rollback

- **风险**：Rust 与 Go 不同生成器的 `oneOf`/nullable 处理细节差异。
- **缓解**：在 `openapi.yaml` 规范中限制仅使用生成器友好子集（显式 tagged union、避免复杂匿名内联结构），并用跨语言黄金 JSON 测试验证序列化一致。
- **回滚**：新接口全部位于独立前缀 `/v1/*`，过渡期内旧 RPC 路径完整保留；如某条新路由发现缺陷，客户端可通过能力位开关迅速降级。
