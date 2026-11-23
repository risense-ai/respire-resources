# Design: 003-monorepo-merge-and-release-bridge

## 1. Monorepo 目录与物理隔离拓扑

```text
risense-ai/respire/
├── .github/workflows/
│   ├── ci.yml                # detect-changes -> 按路径跑各端 CI -> ci-gate 聚合
│   ├── verify.yml            # 架构护栏 / OpenAPI 同步锁 / 独立核验
│   ├── e2e.yml               # 合入 main 或发版前拉取 respire-resources 跑全链路 E2E
│   └── release.yml           # 按 Tag 前缀独立发版 + 老仓/NPM 镜像 Fan-Out
├── apps/
│   ├── runtime/              # 独立 Cargo.toml + Cargo.lock
│   ├── cli/                  # 独立 Cargo.toml + Cargo.lock (禁止路径依赖 apps/runtime)
│   └── client2/              # 独立 go.mod + go.sum
├── packages/                 # 自动生成自 respire-resources openapi.yaml (禁手改)
├── contracts/                # sync.lock.json 锁定 respire-resources commit + SHA-256
└── scripts/check-guardrails.mjs
```

## 2. 带过滤的历史合仓操作步骤（`git filter-repo`）

在隔离临时目录（例如 `D:\tmp\monorepo-import\`）中操作，**严禁改动本地干净主副本**：

1. **导入 `respire-runtime` → `apps/runtime/`**：
   - `git clone --no-local respire-runtime imp-runtime && cd imp-runtime`
   - `git filter-repo --to-subdirectory-filter apps/runtime --invert-paths --path contracts/ --path .github/workflows/`
2. **清洗并导入 `respire-cli` → `apps/cli/`（直接丢弃 5.4 万行遗留服务端与 23 个历史 workflow）**：
   - `git clone --no-local respire-cli imp-cli && cd imp-cli`
   - 过滤掉以下已知历史包袱目录与文件后再重定位至 `apps/cli/`：
     - 遗留服务端 6 个 crate：`runtime/`、`crates/core-sdk/`、`crates/app/`、`crates/app-domain/`、`crates/storage/`、`crates/crypto/`
     - 14 个 `server` 门控与冗余文件：`crates/commands/src/{admission,bench,engine,lexical,lexical_cache,model_install,network,recall_select,rpc_serve,rpc_worker,runtime_http,skill,sync_flow,util}.rs`、`crates/commands/src/model_progress.rs`、`crates/commands/src/model_granite.rs`、`cli/src/network.rs`
     - 重复契约与废旧 CI：`contracts/`、`.github/workflows/`、`.worktrees/`
     - 执行 `git filter-repo --to-subdirectory-filter apps/cli ...`
3. **导入 `respire-client2` → `apps/client2/`**：
   - `git clone --no-local respire-client2 imp-client2 && cd imp-client2`
   - `git filter-repo --to-subdirectory-filter apps/client2 --invert-paths --path .github/workflows/ --path .worktrees/`
4. **依次合并入 `respire` 新分支（`--allow-unrelated-histories`）**，检查无误后修复各端相对路径引用（如指向根目录 `contracts/` 与 `packages/`）并开 PR 合并。

## 3. Release Fan-Out 镜像产物矩阵（兼容老仓与 NPM）

| Monorepo Tag | 新仓 Release | 必须镜像的老仓库及产物清单 |
| --- | --- | --- |
| **`runtime-vX.Y.Z`** | `risense-ai/respire` (`runtime-vX.Y.Z`) | `risense-ai/respire-runtime` (`vX.Y.Z`)：8 目标 `rsrs-runtime-<triple>.tar.gz` 与 `runtime-build-<triple>.json`（保持 schema-2 字段 `archive_sha256` / `binary_sha256`） |
| **`cli-vX.Y.Z`** | `risense-ai/respire` (`cli-vX.Y.Z`) | 发布 NPM 包 `rsrs-cli` 及 8 平台子包（`@rsrsai/{linux-x64-gnu,linux-x64,linux-arm64-gnu,linux-arm64,macos-x64,macos-arm64,win32-x64,win32-arm64}`）+ 镜像至 `risense-ai/respire-cli` (`vX.Y.Z`)；保留 `model-bge-m3-ort-v1` |
| **`client2-vX.Y.Z`** | `risense-ai/respire` (`client2-vX.Y.Z`) | `risense-ai/respire-client2` (`vX.Y.Z`)：`respire-windows-{amd64,arm64}.exe`、`respire-windows-{amd64,arm64}-setup.exe`、`respire-linux-{amd64,arm64}.tar.gz`、macOS `.dmg`/`.tar.gz`、`SHA256SUMS`、`client-updates.json`、`release-notes.md` |

## 4. Risks & Rollback

- **风险**：CLI 移除服务端 crate 后，原本依赖 `server` feature 的测试会编译失败。
- **缓解**：合入 PR 中将原 `server` 测试拆分为调用独立 `rsrs-runtime` 契约 Mock 测试；在 `003` 完成前三个老仓库保持代码可用但冻结新合并。
- **回滚**：导入操作通过独立 PR 合入 `respire`，老仓库原始提交历史丝毫未改。
