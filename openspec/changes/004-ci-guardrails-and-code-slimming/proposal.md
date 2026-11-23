# Proposal: 004-ci-guardrails-and-code-slimming

- **Change ID**: `004-ci-guardrails-and-code-slimming`
- **Status**: `proposed`
- **Depends On**: `003-monorepo-merge-and-release-bridge`

## 1. Why

Workspace audits measured ~333k non-vendor lines across Core, Runtime, CLI, and Client2 with >60% redundancy (including god files up to 6,303 lines, 4x–7x redundant SHA-256 passes, 11k lines of duplicated Go state machines, and 23 legacy CLI workflows). Without automated CI enforcement, slimmed modules inevitably regrow bloat within weeks.

Additionally, now that `respire-core` is open-sourcing into `apps/core`, we can eliminate closed-source SDK packaging overhead while preserving Core's pure in-memory architecture via hard CI guardrails.

## 2. Goals

1. Enforce hard CI anti-regression guardrails first: forbidden dependency bans (`apps/core` zero I/O, `apps/cli` zero server crates, `apps/client2` zero SQLite), Zero-CJK non-i18n enforcement, 600-line file cap ratchet, OpenAPI route parity, and 5-workflow ceiling.
2. **Import & slim `apps/core`**: remove ~2,511 dead lines (`legacy_engine.rs`, `transport/`, `crypto.rs`, `env.rs`, `winml-catalog/`), single-source `core-abi`, rewrite `deepen_plan` from O(N^2) to O(N), and eliminate private Core binary SDK packaging.
3. **Slim `apps/runtime`**: stop 4x cold-load SHA-256 and CPU `.onnx` bloat, add foreground preemption + non-blocking model switch, retire Legacy M3 `inference.json` lock, merge `app` + `app-domain`, split `engine.rs`/`rpc_serve.rs`/`service.rs` (`<600` lines), and delete `prompt.rs`/`inject.rs`.
4. **Slim `apps/cli` & `apps/client2`**: eliminate stop-Runtime / `Paused` gates for downloads/uninstall/config/readonly commands, merge `net_rpc` + `rpc`, delete `model_uninstall*` (643 LoC), Windows NPU install (578 LoC), legacy 4-RPC switch (378 LoC), 60s `tree-cure` polling, and collapse 52 Go host transaction files while removing `github.com/ncruces/go-sqlite3` WASM.

## 3. Non-Goals

- MUST preserve 100% of user features (multi-model switching, multi-space sharing, import/export/backup, memory/diary/tree organization/sync, TUI, `rsrs mcp`, IDE prompt injection).

## 4. Acceptance Criteria

1. All expanded guardrails execute cleanly in `verify.yml` / `ci.yml`.
2. Total non-vendor code drops by 60%+ with zero new files >600 lines and zero `go-sqlite3` or Core I/O dependencies.
3. All unit tests and `005` E2E regression suites pass.
