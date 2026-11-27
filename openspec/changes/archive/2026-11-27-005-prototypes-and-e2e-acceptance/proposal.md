# Proposal: 005-prototypes-and-e2e-acceptance

- **Change ID**: `005-prototypes-and-e2e-acceptance`
- **Status**: `archived`
- **Depends On**: `002-runtime-openapi-v1-migration`, `003-monorepo-merge-and-release-bridge`

## 1. Why

Unit tests alone cannot guard Respire's cross-component UX or system contracts:

1. **No Visual Truth Source**: `respire-client2` lacked a standalone high-fidelity HTML prototype suite and deterministic Mock datasets, causing page state drift (e.g., `wizard.js` working while `models.js` failed) and forcing Maintainer to compile locally just to review UI PRs.
2. **No Black-Box E2E Referee**: Critical journeys (cold start, model switch rollback, Windows 100 KB+ UTF-8 plugin transport, bilingual `en`/`zh` UI layout) lacked out-of-repo black-box tests.

## 2. Goals

1. Build a 16-screen interactive high-fidelity HTML prototype gallery (`prototypes/pages/`), shared fluid `rem` tokens (`prototypes/tokens/`), and deterministic Mock Runtime (`prototypes/mock-api/`).
2. Build a language-agnostic black-box E2E test suite (`test-cases/`) covering Runtime, CLI, Client2, plugins, and mandatory Windows regression checks.
3. Implement **PR UI Preview** (`ui-preview.yml`) on `risense-ai/respire`: automatically boot Mock Runtime + Playwright, capture `en`/`zh` screenshots and MP4 clips, and post them into the PR body.

## 3. Non-Goals

- Prototypes do not couple to compiled Runtime binaries; they consume deterministic OpenAPI 3.1 Mock endpoints.
- UI Preview simulates model download/switch SSE events via Mock Runtime rather than fetching multi-GB model weights on CI runners.

## 4. Acceptance Criteria

1. All 16 HTML prototypes render cleanly and support multi-state interactive walkthroughs offline/locally.
2. `test-cases/` executes black-box E2E scenarios and Windows-specific checks cleanly in `e2e.yml`.
3. Client2 UI PRs automatically post bilingual (`en`/`zh`) screenshots and MP4 videos without leaking tokens.
