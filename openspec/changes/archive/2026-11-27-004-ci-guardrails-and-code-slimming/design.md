# Design: 004-ci-guardrails-and-code-slimming

## 1. Anti-Regression CI Guardrails First

Extend `scripts/check-guardrails.mjs` BEFORE large deletions begin:

| Guardrail | Automated Check | Failure Condition |
| --- | --- | --- |
| **Forbidden Dependencies** | Parse all `Cargo.toml`, `Cargo.lock`, `go.mod` | Root `Cargo.toml`; `apps/core` using `rusqlite`/`sqlx`/`reqwest`/`ureq`/`axum`; `apps/cli` using `../runtime`/`../core`/`storage`/`core-sdk`/`app`/`axum`; `apps/client2` using `sqlite3` |
| **File Line Ratchet** | Count lines across `.rs`, `.go`, `.js`, `.ts` | Any new/refactored file `> 600` lines; any grandfathered file exceeding its baseline |
| **Zero-CJK Gate** | Scan all non-i18n files | Any CJK character outside explicit i18n paths |
| **Route & ABI Parity** | Compare `openapi.yaml` / `core-api.json` vs handlers | Missing, unregistered, or undocumented endpoints |
| **Workflow & Rust Safety** | Count `.github/workflows/*.yml`; scan diff | Workflows `> 5`; new `.unwrap()`/`.expect()` in non-test Rust |

## 2. Four-Component Slimming Roadmap

### 2.1 `apps/core` (Open-Source Import & Cleanup — `CARD-013`)
- Delete ~2,511 dead lines (`crates/memory-core/src/{legacy_engine.rs, transport/, crypto.rs, env.rs}`, `crates/winml-catalog/`); port historical format tests to static Golden Fixtures. *(Deleting dead `memory-core/src/crypto.rs` inside Core MUST NEVER touch or alter `apps/runtime/crates/crypto/`.)*
- Rewrite `analysis.rs` `deepen_plan` using adjacency-list `HashMap` in O(N), keeping exact cluster counts and thresholds.
- Retire private Core SDK tarball/cache scripts once `apps/core` is directly open-sourced in-tree, retaining `contracts/core-abi/` unknown-field compatibility tests.

### 2.2 `apps/runtime` (`CARD-014`)
- **Database backward compatibility (Hard Gate)**: Keep all legacy authoritative SQLite tables (`memories`, `memory_chunks`, `meta`, `sync_*`, `review_history`, `access_grants`, `query_log`, `query_feedback`, `skill_runs`, `entry_audit`, `recall_pairs`, `core_artifacts`) strictly expand-only; preserve `~/.rsrs/`, `RSRS_DATA_DIR`, and `accounts/<name>/` layouts; bridge unversioned 1.x schemas (`user_version = 0`) into monotonic `PRAGMA user_version` migrations; execute SQLite Online Backup (`<db>.bak-pre-v<N>-<ts>`) + single-transaction migration + `PRAGMA quick_check`; fail closed on higher `user_version` (no silent downgrade); validate every storage PR against Golden 1.x `.db` fixtures.
- **Super-Password, Vault v1–v4 & Legacy Ciphertext Compatibility (Hard Gate)**: Preserve `apps/runtime/crates/crypto`, `auth`, and `keystore` decryption across Vault `v1` (`Argon2id` + Account Secret), `v2` (`PBKDF2-SHA256` 210k), `v3` (`PBKDF2` + Secret Key), and `v4` (`A3-...` 18-byte entropy HKDF), keeping BOTH `onememory:*` and `rsrs:*` domain strings, 100k `PBKDF2-SHA256` auth hashing, AES-256-GCM 12-byte nonces, unmarked ciphertexts + `rsrs:v1:` envelopes, OS keyring service `rsrs` (`keyring_account` aliases), `--super`, and `keys-export` backed by Golden Crypto Vector unit tests.
- **Model stabilization**: CPU-owned requires only `tokenizer.json` + `.ort`; single-pass streaming SHA-256 on load/download; foreground preemption (`background: bool`) in `model_progress.rs`; move full re-embedding outside exclusive write lock; fold `m3` into `model.switch` and retire `inference.json`; clean `pending` keys on error/startup and keep `unchanged` on rollback.
- **God-file teardown**: Merge `crates/app` + `crates/app-domain`; split `engine.rs`, `rpc_serve.rs`, and `service.rs` into `<600`-line modules backing `/v1/*`; delete duplicate Runtime `prompt.rs`/`inject.rs` (IDE injection stays in `apps/cli` / Client2) and duplicate `sdk/` locks; replace `store.all(true)` in `status_light` with SQL `COUNT(*)`/`MAX(updated_at)`.

### 2.3 `apps/cli` (`CARD-015`)
- Zero user-feature reduction: preserve ALL existing CLI subcommands, TUI screens, `rsrs mcp` stdio tools, IDE `inject`, `keys-export`, and `doctor --fix`; ONLY slim internals (`<600` lines/file) and remove stop/`Paused` abuse.
- Allow Runtime stopping ONLY for binary self-upgrade or database corruption recovery; keep Runtime running (and never write `Paused`) for downloads, non-active uninstalls, `agent-config --set`, and read-only `secret`/`keys-export`.
- Merge `net_rpc.rs` + `rpc.rs` into `<600`-line OpenAPI client; split `lifecycle.rs`, `shell.rs`, `frontend.rs`, and `runtime_fetch.rs` under `<600` lines.

### 2.4 `apps/client2` (`CARD-016`)
- Zero user-feature reduction: preserve all 16 WebUI screens, system tray, multi-account/spaces/grants, diary, organize, session-import, online model uninstall, and GPU/CPU acceleration selection (move backend logic to Runtime `/v1/*` APIs rather than removing features).
- Delete `model_uninstall*.go` (643 LoC), `provider_*_windows.go` (578 LoC), `apply_engine.go`/`engine_state.go`/`model_variants.go` (378 LoC), and 60s `tree-cure` polling in `client.js`; uninstall non-active models online via `/v1/models/active-assets`; prefer `gpu -> cpu` on Windows.
- Replace 52 host transaction/space/config files (~11k LoC) with thin `/v1/host/*` & `/v1/spaces*` adapters; **remove `github.com/ncruces/go-sqlite3` from `go.mod`**; replace 700ms `/api/state` polling with SSE; unify `wizard.js` and `models.js` shared model state.

## 3. Risks & Rollback

- **Risk**: Splitting large files or deleting legacy switches introduces edge-case regressions.
- **Mitigation**: Keep 1 PR = 1 scoped domain change; protect 1.x migrations with Golden Fixtures and verify with `005` E2E suites.
- **Rollback**: Each atomic PR can be cleanly `git revert`ed independently.
