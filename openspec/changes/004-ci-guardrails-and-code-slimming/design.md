# Design: 004-ci-guardrails-and-code-slimming

## 1. 先立“防退化 CI 护栏”，再开瘦身手术

护栏脚本统一放入 Monorepo 与 `respire-core` 的 CI，**护栏未就绪前不开始大规模删改**：

| 护栏检查项 | 检查方式 | 阻断条件 |
| --- | --- | --- |
| **禁用依赖扫描** | 解析 `Cargo.toml` / `Cargo.lock` / `go.mod` | `apps/cli` 含 `storage`/`core-sdk`/`axum`/`tiny_http`；`apps/client2` 含任何 `sqlite` 驱动；`respire-core` 含文件/网络 I/O crate；`apps/*` 间存在直接 path 依赖 |
| **单文件规模红线** | 扫描本次 PR 新增或重构的目标 `.rs`/`.go`/`.js` | 超过 **600 行**（暂无法拆完的遗留大文件在白名单登记“只减不增”单调递减锁） |
| **OpenAPI 路由一致** | 对比 `contracts/runtime-api/openapi.yaml` 与 Runtime 注册路由表 | 漏实现、未注册或私有幽灵路由直接失败 |
| **Workflow 膨胀锁** | 统计 `.github/workflows/*.yml` 数量 | 超出标准核心 4 类（`ci` / `verify` / `e2e` / `release`）需 Maintainer 审批标签 |
| **Rust 安全性** | AST/正则扫描新增或修改的 Rust 源码行 | 新增 `.unwrap()` 或 `.expect()`（非测试代码）立即失败 |

## 2. 四端瘦身施工边界与依赖消除

各端瘦身全部依托 `002` 定义的 `capabilities` 协商与 OpenAPI 3.1 契约，**无须互相等待**：

1. **`respire-core`（独立 PR 序列）**：
   - 删除 `legacy_engine.rs`、`transport/`、`crypto.rs`、`env.rs`、`crates/winml-catalog/`，改用静态 Golden Fixture 测试；
   - `crates/core-ffi` 与 `contracts/core-abi/` 加 CI 一致性检查；`analysis.rs` `deepen_plan` 邻接表 O(N) 重写。
2. **`apps/runtime`（解体上帝文件 & 模型止血）**：
   - 优先落盘模型止血：CPU ORT-only 仅要求 `.ort`、冷加载限 1× 流式 SHA-256、前台操作抢占后台索引、全量向量化移出独占写锁、`m3` 统一并入 `model.switch`；
   - 拆分 `engine.rs`、`rpc_serve.rs`、`service.rs` 为 `<600` 行的业务子模块，合并 `crates/app` 与 `crates/app-domain`，删 `prompt.rs` / `inject.rs`。
3. **`apps/cli`（收口为极薄客户端）**：
   - 拆掉下载/卸载/写配置/只读命令时的停服与 `Paused` 锁，实现全模型在线卸载；
   - 合并 `net_rpc.rs` + `rpc.rs` 为 `<600` 行客户端消费层（接 OpenAPI SDK），拆分 `lifecycle.rs` / `shell.rs` / `frontend.rs` / `runtime_fetch.rs`。
4. **`apps/client2`（移除 Go 版第二套引擎）**：
   - 物理删除 `model_uninstall*.go`、`provider_*_windows.go`、`apply_engine.go`/`engine_state.go`/`model_variants.go`、60s `tree-cure` 后台轮询；
   - 借 `host.transactions.v1` / OpenAPI 剥离 52 个账户/空间/配置状态机文件并从 `go.mod` **彻底移除 `github.com/ncruces/go-sqlite3`**；
   - 提取前端共享模型 Store，合并 `wizard.js` 与 `models.js`。

## 3. Risks & Rollback

- **风险**：大规模拆文件、删兼容层可能导致冷门命令行参数或历史迁移路径回归。
- **缓解**：每批瘦身拆分仅聚焦单一域（例如先修哈希/停服止血，再删废文件，最后拆大文件）；对现有 1.x 迁移保留独立黄金夹具测试，并由 `005` E2E 回归验证。
- **回滚**：小步单目标 PR 提交，出现回归可按单 PR 精准 `git revert` 而不影响其他模块。
