# Design: 005-prototypes-and-e2e-acceptance

## 1. High-Fidelity HTML Prototypes (`prototypes/`)

- **Shared Tokens (`prototypes/tokens/`)**: Align with Client2 fluid root typography (`clamp(14px, 0.5rem + 0.62vw, 18.8px)`), `rem` spacing/sizing scale, theme palette, and dot/swatch status indicators.
- **16-Screen Coverage (`prototypes/pages/`)**:
  - Onboarding & Summary: `wizard.html`, `overview.html`, `quickpanel.html`
  - Memory Core: `workspace.html` (tree / list / card / graph views), `recall.html`, `diary.html`, `organize.html`
  - Models & Storage: `models.html`, `storage.html`, `session-import.html`, `stats.html`
  - Accounts & Settings: `accounts.html`, `grants.html`, `space-members.html`, `injection.html`, `settings.html`
- **Deterministic Mock Runtime (`prototypes/mock-api/server.mjs`)**: Migrated and upgraded from `respire-client2/.verification/ui-mock/server.mjs` to serve `openapi.yaml` `/v1/*` endpoints and SSE streams with 5 seed datasets (`empty`, `rich-1k`, `downloading-sse`, `switch-rollback-error`, `multi-account`).

## 2. Black-Box E2E Referee Suite (`test-cases/`)

1. **`scenarios/*.yaml`, Golden DB Fixtures (`test-cases/fixtures/db/`) & Golden Crypto Vectors (`test-cases/fixtures/crypto/`)**: Declarative runner executing real black-box requests against compiled `rsrs-runtime` (cold start, lossless upgrade of sanitized real 1.x SQLite `.db` snapshots with backup/rollback/downgrade checks, Vault `v1`–`v4` super-password unlock & decryption across `onememory:*`/`rsrs:*` + unmarked/marked ciphertexts, download cancel, non-blocking `recall` during switch, rollback safety).
2. **`plugin-rpc/`, `cli-e2e/` & Feature-Parity Regression Gates**:
   - Verify full backward compatibility for legacy `/rpc` callers (`runtime.status`, `model.switch`, `cli.exec`), legacy `rsrs` CLI flags/JSON outputs, TUI, IDE `inject`, and `rsrs mcp` tools with **zero user-feature reduction**;
   - Send **100 KB+ nested UTF-8 JSON payloads** (including isolated i18n fixture strings under `test-cases/fixtures/i18n/`) via HTTP `POST /v1/memories` and `rsrs mcp` stdio on Windows runners to verify zero CLI length truncation or quoting corruption;
   - Verify online non-active model uninstall across Windows paths containing spaces and OneDrive reparse points, plus zero lingering `Paused` locks.
3. **`client2-e2e/` (Playwright Bilingual Verification)**: Run across `en` and `zh` UI locales (loading localized strings from isolated UI i18n bundles) checking zero console errors, zero missing translation keys, no `NaN`/clipping, and aligned controls.

## 3. Privilege-Separated Client2 PR UI Preview

In `risense-ai/respire/.github/workflows/ui-preview.yml`:
1. **`detect` job** (`contents: read`, `pull-requests: write`): Triggers when PRs modify `apps/client2/**/frontend/**`, `apps/client2/**/desktop/**`, or carry `ui-preview` label; writes placeholder marker in PR body.
2. **`record` job** (`permissions: {}`, zero write tokens): Starts `prototypes/mock-api/server.mjs` + PR Client2 WebUI, drives Playwright in `en` and `zh` locales, records screenshots & MP4 clips with simulated pointer overlay, scans artifacts for leaked secrets.
3. **`publish` job** (`contents: write`, `pull-requests: write`, NEVER checks out PR code): Pushes artifacts to `ui-previews` branch and embeds inline images + video links into the PR description.

## 4. Risks & Rollback

- **Risk**: Executing untrusted PR code inside `record`.
- **Mitigation**: `record` runs with zero repo write tokens and hits local Mock API only; `publish` never executes PR code.
- **Rollback**: `ui-preview.yml` runs independently and does not block non-UI PR merges.
