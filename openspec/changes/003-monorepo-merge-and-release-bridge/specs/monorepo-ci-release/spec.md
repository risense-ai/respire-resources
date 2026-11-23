# Delta Spec: Monorepo Isolation & Release Bridge (`003`)

## ADDED Requirements

### Requirement: Monorepo 内构建清单物理隔离
`risense-ai/respire` Monorepo 中的 `apps/runtime`、`apps/cli` 与 `apps/client2` MUST 各自持有独立的依赖清单与锁文件（独立 `Cargo.toml`/`Cargo.lock` 与 `go.mod`/`go.sum`）；禁止合并为单一顶层 Cargo Workspace，且严禁在 `apps/*` 之间发生任何源码或路径级相互引用。

#### Scenario: 检查各应用依赖边界
- **GIVEN** CI 运行架构边界扫描脚本
- **WHEN** 检查 `apps/cli/Cargo.toml` 与 `apps/client2/go.mod`
- **THEN** 两者 MUST 仅允许引用生成在 `packages/runtime-sdk-*` 的契约 SDK，绝不出现指向 `apps/runtime` 内部的路径依赖

### Requirement: 路径路由 CI 与零互相拖累门禁
PR 触发 `ci.yml` 时 MUST 先判定变更目录路径；仅改动单一应用目录时，其他未受影响应用的构建与单元测试 job MUST 跳过执行，同时分支保护聚合检查 `ci-gate` MUST 正常通过。

#### Scenario: 仅修改 Client2 提交 PR
- **GIVEN** 某 PR 仅修改了 `apps/client2/` 下的 Go 或前端文件
- **WHEN** GitHub Actions 触发 `ci.yml`
- **THEN** `client2-ci` SHALL 完整执行并成功，`runtime-ci` 与 `cli-ci` MUST 被标记为 `skipped`，且 `ci-gate` 汇报成功允许合并

### Requirement: 组件独立 SemVer 发版与老仓库/NPM 零断更镜像
组件发版 MUST 通过独立前缀 Tag（`runtime-vX.Y.Z`、`cli-vX.Y.Z`、`client2-vX.Y.Z`）触发单组件流水线；过渡期内 CI MUST 自动将发布产物、元数据清单与 NPM 包镜像同步至冻结后的老仓库（`vX.Y.Z`），并保留既有的静态模型资产 Tag。

#### Scenario: 发布新版 Runtime 并兼容老版 CLI 自更新
- **GIVEN** Maintainer 在新 Monorepo 推送标签 `runtime-v2.5.0`
- **WHEN** `release.yml` 完成多平台二进制构建与校验
- **THEN** CI MUST 同时创建 `risense-ai/respire` 的 `runtime-v2.5.0` Release，并将一致的产物与 `runtime-build-<triple>.json` 镜像发布至 `risense-ai/respire-runtime` 的 `v2.5.0` Release
