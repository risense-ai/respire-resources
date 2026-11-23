# Tasks: 002-runtime-openapi-v1-migration

## 阶段一：OpenAPI 3.1 全量契约与生成链定型

- [ ] **T02-01** 将 `contracts/runtime-api/openapi.yaml` 从基线骨架补全至覆盖全部业务域（`health`、`memories`、`diary`、`organize`、`models`、`operations`+SSE、`spaces`、`accounts`/`host`、`sync`）
- [ ] **T02-02** 制定 OpenAPI 子集规范（标签化联合体、RFC 9457 `ProblemDetails` 错误码全表、SSE 事件 Schema）与黄金 JSON 夹具
- [ ] **T02-03** 搭建 Rust / Go / TypeScript SDK 自动生成脚本并验证三端序列化往返一致
- [ ] **T02-04** 在 CI 接入 OpenAPI Schema 校验与 `oasdiff` 破坏性变更检查

## 阶段二：Runtime 服务端落地（单核双口）

- [ ] **T02-05** 在 Runtime 实现独立领域服务抽象，打通 `/v1/health`（含 `capabilities`）与统一错误处理中间件
- [ ] **T02-06** 实现异步 `operations` 管理器与 `GET /v1/operations/{id}/events` SSE 推送及 `DELETE` 取消
- [ ] **T02-07** 落地 `/v1/memories`、`/v1/diary`、`/v1/organize`、`/v1/models/*`、`/v1/spaces`、`/v1/host/transactions/*` 等全量 `/v1/*` 处理器
- [ ] **T02-08** 将现有 JSON-RPC / `cli.exec` 收口为 `<200` 行的冻结态兼容适配器，复用同一个领域服务层
- [ ] **T02-09** 补充 Runtime 路由一致性守护测试（核对注册路由与 `openapi.yaml` 100% 匹配）及旧协议回归测试

## 阶段三：客户端与插件消费切换

- [ ] **T02-10** `cli` 切换至 `packages/runtime-sdk-rs` + `capabilities` 协商（移除重复 `net_rpc.rs` 与手写 DTO）
- [ ] **T02-11** `client2` 切换至 `packages/runtime-sdk-go` + SSE 进度订阅（淘汰 700ms 全量轮询与 `cli.exec` 参数表）
- [ ] **T02-12** 更新 `rsrs mcp` 与插件开发指南，提供基于 OpenAPI / TypeScript SDK 的插件调用示例与 Windows 超长载荷回归验证
- [ ] **T02-13** 验收归档：全部测试通过后将 `specs/runtime-api/spec.md` 归档至 `openspec/specs/`
