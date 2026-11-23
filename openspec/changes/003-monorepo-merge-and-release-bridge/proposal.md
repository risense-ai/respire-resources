# Proposal: 003-monorepo-merge-and-release-bridge

- **Change ID**: `003-monorepo-merge-and-release-bridge`
- **Status**: `proposed`
- **Depends On**: `001-resources-openspec-foundation`, `002-runtime-openapi-v1-migration`

## 1. Why（为什么做）

过去拆成 `respire-runtime`、`respire-cli`、`respire-client2` 三个开源仓后，不仅需要跨仓协调契约，还催生了大量重复代码、674 个重复契约夹具与 23 个 CLI 历史 workflow。但把它们重新合入 Monorepo 时，绝不能退化成“改一行 Client2 就要把 Runtime 和 CLI 的 Rust 编译测试全跑一遍”。

此外，现存发布版本仍通过 **NPM** 以及老仓库（`risense-ai/respire-runtime`、`risense-ai/respire-cli`、`risense-ai/respire-client2`）拉取二进制与 `runtime-build-<triple>.json`、`model-bge-m3-ort-v1` 等静态资产，合并后必须保证老用户升级通道与 NPM 发版**零断更**。

> **前置发现（需 Maintainer 拍板）**：GitHub 上 `risense-ai/respire` 当前已存在，为 2026-10-01 归档的私有历史快照仓库。实施本 Change 前，需先将该旧仓重命名为 `risense-ai/respire-legacy-202610`（或为新公开 Monorepo 另选仓库名）。

## 2. Goals（目标）

1. 将 `respire-runtime`、`respire-cli`、`respire-client2` 保留 Git 提交历史合入统一开源 Monorepo（`risense-ai/respire`），并在导入阶段顺手剥离 `respire-cli` 滞留的 5.4 万行僵尸服务端 crate 与 23 个冗余历史 workflow。
2. 实现**物理构建清单完全隔离**：`apps/runtime`、`apps/cli`、`apps/client2` 各自保留独立的 `Cargo.toml`/`Cargo.lock` 或 `go.mod`/`go.sum`，严禁共享单一顶层 Cargo Workspace。
3. 建立 **Path-Filtered CI + `ci-gate` 聚合门禁**：只改某一端时，只运行该端构建与单测，其余端 0 秒跳过且不卡分支保护。
4. 建立 **组件独立 Tag 发版 + 老仓/NPM 自动镜像分发（Release Fan-Out）**：支持 `runtime-vX.Y.Z`、`cli-vX.Y.Z`、`client2-vX.Y.Z` 独立发布，并自动同步镜像 Release 至老仓库与 NPM。

## 3. Non-Goals（明确不做）

- 不把闭源的 `respire-core` 或 `respire-resources` 并入开源 Monorepo。
- 不在本阶段直接删除老仓库或停用旧 Release Tag（特别是 `model-bge-m3-ort-v1`）。

## 4. Acceptance Criteria（验收标准）

1. 仅修改 `apps/client2/` 提交 PR 时，CI 中 `runtime-ci` 与 `cli-ci` 处于 `skipped` 且 `ci-gate` 变绿允许合并。
2. 打 `client2-vX.Y.Z`（或 `cli-vX.Y.Z` / `runtime-vX.Y.Z`）Tag 时，仅对应组件流水线运行，并成功同步创建新仓 Release、NPM 包（CLI）与老仓对应 `vX.Y.Z` 镜像 Release。
3. 老版本 `rsrs` 与 `client2` 从老仓库或 NPM 执行自更新检查，均可正常拉取新版并校验通过。
