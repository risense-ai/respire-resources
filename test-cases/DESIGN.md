# E2E Acceptance Architecture (`test-cases/DESIGN.md`)

> Modeled on `ShiningRay/sebas`'s black-box process tests and `yetone/magpie`'s cross-OS/UI invariants: **E2E tests live outside product source trees so neither Implementers nor language boundaries can quietly weaken assertions**.

---

## 1. Four-Layer Black-Box Test Suite

| Directory | Runner / Stack | Target Under Test | Mandatory Coverage |
| --- | --- | --- | --- |
| `test-cases/scenarios/` | Node.js YAML runner (`runner.mjs`) | Real compiled `rsrs-runtime` | Cold start, lossless 1.x SQLite `.db` golden-fixture upgrade + backup + downgrade-guard, capability discovery, SSE download cancel, non-blocking `model.switch` during active `recall`, rollback on missing assets, space CRUD |
| `test-cases/cli-e2e/` | Node.js / shell subprocess harness | Compiled `rsrs` + `rsrs-runtime` | Legacy CLI flag & JSON output backward compatibility, `rsrs doctor --fix` `Paused` cleanup, online inactive-model uninstall, upgrade/fallback behavior |
| `test-cases/plugin-rpc/` | OpenAPI HTTP, legacy `/rpc` & MCP stdio client | `rsrs-runtime` + `rsrs mcp` | Legacy `/rpc` shim compatibility, 100 KB+ nested UTF-8 payloads, concurrent recall/store bursts, RFC 9457 error formatting |
| `test-cases/client2-e2e/` | Playwright (Chromium/WebKitGTK) | Client2 WebUI + Mock/Real Runtime | Full 16-screen navigation, `en` & `zh` localization completeness, zero `NaN`/clipping, icon alignment, state sync after SSE completion |

---

## 2. Mandatory Windows Regression Invariants

Every PR touching `apps/runtime`, `apps/cli`, `apps/client2`, or `contracts/` MUST stay green on Windows runners against these historical failure modes (`LESSONS.md`):

1. **Zero CLI Command-Line Length Limits (`L-004`)**:
   - Submit **>= 100 KB nested UTF-8 JSON payloads** (loaded from isolated `test-cases/fixtures/i18n/`) through BOTH `POST /v1/memories` and `rsrs mcp` stdio; assert byte-exact round-trip recall without truncation or quote corruption.
2. **Spaces, Unicode Paths & OneDrive Reparse Points**:
   - Run model download, online inactive-model deletion (`/v1/models/active-assets`), and workspace operations inside paths containing spaces and Windows directory junctions/reparse points.
3. **Zero Orphan `Paused` Locks & Single-Pass I/O**:
   - Verify no `Paused` sentinel remains after canceled downloads, config edits, or read-only `secret` calls; verify cold load hashes model files once.

---

## 2B. Mandatory Database & Legacy Plugin Compatibility Invariants (`AGENTS.md` §5–§6)

1. **Sanitized 1.x Golden DB Fixtures (`test-cases/fixtures/db/`)**:
   - Store representative 1.x SQLite snapshots (empty DB, encrypted TEXT-ID `memories` DB, and comprehensive DB with pending `sync_outbox` rows, `review_history`, `access_grants`, `query_log`, `skill_runs`, `entry_audit`, and triggers).
   - Verify new `rsrs-runtime`: (a) writes `<db>.bak-pre-v<N>-<ts>` before migrating, (b) migrates atomically with `PRAGMA quick_check = ok`, (c) preserves 100% of existing memories and pending sync rows, (d) stamps monotonic `PRAGMA user_version` and restarts idempotently, and (e) fails closed on databases with a higher `user_version`.
2. **Legacy Plugin Compatibility (`plugin-rpc/` & `cli-e2e/`)**:
   - Verify legacy JSON-RPC methods (`runtime.status`, `model.catalog`, `model.switch`, `cli.exec`), legacy `rsrs` CLI flags/JSON outputs, and `rsrs mcp` stdio tools succeed against the new Runtime without requiring plugins to upgrade simultaneously.

---

## 3. UI Bilingual Testing Without Polluting Non-i18n Code

- Localized Chinese strings used for bilingual Playwright assertions MUST reside strictly under `test-cases/fixtures/i18n/` (which is explicitly exempted by `validate-openspec.mjs` and `check-guardrails.mjs`).
- Playwright executes every page test twice (`locale=en`, `locale=zh`), verifying zero missing i18n keys, zero horizontal overflow, and valid `rem` scaling.

---

## 4. Feature-to-E2E Pairing Rule

- Every OpenSpec Change `specs/<domain>/spec.md` scenario (`#### Scenario:`) MUST map 1:1 to either a scenario file in `test-cases/scenarios/` or a named spec in `cli-e2e` / `plugin-rpc` / `client2-e2e`.
- Read-only Verifier Agents execute this suite directly against build artifacts before issuing a `PASS` verdict.
