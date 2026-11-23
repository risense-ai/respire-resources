# Tasks: 003-monorepo-merge-and-release-bridge

## 阶段一：仓库初始化与带过滤历史合仓

- [x] **T03-01** 将历史归档仓改名为 `risense-ai/respire-back`，新建公开 Monorepo `risense-ai/respire` 并推送骨架（含路径路由 `ci.yml` 与 `scripts/check-guardrails.mjs`）
- [ ] **T03-02** 在 GitHub 设置冻结三个老代码仓库（`respire-runtime`、`respire-cli`、`respire-client2`）的 `main` 写入保护并在各自 README 顶部贴出迁移至 `risense-ai/respire` 的公告（严禁删除历史 Release 及 `model-bge-m3-ort-v1`）
- [ ] **T03-03** 在临时隔离目录执行 `git filter-repo`，将三仓分别重写至 `apps/runtime/`、`apps/cli/`、`apps/client2/`，并过滤剔除 CLI 的 5.4 万行遗留服务端 crate、重复 `contracts/` 与 23 个历史 workflow
- [ ] **T03-04** 分三个可审查 PR 将过滤后的历史合入 `risense-ai/respire` `main`，调整各端构建路径使 `apps/runtime`、`apps/cli`、`apps/client2` 各自独立编译与单测通过

## 阶段二：路径隔离 CI 与老仓库/NPM Release 镜像分发

- [ ] **T03-05** 补全 `respire/.github/workflows/ci.yml` 中 `runtime-ci`、`cli-ci`、`client2-ci` 的真实构建测试命令，并保留 `ci-gate` 为唯一分支保护必检项
- [ ] **T03-06** 实测验证三端独立性：分别提交只改单一 `apps/*` 的测试 PR，留存另外两端 `skipped` 且 `ci-gate` 变绿的 Run URL 证据
- [ ] **T03-07** 配置最小权限 GitHub App / 受保护 `release` Environment，实现 `release.yml` 按 `runtime-v*`、`cli-v*`、`client2-v*` 前缀 Tag 独立构建
- [ ] **T03-08** 在 `release.yml` 落地老仓库镜像 Fan-Out（含 `runtime-build-<triple>.json`、`SHA256SUMS`、`client-updates.json`）与 NPM `@rsrsai/*` 发布步骤
- [ ] **T03-09** 升级 `apps/cli`（`runtime_fetch.rs`）与 `apps/client2`（`releases.go`）更新器为“优先读 `risense-ai/respire` 前缀 Tag，失败回落老仓库”
- [ ] **T03-10** 验收归档：完成一次灰度发版与自更新演练后，由 Scribe 将 `specs/monorepo-ci-release/spec.md` 合并至 `openspec/specs/`

## 验收命令

```sh
node scripts/check-guardrails.mjs
cargo check --manifest-path apps/runtime/Cargo.toml --locked
cargo check --manifest-path apps/cli/Cargo.toml --locked
go test ./apps/client2/...
```
