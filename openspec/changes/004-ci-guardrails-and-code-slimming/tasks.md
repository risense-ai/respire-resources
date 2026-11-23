# Tasks: 004-ci-guardrails-and-code-slimming

## 阶段一：部署全套防退化 CI 护栏（先立防线后动刀）

- [ ] **T04-01** 扩展 `respire/scripts/check-guardrails.mjs`：加入单文件 `<= 600` 行棘轮基线、Rust 增量 `.unwrap()`/`.expect()` 拦截与 `openapi.yaml` 路由一致性校验入口
- [ ] **T04-02** 在 `respire-core` 接入禁止 I/O crate 依赖检查、单文件行数上限与 `core-api.json` / `core-ffi` 一致性检查

## 阶段二：`respire-core` 瘦身（私有仓独立推进）

- [ ] **T04-03** 物理删除 `legacy_engine.rs`、`transport/`、`crypto.rs`、`env.rs`、`crates/winml-catalog/`，历史兼容测试改用 Golden Fixture
- [ ] **T04-04** 将 `analysis.rs` `deepen_plan` 重写为邻接表 O(N) 算法并补大数据量回归测试；收口 `crates/protocol` 并验证未知字段前向兼容

## 阶段三：`apps/runtime` 止血与解体

- [ ] **T04-05** 模型止血：CPU 仅校验 `.ort`、冷加载限 1× 流式 SHA-256、前台抢占后台索引、非阻塞构建索引与 `pending` 安全清理/回滚，退役 Legacy M3 双轨锁
- [ ] **T04-06** 解体 `engine.rs`、`rpc_serve.rs`、`service.rs`（全员 `< 600` 行），合并 `crates/app` + `crates/app-domain`，删 `prompt.rs` / `inject.rs` 与重复 `sdk/`，`status_light` 改 SQL 聚合

## 阶段四：`apps/cli` 与 `apps/client2` 瘦身

- [ ] **T04-07** 解除 `apps/cli` 下载/在线卸载/改配置/只读命令的停服与 `Paused` 门禁，补 `rsrs doctor --fix` 残留清理
- [ ] **T04-08** 合并 `net_rpc.rs` + `rpc.rs` 为 `< 600` 行 OpenAPI 消费层，拆分 `lifecycle.rs` / `shell.rs` / `frontend.rs` / `runtime_fetch.rs`（全员 `< 600` 行）
- [ ] **T04-09** 物理删除 `apps/client2` 停服卸载（`model_uninstall*.go`）、必败 NPU（`provider_*_windows.go`）、Legacy 4-RPC（`apply_engine.go`/`engine_state.go`/`model_variants.go`）与 60s `tree-cure` 轮询
- [ ] **T04-10** 收敛 Client2 52 个账户/空间/配置重状态机至 `/v1/host/*` 与 `/v1/spaces*`，从 `go.mod` 彻底移除 `github.com/ncruces/go-sqlite3`，并合并前端 `wizard.js` 与 `models.js` 状态流
- [ ] **T04-11** 验收归档：全量单测与护栏通过后，由 Scribe 将 `specs/architecture-guardrails/spec.md` 合并至 `openspec/specs/`

## 验收命令

```sh
node scripts/check-guardrails.mjs
cargo test --manifest-path apps/runtime/Cargo.toml --locked
cargo test --manifest-path apps/cli/Cargo.toml --locked
go test ./apps/client2/...
```
