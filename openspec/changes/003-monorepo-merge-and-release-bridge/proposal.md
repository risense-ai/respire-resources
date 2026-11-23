# Proposal: 003-monorepo-merge-and-release-bridge

- **Change ID**: `003-monorepo-merge-and-release-bridge`
- **Status**: `proposed`
- **Depends On**: `001-resources-openspec-foundation`, `002-runtime-openapi-v1-migration`

## 1. Why（为什么做）

此前把开源端拆成 `respire-runtime`、`respire-cli`、`respire-client2` 三个仓库，虽然初衷是独立构建，但缺少强契约反而造成了 674 个重复契约夹具、5.4 万行遗留服务端代码滞留 CLI、以及 23 个难以维护的 CLI workflow。

合并进统一公开 Monorepo **`risense-ai/respire`** 后，必须同时解决两个核心工程问题：
1. **合仓不拖累 CI**：改 Client2 绝不能触发 Runtime 和 CLI 的 Rust 编译，三端构建清单必须物理隔离；
2. **老用户升级零断更**：现存线上版本仍在通过 **NPM** 与老仓库 Release（`runtime-build-<triple>.json`、`model-bge-m3-ort-v1`、`client-updates.json`）拉取更新，合仓后必须由新仓 CI 自动把 Release 镜像同步至三个冻结的老仓库。

> **状态更新（2026-11-24）**：Maintainer 已将历史私有归档仓重命名为 `risense-ai/respire-back`；新的公开 Monorepo `risense-ai/respire` 骨架（独立目录、路径路由 CI 框架、`check-guardrails`、同步契约锁）已完成创建并推上 GitHub（`T03-01` 已完成）。

## 2. Goals（目标）

1. 将 `respire-runtime`、`respire-cli`、`respire-client2` 保留 Git 提交历史合入 `risense-ai/respire`（分别落于 `apps/runtime/`、`apps/cli/`、`apps/client2/`），在导入前用 `git filter-repo` 剥离 CLI 的 5.4 万行僵尸服务端与 23 个历史废旧 workflow。
2. 保持**构建清单物理隔离**与 **Path-Filtered CI + `ci-gate` 聚合门禁**，做到“改谁只跑谁、其余端 0 秒跳过”。
3. 实现 **组件独立 SemVer Tag 发版 + 老仓/NPM 自动镜像分发（Release Fan-Out）**，保持新老更新通道双轨兼容。

## 3. Non-Goals（明确不做）

- 不把闭源 `respire-core` 或本仓 `respire-resources` 并入 `risense-ai/respire`。
- 不删除老仓库既有 Release 或静态资产 Tag（尤其必须永久保留 `respire-cli` 下的 `model-bge-m3-ort-v1`）。

## 4. Acceptance Criteria（验收标准）

1. 三仓历史代码成功导入 `risense-ai/respire` 并各自在 `apps/*` 独立编译测试通过。
2. 分别提交仅改单一 `apps/*` 的测试 PR，验证另外两端 CI 处于 `skipped` 且 `ci-gate` 变绿。
3. 推送 `runtime-v*` / `cli-v*` / `client2-v*` 测试 Tag，验证仅对应组件构建且能正确镜像至对应老仓库与 NPM。
