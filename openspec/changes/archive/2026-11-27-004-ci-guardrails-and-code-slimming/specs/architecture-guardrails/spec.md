# Delta Spec: Architecture Guardrails & Code Slimming (`004`)

## ADDED Requirements

### Requirement: Hard Dependency Isolation & Zero-I/O Core Guardrails
CI MUST verify every PR against dependency rules: `apps/core` MUST NOT import filesystem, SQLite, or network I/O crates; `apps/cli` MUST NOT depend on server/storage crates or `apps/runtime`/`apps/core`; `apps/client2` MUST NOT import any SQLite driver.

#### Scenario: SQLite driver re-introduced in Client2
- **GIVEN** a PR adds `github.com/ncruces/go-sqlite3` or any SQLite module to `apps/client2/go.mod`
- **WHEN** CI runs `node scripts/check-guardrails.mjs`
- **THEN** the guardrail check MUST fail and block merge

### Requirement: Code File Line Cap & Monotonic Slimming Ratchet
Every new or refactored source file MUST NOT exceed 600 lines; grandfathered oversized files MUST be tracked under a monotonic decreasing baseline so they never grow larger.

#### Scenario: New oversized Rust or Go module introduced
- **GIVEN** a PR creates a new 750-line file under `apps/runtime/`
- **WHEN** CI checks file size limits
- **THEN** CI MUST fail and instruct the author to split by domain

### Requirement: Single-Pass Streaming Model Verification & Lock-Free Runtime Operations
Model download and cold loading MUST execute at most 1 full-file byte-level SHA-256 pass, CPU-owned profiles MUST NOT require redundant `.onnx` files alongside `.ort`, and Runtime MUST stay running without `Paused` during downloads, non-active uninstalls, and config writes.

#### Scenario: Online uninstall of an inactive model
- **GIVEN** Runtime is serving with active model `m3`
- **WHEN** the user uninstalls inactive model `bge-small` via CLI or Client2
- **THEN** the client SHALL verify safety via `GET /v1/models/active-assets` and remove the directory online without stopping Runtime or writing `Paused`

### Requirement: Lossless SQLite Backward Compatibility & Atomic Migration
`apps/runtime` MUST remain 100% backward compatible with existing 1.x SQLite databases: authoritative tables (`memories`, `meta`, `sync_*`, `review_history`, `access_grants`, `query_log`, `skill_runs`, `entry_audit`) MUST evolve expand-only, upgrades MUST create an atomic SQLite online backup before running single-transaction migrations and `PRAGMA quick_check`, unversioned 1.x databases (`user_version = 0`) MUST bridge seamlessly to monotonic `PRAGMA user_version`, and opening a database with a newer `user_version` MUST fail closed.

#### Scenario: Upgrading a legacy 1.x SQLite database on first start
- **GIVEN** a sanitized legacy 1.x SQLite `.db` fixture containing encrypted `memories`, pending `sync_outbox` rows, `review_history`, `access_grants`, and `user_version = 0`
- **WHEN** the new `apps/runtime` opens the database and runs startup migration
- **THEN** Runtime SHALL write a pre-migration backup file, complete migration atomically with `PRAGMA quick_check` passing, preserve 100% of existing memories and pending sync records, stamp the target `user_version`, and restart idempotently on subsequent boots

#### Scenario: Older Runtime encounters a newer database schema version
- **GIVEN** a SQLite database whose `PRAGMA user_version` is higher than the running Runtime binary supports
- **WHEN** Runtime attempts to open the database
- **THEN** Runtime MUST fail closed without modifying the database and return an explicit upgrade-required error

### Requirement: Super-Password, Vault v1–v4 & Legacy Ciphertext Compatibility
`apps/runtime` MUST preserve bit-exact KDF, key-wrapping, OS keyring, and AEAD decryption compatibility for existing Vault `v1`, `v2`, `v3`, and `v4` repositories (including `A3-...` super passwords, both `onememory:*` and `rsrs:*` HKDF domain strings, `PBKDF2-SHA256` 210k super KDF & 100k auth hashing, unmarked legacy ciphertexts, and `rsrs:v1:` envelopes).

#### Scenario: Existing super password unlocks and decrypts a legacy Vault v1–v4 repository
- **GIVEN** golden Vault `v1`, `v2`, `v3`, and `v4` fixtures (`session.json` + wrapped URK + `A3-...` / super password + `onememory:*` and `rsrs:*` ciphertexts)
- **WHEN** the new `apps/runtime` unlocks each repository with the original super password
- **THEN** Runtime SHALL unwrap the exact URK and decrypt existing memories without requiring re-encryption or breaking login/auth hashes

#### Scenario: OS keyring and legacy auth-salt continuity
- **GIVEN** an existing user profile under `~/.rsrs/` or `accounts/<name>/` with OS keyring credentials under service `rsrs` (or `keyring_account` aliases)
- **WHEN** the upgraded Runtime and CLI read or unlock the profile
- **THEN** existing keyring entries, `keys-export`, and `--super` overrides SHALL remain functional without writing plaintext secrets to disk

### Requirement: Zero User-Feature Reduction During Code Slimming
Code slimming across `apps/core`, `apps/runtime`, `apps/cli`, and `apps/client2` MUST eliminate only dead/duplicated code and relocate state machines out of thin clients—preserving 100% of existing user-facing capabilities.

#### Scenario: Slimming preserves all user-facing capabilities
- **GIVEN** completed `CARD-013`–`CARD-016` refactoring PRs
- **WHEN** feature-parity E2E checks run across CLI, TUI, MCP, IDE `inject`, and all 16 Client2 screens
- **THEN** every existing user workflow (accounts/spaces/grants, diary, organize, session-import, sync/conflict recovery, model install/switch/online-uninstall, GPU/CPU selection) SHALL operate cleanly without removed features
