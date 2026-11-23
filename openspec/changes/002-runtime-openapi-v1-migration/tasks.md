# Tasks: 002-runtime-openapi-v1-migration

## 阶段一：OpenAPI 3.1 契约校验与 SDK 代码生成链（在 `respire-resources` 与 `respire` 执行）

- [ ] **T02-01** 补充 `contracts/runtime-api/openapi.yaml` 中缺失的细节字段（如备份导入导出、模型下载镜像回退错误码枚举与认证头 `Bearer` 安全方案）并用 Redocly / Spectral 校验语法通过
- [ ] **T02-02** 创建 `contracts/runtime-api/fixtures/` 黄金 JSON 夹具，覆盖 `ProblemDetails`、SSE `OperationEvent`、`MemoryItem` 与 `ModelCatalogResponse`
- [ ] **T02-03** 在 `respire` 编写 `scripts/sync-contracts.mjs` 与 `scripts/gen-sdks.sh`（或 `.mjs`），生成 `packages/runtime-sdk-rs`、`packages/runtime-sdk-go`、`packages/runtime-sdk-ts` 并跑通三语言黄金 JSON 序列化往返单测
- [ ] **T02-04** 在 `respire-resources` 与 `respire` 的 CI 接入 `oasdiff breaking` 检查与 `sync.lock.json` 校验和检查

## 阶段二：Runtime 服务端落地（需在 `003` 将代码合入 `respire/apps/runtime` 后或并行在隔离分支完成）

- [ ] **T02-05** 在 Runtime 实现独立领域服务接口，落地 `GET /v1/health`（含 `capabilities`）、`GET /v1/status/light` 与 RFC 9457 `ProblemDetails` 错误中间件
- [ ] **T02-06** 实现统一异步 `operations` 调度器、`GET /v1/operations/{id}`、`DELETE /v1/operations/{id}` 与 `GET /v1/operations/{id}/events`（SSE 流）
- [ ] **T02-07** 落地 `/v1/memories*`、`/v1/diary`、`/v1/organize/*`、`/v1/models/*`、`/v1/spaces*`、`/v1/sync/*`、`/v1/host/*` 全量处理器
- [ ] **T02-08** 将现有 `rpc_serve.rs` 存量 JSON-RPC 与 `cli.exec` 收口为 `<200` 行的冻结态兼容适配器，复用同一个领域服务层
- [ ] **T02-09** 补充 Runtime 路由一致性单测（核对 Router === `openapi.yaml` `paths`）与旧版 JSON-RPC 回归测试

## 阶段三：客户端与插件消费切换

- [ ] **T02-10** `apps/cli` 切换至 `packages/runtime-sdk-rs` + `capabilities` 协商（清理手写 DTO 与 `net_rpc.rs`）
- [ ] **T02-11** `apps/client2` 切换至 `packages/runtime-sdk-go` + SSE 进度订阅（淘汰 700ms `/api/state` 全量轮询与 `cli.exec` 参数拼接表）
- [ ] **T02-12** 更新 `rsrs mcp` 与插件示例，落地 Windows 下 100 KB+ UTF-8 JSON 经 HTTP/MCP 写入召回的实测用例
- [ ] **T02-13** 验收归档：全部回归通过后由 Scribe 将 `specs/runtime-api/spec.md` 合并至 `openspec/specs/runtime-api/spec.md`

## 验收命令

```sh
oasdiff breaking origin/main:contracts/runtime-api/openapi.yaml contracts/runtime-api/openapi.yaml
node process/scripts/validate-openspec.mjs
```
