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
