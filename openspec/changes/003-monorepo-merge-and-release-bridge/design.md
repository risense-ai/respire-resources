# Design: 003-monorepo-merge-and-release-bridge

## 1. Monorepo 目录与物理隔离拓扑

```text
risense-ai/respire/
├── .github/workflows/
│   ├── ci.yml                # detect-changes -> 按路径跑各端 CI -> ci-gate 聚合
│   ├── verify.yml            # 契约漂移 / 架构护栏 / 独立核验
│   ├── e2e.yml               # 合入 main 或发版前拉取 respire-resources 跑全链路 E2E
│   └── release.yml           # 按 Tag 前缀独立发版 + 老仓/NPM 镜像 Fan-Out
├── apps/
│   ├── runtime/              # 独立 Cargo.toml + Cargo.lock (禁止被 cli 路径依赖)
│   ├── cli/                  # 独立 Cargo.toml + Cargo.lock (仅依赖 packages/runtime-sdk-rs)
│   └── client2/              # 独立 go.mod + go.sum (仅依赖 packages/runtime-sdk-go)
├── packages/
│   ├── runtime-sdk-rs/       # 自动生成自 respire-resources openapi.yaml
│   ├── runtime-sdk-go/       # 自动生成自 respire-resources openapi.yaml
│   └── runtime-sdk-ts/       # 自动生成自 respire-resources openapi.yaml
├── contracts/                # 从 respire-resources 同步并锁定来源 SHA 的只读快照
└── scripts/                  # 精简后的共享构建、契约同步与镜像发布脚本
```

**为什么不合并成顶层单一 Cargo Workspace？**  
共享 Cargo Workspace 会把 `apps/runtime` 和 `apps/cli` 绑在同一份 `Cargo.lock` 与依赖特征图上，不仅无法避免改一端重编另一端，还会诱使 Agent 随手在 `cli` 里引用 `runtime` 内部 crate。保持各自独立清单是成本最低的硬隔离。

## 2. 带过滤的历史合仓策略

1. **前置**：Maintainer 将现存归档仓 `risense-ai/respire` 改名为 `risense-ai/respire-legacy-202610`，新建公开仓 `risense-ai/respire`。
2. **分支合入前清洗**：使用 `git filter-repo` 将三仓分别重写前缀为 `apps/runtime/`、`apps/cli/`、`apps/client2/`；对 `respire-cli` 历史，在导入工作分支前物理移除 `runtime/`、`crates/{core-sdk,app,app-domain,storage,crypto}/`、两份重复 `contracts/`（保留单一同步来源）及 23 个历史一次性 workflow，确保不把 5.4 万行垃圾和无效体积搬进新 Monorepo。
3. **统一提交历史**：通过 `--allow-unrelated-histories` 合入新仓 `main`，保留三仓完整作者与 commit 审计脉络。

## 3. 路径路由 CI 与 `ci-gate` 聚合

- **`detect-changes` job**：比对 `pull_request` base/head 变更文件列表，输出布尔值 `runtime`、`cli`、`client2`、`contracts`、`docs_only`：
  - 修改 `apps/client2/**` → 只跑 `client2-ci`（与 `005` 的 UI Preview）；
  - 修改 `apps/cli/**` → 只跑 `cli-ci`；
  - 修改 `apps/runtime/**` → 只跑 `runtime-ci`；
  - 修改 `contracts/**` 或 `packages/**` → 触发受影响的所有端 CI 与 `oasdiff` 检查。
- **`ci-gate` job**：作为 GitHub Branch Protection **唯一必填检查项**（`needs: [detect-changes, runtime-ci, cli-ci, client2-ci, contract-check]`），使用 `if: always()` 判断所有被触发 job 必须 `success`，`skipped` 视作通过，避免跳过检查导致 PR 无法合并。

## 4. 独立 Release 与老仓库/NPM 双向镜像

| Tag 格式 | 触发流水线 | 新仓产出 | 老仓与 NPM 同步动作（Fan-Out） |
| --- | --- | --- | --- |
| `runtime-vX.Y.Z` | `release.yml` (`runtime`) | `risense-ai/respire` Release (`runtime-vX.Y.Z`) | 用 GitHub App Token 镜像同批二进制 + `runtime-build-<triple>.json` + `.sha256` 至 `risense-ai/respire-runtime`（Tag `vX.Y.Z`） |
| `cli-vX.Y.Z` | `release.yml` (`cli`) | `risense-ai/respire` Release (`cli-vX.Y.Z`) | 发布 NPM 包，并镜像二进制与校验文件至 `risense-ai/respire-cli`（Tag `vX.Y.Z`） |
| `client2-vX.Y.Z` | `release.yml` (`client2`) | `risense-ai/respire` Release (`client2-vX.Y.Z`) | 镜像多平台安装包与 manifest 至 `risense-ai/respire-client2`（Tag `vX.Y.Z`） |

**双源升级与老仓退场**：
- 老仓库立即锁定代码写入（设 Branch Protection 禁止新代码合入、README 标注已迁至 `risense-ai/respire`），但**保留既有全部 Release 与 `model-bge-m3-ort-v1` 静态资产 Tag**。
- 新版本 CLI 与 Client2 自更新器改为“优先读取新 Monorepo 前缀 Tag，失败时回退老仓”；经 Maintainer 确认存量老版本过渡完成后，再关闭镜像步骤并归档老仓库。

## 5. Risks & Rollback

- **风险**：跨仓自动镜像需要具有三老仓 `contents: write` 权限的 Token。
- **缓解**：使用最小权限 GitHub App（仅限 release 写入，限制在 `release`受保护 Environment 且仅 Tag 触发），镜像失败不回滚新仓发布但触发告警重试。
- **回滚**：在过渡完成并宣布切换前，三个老仓库的代码分支保持冻结但完整可用，随时可作为只读基线。
