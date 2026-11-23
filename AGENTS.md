# AGENTS.md — Global AI Engineering Constitution for Respire

> This document is the **supreme engineering constitution** across all Respire repositories (`risense-ai/respire-resources` and `risense-ai/respire`). Repository-local `AGENTS.md` files may add local build commands or stricter checks, but **MUST NOT weaken any rule defined here**.

---

## 1. Strict English-Only Policy (Hard CI Gate)

1. **English everywhere except UI i18n**: Every specification, document, source file, code comment, script, workflow, commit message, PR description, and GitHub Issue MUST be written in **English**.
2. **Only permitted exception**: Localized user-facing strings (such as Chinese translations) inside dedicated UI i18n files (`**/i18n/**`, `**/i18n.js`, `**/locales/**`, `**/*_zh*.json`, `**/*.zh-CN.*`, `**/test-cases/fixtures/i18n/**`).
3. **CI enforcement**: Both `validate-openspec.mjs` and `check-guardrails.mjs` fail immediately if any CJK character appears outside those explicit i18n paths.

---

## 2. Spec-First Gate & Licensing (No Unapproved Code)

1. **No work without an OpenSpec Change**: Every new feature, cross-module refactor, contract change, or UI redesign MUST first exist as an OpenSpec Change package in `respire-resources/openspec/changes/<change-id>/` (`proposal.md`, `design.md`, `tasks.md`, `specs/<domain>/spec.md`).
2. **Approval before implementation**: Implementer Agents MUST NOT branch or modify product code until the target Change and GitHub Issue carry Maintainer approval (`spec:approved`).
3. **Contract-First**: `contracts/runtime-api/openapi.yaml` is the single source of truth for Runtime APIs, and `contracts/core-abi/` defines the Core FFI boundary. Hand-written duplicate DTOs across components are forbidden.
4. **Open-Source License & Legacy Repo Visibility**: `risense-ai/respire-resources` and `risense-ai/respire` (including full audited `apps/core`, `apps/runtime`, `apps/cli`, and `apps/client2`) are published under **Respire Noncommercial License 1.0** ([LICENSE](LICENSE) and [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)) while preserving all third-party dependency licenses and notices. Legacy `risense-ai/respire-core` remains a **private historical archive**—NEVER flip its GitHub repository visibility to public.

---

## 3. Four-Layer Architecture Boundaries (Zero Tolerance)

| Component | Sole Responsibility | Hard Prohibition (Blocks PR) |
| --- | --- | --- |
| **`apps/core`** *(open-source)* | Pure in-memory algorithms & inference (embeddings, ONNX/MLX sessions, hybrid ranking, `deepen_plan`, classification, FFI ABI) | No filesystem, directory, SQLite, keyring, HTTP, or network I/O crates in production code; receives buffers/callbacks from host only |
| **`apps/runtime`** | Sole authoritative control & data plane (SQLite persistence, model catalog, managed downloads/hot-switch, OpenAPI 3.1 + SSE, frozen legacy JSON-RPC shim, account/space transactions) | No Clap secondary CLI parser, no TTY `prompt`, no IDE `inject`, no unpreemptable background write locks |
| **`apps/cli`** | Ultra-thin CLI, TUI, `rsrs mcp` stdio bridge, OS autostart & Runtime binary installer/watchdog | No server/storage crates (`storage`, `core-sdk`, `app`, `axum`), no direct SQLite reads, no stopping Runtime or writing `Paused` for downloads/config/uninstall |
| **`apps/client2`** | Wails desktop shell, tray, OS proxy/keyring bridge, OpenAPI + SSE consumer, WebUI | No SQLite drivers (`go-sqlite3` WASM) in `go.mod`, no Go-side account/space/model state machines, no `cli.exec` argv tables |

---

## 4. Maker-Checker Separation (Independent Verification)

1. **Independent context**: An Implementer Agent MUST NEVER sign off final verification of its own code. Verification MUST be performed by a **read-only Verifier Agent** running in a fresh session/process.
2. **Evidence-only claims**: Every claim MUST cite concrete command output, test logs, HTTP responses, or preview screenshots/videos.
3. **Honest untested reporting**: If an environment lacks hardware/OS coverage (for example macOS or Windows ARM64), mark it explicitly as `UNTESTED` with the reason; never fabricate or relax assertions.
4. **Tool- & Agent-Agnostic Governance**: Repository specs, workflows, and scripts MUST remain agent-agnostic—never commit vendor-specific agent names or session prompts into repository files.

---

## 5. Database, Super-Password Crypto & Feature-Parity Compatibility (Zero Tolerance)

1. **Expand-Only Authoritative Schema**: `apps/runtime` MUST NEVER drop, rename, or alter existing columns, primary keys, ciphertext/nonce layouts, or sync triggers on legacy authoritative tables (`memories`, `memory_chunks`, `meta`, `sync_*`, `review_history`, `access_grants`, `query_log`, `query_feedback`, `skill_runs`, `entry_audit`, `recall_pairs`, `core_artifacts`). Extend persisted schema strictly via idempotent additive columns (with defaults) or new tables; only derived cache tables (`retrieval_*`, `diary_*`) may be rebuilt.
2. **Backup-Before-Migrate & Atomic Transactions**: Before migrating a legacy `.db`, Runtime MUST create an atomic backup (`<db>.bak-pre-v<N>-<ts>`) via SQLite Online Backup API, run migration steps inside a single transaction followed by `PRAGMA quick_check`, and roll back untouched on failure.
3. **Monotonic `PRAGMA user_version` & Downgrade Guard**: Bridge unversioned 1.x databases (`user_version = 0`) via idempotent column/trigger inspection before stamping a monotonic `user_version`; never edit shipped migration steps; Fail-Closed with an explicit upgrade error if opening a database with a higher `user_version`.
4. **Golden Legacy DB Regression Gate**: Every PR modifying `apps/runtime` storage MUST pass lossless upgrade, recall, `sync_outbox` preservation, and idempotent restart checks against sanitized 1.x `.db` fixtures in `respire-resources/test-cases/fixtures/db/`.
5. **Single Writer Only**: Only `apps/runtime` may open SQLite databases; `apps/cli` and `apps/client2` MUST NEVER access `.db` files directly.
6. **Data Directory & Multi-Profile Layout**: Preserve compatibility with `~/.rsrs/`, `RSRS_DATA_DIR`, `accounts/<name>/`, `session.json`, `client.json`, `diary` cache, and `lock.db` across existing user profiles.
7. **Super-Password, Vault v1–v4 & Legacy Ciphertext Decryption**: `apps/runtime` (`crates/crypto`, `auth`, `keystore`) MUST remain 100% decryption- and login-compatible with existing repositories across Vault `v1` (`Argon2id` + Account Secret), `v2` (`PBKDF2-SHA256` 210k), `v3` (`PBKDF2` + Secret Key), and `v4` (`A3-...` 18-byte entropy HKDF), preserving BOTH `onememory:*` and `rsrs:*` domain strings (`onememory:kek:v4`, `rsrs:kek:v4`, `onememory:kek:v1`, `rsrs:kek:v1`, `rsrs:data:v1`, `rsrs:embedding:v1`, `onememory:auth-salt:v1`, `rsrs:auth-salt:v1`), `PBKDF2-SHA256` 100k auth hashing, AES-256-GCM 12-byte nonces, unmarked legacy ciphertexts plus `rsrs:v1:` envelopes, OS keyring service `rsrs` with `keyring_account` aliases, `--super`, and `rsrs keys-export`; never write plaintext credentials to `session.json`.
8. **Zero User-Feature Reduction**: Code slimming deletes ONLY dead/duplicated code and relocates business state machines from CLI/Client2 into Runtime—it MUST NEVER remove or regress any user-facing feature (CLI subcommands, TUI, MCP, IDE injection, all 16 Client2 screens, multi-account/spaces/grants, diary, organize, session-import, sync/conflict recovery, model install/switch/online-uninstall, or GPU/CPU selection).

---

## 6. Capability Negotiation, Plugin Compatibility & Windows Rules

1. **Negotiate by capabilities, never version strings**: Clients (`apps/cli`, `apps/client2`, plugins) MUST inspect `capabilities` returned by `GET /v1/health` (or legacy health fallback) rather than comparing Runtime version strings.
2. **Preserve all legacy plugin entry points during transition**: Existing `rsrs` CLI flags/JSON outputs, `rsrs mcp` stdio tools, and Runtime's frozen `<200`-line `/rpc` shim MUST remain backward compatible while new plugins adopt OpenAPI 3.1 + Discovery.
3. **No Windows CLI argument transport**: New/migrated plugins and tools MUST call Runtime over local HTTP OpenAPI 3.1 or `rsrs mcp` stdio—never by concatenating large payloads onto CLI arguments.

---

## 7. Worktree Isolation, File Caps & Commit Hygiene

1. **Worktree isolation**: Never modify or build inside clean `main` clones; work strictly in `../.worktrees/<change-id>/<repo>` branches.
2. **File size caps**:
   - Non-archive Markdown docs under `openspec/` MUST NOT exceed **400 lines**.
   - New or refactored code files (Rust / Go / JS / TS) MUST NOT exceed **600 lines**.
3. **No line-number anchors in docs**: Reference `§` sections, file paths, or symbol names—never brittle source line numbers.
4. **Rust safety**: Never introduce new `.unwrap()` or `.expect()` calls in non-test Rust code.
5. **Commit & PR hygiene**: Use Conventional Commits (`feat(runtime): ...`), attach the matching GitHub Milestone, and include `Fixes <owner/repo>#<issue>` plus real verification output in every PR body.
