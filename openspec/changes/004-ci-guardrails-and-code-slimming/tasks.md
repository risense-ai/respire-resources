# Tasks: 004-ci-guardrails-and-code-slimming

## 阶段一：部署防退化 CI 护栏（先建护栏后动刀）

- [ ] **T04-01** 在 `respire` 与 `respire-core` 接入禁用依赖扫描脚本（禁 `cli` 引入服务端 crate、禁 `client2` 引入 `sqlite3`、禁 `core` 引入 I/O）
- [ ] **T04-02** 接入文件行数上限门禁（新文件/已瘦身文件 `<= 600` 行，存量待拆大文件建只减不增棘轮基线）
- [ ] **T04-03** 接入 Rust `.unwrap()`/`.expect()` 增量禁令与 Workflow 数量门禁

## 阶段二：`respire-core` 瘦身（私有仓独立推进）

- [ ] **T04-04** 删除 `legacy_engine.rs`、`transport/`、`crypto.rs`、`env.rs`、`crates/winml-catalog/`，兼容测试切换 Golden Fixture
- [ ] **T04-05** 重写 `deepen_plan` 为邻接表 O(N) 算法并补齐大数据量基准对照测试
- [ ] **T04-06** 收口 `crates/protocol` 与 `contracts/core-abi` CI 自动一致校验

## 阶段三：`apps/runtime` 止血与解体

- [ ] **T04-07** 修复模型冷加载 4 连 SHA-256、CPU `.ort`-only 校验、前台抢占后台、非阻塞构建索引与安全 `pending` 回滚，退役 Legacy M3 双轨锁
- [ ] **T04-08** 解体 `engine.rs`、`rpc_serve.rs`、`service.rs` 为 `<600` 行子模块，合并 `crates/app` + `crates/app-domain`，删除 `prompt.rs` / `inject.rs`

## 阶段四：`apps/cli` 与 `apps/client2` 瘦身

- [ ] **T04-09** 清理 `apps/cli` 遗留 `server` 门控残余与 `Paused` 滥用门禁，将 `net_rpc` / `rpc` / `lifecycle` / `shell` / `frontend` / `runtime_fetch` 拆为 `<600` 行模块
- [ ] **T04-10** 物理删除 `apps/client2` 停服卸载、Windows NPU 编排、4-RPC Legacy 切换与 60s `tree-cure` 轮询
- [ ] **T04-11** 将 Client2 52 个重事务编排收敛为 OpenAPI 适配器并从 `go.mod` 彻底移除 `go-sqlite3` WASM
- [ ] **T04-12** 合并前端 `wizard.js` 与 `models.js` 共享状态流，验收归档至 `openspec/specs/`
