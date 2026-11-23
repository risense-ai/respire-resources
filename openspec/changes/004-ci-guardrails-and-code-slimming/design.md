# Design: 004-ci-guardrails-and-code-slimming

## 1. 先立“防退化 CI 护栏”，再开瘦身手术

护栏脚本 `scripts/check-guardrails.mjs` 落盘在 `risense-ai/respire`（`respire-core` 同步等价规则），**护栏未绿前不开始大面积重构**：

| 护栏检查项 | 机器校验方式 | 阻断条件 |
| --- | --- | --- |
| **物理隔离与禁用依赖** | 解析各 `Cargo.toml`、`Cargo.lock`、`go.mod` | 出现顶层 `Cargo.toml`；`apps/cli` 引服务端/存储 crate；`apps/client2` 引任何 `sqlite` 驱动；`respire-core` 引 I/O/网络 crate |
| **单文件体量棘轮** | 统计 `.rs`/`.go`/`.js` 行数 | 新增或重构完成文件 **> 600 行**；未拆完存量巨型文件行数超过基线（只减不增） |
| **OpenAPI 路由一致** | 对比 `contracts/runtime-api/openapi.yaml` 与 Runtime Router | 漏实现、未注册或契约外幽灵路由直接失败 |
| **Workflow 膨胀锁** | 统计 `.github/workflows/*.yml` 数量 | 超出核心标准流水线（`ci`、`verify`、`e2e`、`release`、`ui-preview`）需审批 |
| **Rust 安全红线** | 扫描新增/修改的 Rust 非测试代码行 | 新增 `.unwrap()` 或 `.expect()` |

## 2. 四端精确瘦身清单（保持 100% 既有业务功能）

### 2.1 `respire-core`（私有仓独立序列）
- **物理删除（约 2,511 行）**：`crates/memory-core/src/{legacy_engine.rs, transport/, crypto.rs, env.rs}`、`crates/winml-catalog/`；兼容单测改用静态 Golden Fixture。
- **契约与性能**：收口 `crates/protocol` 仅覆盖 FFI Wire 边界并补未知字段测试；补齐 `contracts/core-api.json` 与 `core-ffi` 自动一致性校验；将 `analysis.rs` `deepen_plan` 从 O(N²) 改写为邻接表 O(N)。

### 2.2 `apps/runtime`（解体三大上帝文件与模型止血）
- **模型止血与消冗**：CPU-owned 仅需 `tokenizer.json` + `.ort`（取消强求 `.onnx`）；冷加载全链路限 **1 次**流式 SHA-256；前台操作抢占后台索引；全量向量化移出独占写锁；将 `m3` 并入 `model.switch` 退役 `inference.json` 双轨锁；异常退出清理 `pending` 并安全回滚。
- **结构解体**：合并 `crates/app` 与 `crates/app-domain`；将 `engine.rs`、`rpc_serve.rs`、`service.rs` 拆分为 `< 600` 行的领域子模块与 `/v1/*` 处理器；删 `prompt.rs`、`inject.rs` 与重复 `sdk/` 副本；`status_light` 改用 SQL 聚合查询（禁 `store.all()`）。

### 2.3 `apps/cli`（彻底收口为超薄客户端）
- **拆除滥用停服与 `Paused`**：下载模型、卸载非活跃模型、`agent-config --set`、只读 `secret` 一律不停服、不写 `Paused`；仅二进制替换或损坏恢复允许短暂停服，且异常出口必清 `Paused`。
- **代码收口**：合并 `net_rpc.rs` + `rpc.rs` 为 `< 600` 行 OpenAPI 客户端消费层；拆分 `lifecycle.rs`、`shell.rs`、`frontend.rs`、`runtime_fetch.rs` 为 `< 600` 行模块。

### 2.4 `apps/client2`（剥离 Go 版第二套业务引擎）
- **直接删除（约 1,599 行模型包袱 + 60s 轮询）**：`model_uninstall*.go`（643 行）、`provider_*_windows.go`（578 行）、`apply_engine.go`/`engine_state.go`/`model_variants.go`（378 行）、`client.js` 60 秒后台 `tree-cure` 轮询；改用 `model.active_assets` 在线卸载，Windows 优先 `gpu -> cpu`。
- **移除 52 个重事务文件与 WASM SQLite**：借 `/v1/host/transactions/*` 与 `/v1/spaces*` 收敛账户/登录/恢复/空间/配置编排为纯适配器，从 `go.mod` **彻底移除 `github.com/ncruces/go-sqlite3`**；用 SSE 取代 700ms 全量 `/api/state` 轮询；提取前端共享模型 Store 合并 `wizard.js` 与 `models.js`。

## 3. Risks & Rollback

- **风险**：大规模拆文件、删双轨状态机导致老版本迁移或边缘 CLI 输出差异。
- **缓解**：先立护栏，按“止血 → 删僵尸 → 拆大文件”分小粒度 PR 推进；对 1.x 迁移保留 Golden Fixture 回归，由 `005` E2E 兜底验收。
- **回滚**：1 PR = 1 目标，出现回归可按单 PR 精准 `git revert`。
