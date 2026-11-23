# Tasks: 003-monorepo-merge-and-release-bridge

## 阶段一：仓库准备与带过滤历史合仓

- [ ] **T03-01** Maintainer 处置旧归档仓 `risense-ai/respire`（重命名为 `risense-ai/respire-legacy-202610`），创建公开仓库 `risense-ai/respire`
- [ ] **T03-02** 冻结 `respire-runtime`、`respire-cli`、`respire-client2` 日常开发合入，在 README 贴出迁移公告（保留历史 Release 与 `model-bge-m3-ort-v1` 资产）
- [ ] **T03-03** 使用 `git filter-repo` 重写三仓目录前缀至 `apps/runtime/`、`apps/cli/`、`apps/client2/` 并清理 CLI 遗留服务端 crate、重复 `contracts/` 与历史废旧脚本
- [ ] **T03-04** 合入 `risense-ai/respire` `main`，同步落盘 `contracts/` 与生成好的 `packages/runtime-sdk-{rs,go,ts}`，验证三端在独立构建目录下各自编译通过

## 阶段二：路径路由 CI 与独立 Release 镜像流水线

- [ ] **T03-05** 编写 `ci.yml` 的 `detect-changes`、`runtime-ci`、`cli-ci`、`client2-ci` 与 `ci-gate` 聚合门禁，开启分支保护仅校验 `ci-gate`
- [ ] **T03-06** 验证独立性：分别提交仅改 `apps/client2`、仅改 `apps/cli`、仅改 `apps/runtime` 的测试 PR，确认另外两端 0 秒 `skipped` 且 `ci-gate` 正常变绿
- [ ] **T03-07** 配置 GitHub App / 受保护 Release Environment，落地 `release.yml` 按 `runtime-v*`、`cli-v*`、`client2-v*` 独立触发构建
- [ ] **T03-08** 实现老仓镜像 Fan-Out 与 NPM 发版步骤，确保 `runtime-build-<triple>.json` 与资产校验和同老版本完全兼容
- [ ] **T03-09** 升级 `apps/cli` 与 `apps/client2` 更新器为“新仓前缀 Tag 优先、老仓回落兜底”，执行完整 Dry-Run 与灰度 Tag 实测
- [ ] **T03-10** 验收归档：全流程演练通过后将 `specs/monorepo-ci-release/spec.md` 合并至 `openspec/specs/`
