# Proposal: 004-ci-guardrails-and-code-slimming

- **Change ID**: `004-ci-guardrails-and-code-slimming`
- **Status**: `proposed`
- **Depends On**: `003-monorepo-merge-and-release-bridge`

## 1. Why（为什么做）

此前工作区已经盘点出详细的瘦身方案（[Core与Runtime精简重构指南](../001-resources-openspec-foundation/proposal.md) 关联文档及四仓冗余盘点：非 vendor 源码累计 33.3 万行，冗余超 60%），但**如果没有机器强制执行的 CI 防退化护栏，辛辛苦苦瘦身砍掉的上十万行冗余代码会在几周内重新长回来**（正如 Magpie `LESSONS.md` 中指出的“文件体积与依赖边界只能靠自动化门禁守住”）。

本 Change 先用 CI 脚本把四端架构红线焊死，随后按护栏保护逐步完成 Core、Runtime、CLI、Client2 的全量瘦身。

## 2. Goals（目标）

1. 将核心架构红线转化为阻断级 CI 护栏：禁用依赖扫描、跨 `apps/*` 引用检测、新改代码单文件 ≤ 600 行上限、OpenAPI 路由一致性校验、每仓标准 4 类 Workflow 收口。
2. 落地 **`respire-core` 瘦身**：物理删除 `cfg(test)` 旧引擎/本地 SQLite/加密副本与 `crates/winml-catalog`（约 2,511 行），单源化 ABI 清单，将 `deepen_plan` 从 O(N²) 优化为 O(N)。
3. 落地 **`apps/runtime` 瘦身**：解体 4,000–6,300 行三大上帝文件（`engine.rs`、`rpc_serve.rs`、`service.rs`），合并双应用层 `app` + `app-domain`，消除 4 连 SHA-256 与非阻塞热切换写锁，退役 Legacy M3 双轨锁死，砍掉 `prompt.rs`/`inject.rs`。
4. 落地 **`apps/cli` 与 `apps/client2` 瘦身**：彻底移除停服+`Paused` 模型下载/卸载门禁、Client2 必败 NPU 编排、643 行停服卸载、`go-sqlite3` WASM 依赖、1.1 万行平行 Go 状态机、60 秒 `tree-cure` 后台扫描，合并前端 `wizard.js` 与 `models.js` 状态流。

## 3. Non-Goals（明确不做）

- 瘦身过程中 **100% 保留既有核心业务能力**（多模型自由切换、多空间分享、全量导入导出、记忆/日记/树整理/同步、TUI、`rsrs mcp`、本机 IDE 注入），禁止借精简名义删减用户功能。

## 4. Acceptance Criteria（验收标准）

1. 所有架构护栏检查脚本接入 `verify.yml` 并全部通过。
2. 瘦身完成后的 `apps/runtime`、`apps/cli`、`apps/client2` 及 `respire-core` 在护栏内运行稳定，总冗余代码削减达到预期目标（60%+）且不再存在 600 行以上新改巨型文件。
3. 全部原有业务回归测试与 `005` E2E 测试集通过。
