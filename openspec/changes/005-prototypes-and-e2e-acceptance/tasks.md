# Tasks: 005-prototypes-and-e2e-acceptance

## Phase 1: HTML Prototypes & Deterministic Mock Runtime

- [ ] **T05-01** Upgrade and migrate `ui-mock/server.mjs` into `prototypes/mock-api/server.mjs` implementing `openapi.yaml` `/v1/*` routes, SSE streams, and 5 deterministic seed datasets (`CARD-017`)
- [ ] **T05-02** Extract `prototypes/tokens/tokens.css` (fluid `rem` scale, color palette, dot status indicators) (`CARD-017`)
- [ ] **T05-03** Build all 16 interactive high-fidelity HTML prototype pages under `prototypes/pages/` (`CARD-017`)

## Phase 2: Black-Box E2E Referee Suite (`test-cases/`)

- [ ] **T05-04** Implement `test-cases/runner.mjs` and core `scenarios/*.yaml` (cold start, SSE download cancel, concurrent recall during switch, rollback safety, multi-space isolation) (`CARD-018`)
- [ ] **T05-05** Add `test-cases/cli-e2e/` and `test-cases/plugin-rpc/` including Windows 100 KB+ UTF-8 JSON HTTP/MCP tests and reparse-point online cleanup (`CARD-018`)
- [ ] **T05-06** Add `test-cases/client2-e2e/` Playwright regression suite validating `en` and `zh` UI rendering (using isolated `fixtures/i18n/`), i18n completeness, and layout invariants (`CARD-018`)

## Phase 3: Monorepo Integration & PR UI Preview

- [ ] **T05-07** Land cross-platform `risense-ai/respire/.github/workflows/e2e.yml` pulling `respire-resources/test-cases` against compiled binaries (`CARD-019`)
- [ ] **T05-08** Land privilege-separated `ui-preview.yml` (`detect -> record -> publish`) posting bilingual screenshots and MP4 videos to Client2 PRs (`CARD-019`)
- [ ] **T05-09** Archive `specs/prototypes-and-e2e/spec.md` into `openspec/specs/` after first green full E2E + UI Preview run

## Verification Commands

```sh
node test-cases/runner.mjs --runtime-bin <path-to-rsrs-runtime>
npx playwright test --config test-cases/client2-e2e/playwright.config.mjs
```
