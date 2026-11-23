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
