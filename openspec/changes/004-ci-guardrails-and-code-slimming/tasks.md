# Tasks: 004-ci-guardrails-and-code-slimming

## Phase 1: Deploy Full Anti-Regression CI Guardrails First

- [ ] **T04-01** Expand `respire/scripts/check-guardrails.mjs` with `apps/core` I/O crate bans, 600-line file ratchet baselines, and incremental Rust `.unwrap()`/`.expect()` blocking (`CARD-012`)
- [ ] **T04-02** Add Runtime OpenAPI route-parity and Core ABI schema-parity assertions into CI (`CARD-012`)

## Phase 2: Open-Source `apps/core` Import & Slimming

- [ ] **T04-03** Import audited `respire-core` into `apps/core` and delete `legacy_engine.rs`, `transport/`, `crypto.rs`, `env.rs`, and `crates/winml-catalog/` using Golden Fixtures for legacy tests (`CARD-013`)
- [ ] **T04-04** Rewrite `deepen_plan` in `analysis.rs` to O(N), slim `crates/protocol` to Wire DTOs with unknown-field tests, and retire private Core SDK tarball/cache ceremony (`CARD-013`)

## Phase 3: `apps/runtime` Stabilization & God-File Teardown

- [ ] **T04-05** Fix 4x SHA-256, enforce CPU `.ort`-only check, add foreground preemption + non-blocking model switch, fix `pending` cleanup/rollback, retire Legacy M3 lock, and implement backup-before-migrate + monotonic `PRAGMA user_version` + downgrade guard + Golden 1.x SQLite migration unit tests (`CARD-014`)
- [ ] **T04-06** Split `engine.rs`, `rpc_serve.rs`, and `service.rs` `<600` lines; merge `app` + `app-domain`; remove `prompt.rs`/`inject.rs`; switch `status_light` to SQL aggregates (`CARD-014`)

## Phase 4: `apps/cli` & `apps/client2` Slimming

- [ ] **T04-07** Remove stop-Runtime and `Paused` abuse from downloads, online uninstall, `agent-config --set`, and read-only `secret`; add `rsrs doctor --fix` `Paused` cleanup (`CARD-015`)
- [ ] **T04-08** Merge `net_rpc.rs` + `rpc.rs` onto OpenAPI SDK and split `lifecycle.rs`, `shell.rs`, `frontend.rs`, and `runtime_fetch.rs` `<600` lines (`CARD-015`)
- [ ] **T04-09** Delete `apps/client2` `model_uninstall*.go`, `provider_*_windows.go`, `apply_engine.go`/`engine_state.go`/`model_variants.go`, and 60s `tree-cure` polling (`CARD-016`)
- [ ] **T04-10** Collapse Client2's 52 heavy host state-machine files onto `/v1/host/*` + `/v1/spaces*`, remove `github.com/ncruces/go-sqlite3` from `go.mod`, and unify `wizard.js` + `models.js` (`CARD-016`)
- [ ] **T04-11** Archive `specs/architecture-guardrails/spec.md` into `openspec/specs/` after all suites pass

## Verification Commands

```sh
node scripts/check-guardrails.mjs
cargo test --manifest-path apps/core/Cargo.toml --locked
cargo test --manifest-path apps/runtime/Cargo.toml --locked
cargo test --manifest-path apps/cli/Cargo.toml --locked
cd apps/client2 && go test ./...
```
