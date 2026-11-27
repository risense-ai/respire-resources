# Tasks: 005-prototypes-and-e2e-acceptance

## Phase 1: HTML Prototypes & Deterministic Mock Runtime

- [x] **T05-01** Upgrade and migrate `ui-mock/server.mjs` into `prototypes/mock-api/server.mjs` implementing `openapi.yaml` `/v1/*` routes, SSE streams, and 5 deterministic seed datasets (`CARD-017`)
- [x] **T05-02** Extract `prototypes/tokens/tokens.css` (fluid `rem` scale, color palette, dot status indicators) (`CARD-017`)
- [x] **T05-03** Build all 16 interactive high-fidelity HTML prototype pages under `prototypes/pages/` (`CARD-017`)

## Phase 2: Black-Box E2E Referee Suite (`test-cases/`)

- [x] **T05-04** Implement `test-cases/runner.mjs`, sanitized 1.x SQLite Golden `.db` fixtures (`test-cases/fixtures/db/`), Vault `v1`–`v4` Super-Password Golden Crypto Vectors (`test-cases/fixtures/crypto/`), and core `scenarios/*.yaml` (lossless DB upgrade + backup + downgrade-guard, super-password decryption, cold start, SSE download cancel, concurrent recall during switch, rollback safety, multi-space isolation) (`CARD-018`)
- [ ] **T05-05** Add `test-cases/cli-e2e/` and `test-cases/plugin-rpc/` verifying zero user-feature reduction (all CLI subcommands/TUI/IDE `inject`/legacy `/rpc`/`rsrs mcp`), Windows 100 KB+ UTF-8 JSON HTTP/MCP tests, and reparse-point online cleanup (`CARD-018`)
- [x] **T05-06** Add `test-cases/client2-e2e/` Playwright regression suite validating `en` and `zh` UI rendering (using isolated `fixtures/i18n/`), i18n completeness, and layout invariants (`CARD-018`)

## Phase 3: Monorepo Integration & PR UI Preview

- [x] **T05-07** Land cross-platform `risense-ai/respire/.github/workflows/e2e.yml` pulling `respire-resources/test-cases` against compiled binaries (`CARD-019`)
- [x] **T05-08** Land privilege-separated `ui-preview.yml` (`detect -> record -> publish`) posting bilingual screenshots and MP4 videos to Client2 PRs (`CARD-019`)
- [x] **T05-09** Archive `specs/prototypes-and-e2e/spec.md` into `openspec/specs/` after first green full E2E + UI Preview run

The [CARD-018 closeout](../../../../test-cases/README.md#card-018-acceptance-evidence) records the remaining coverage for T05-05. The [compiled E2E run](https://github.com/risense-ai/respire/actions/runs/45876255034) passed all seven scenarios on Linux, macOS, and Windows. A separate [trusted preview run](https://github.com/risense-ai/respire/actions/runs/45876171656) published and read back both localized screenshots and both video links on the dedicated preview PR.

## Verification Commands

```sh
node test-cases/runner.mjs --runtime-bin <path-to-rsrs-runtime>
npx playwright test --config test-cases/client2-e2e/playwright.config.mjs
```
