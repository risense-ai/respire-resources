# Proposal: 001-resources-openspec-foundation

- **Change ID**: `001-resources-openspec-foundation`
- **Status**: `proposed`
- **Owner**: Maintainer (`luodaoyi`)

## 1. Why

Previously, Respire's four code repositories lacked a shared source of truth for specifications, milestone scheduling, and engineering standards. Features went straight to code without contracts, resulting in duplicated DTOs, ~54,500 lines of legacy server code left inside CLI, ~11,267 lines of Go-rewritten state machines in Client2, divergent `AGENTS.md` files, and mixed-language docs.

We must establish `risense-ai/respire-resources` as the central SSOT enforcing OpenSpec gates, strict English-only policy (except UI i18n), aligned GitHub Milestones/Projects, and consistent AI governance.

## 2. Goals

1. Establish `risense-ai/respire-resources` as the SSOT for specs, OpenAPI 3.1 + Core ABI contracts, HTML prototypes, E2E test suites, and process tooling.
2. Enforce the OpenSpec lifecycle: `Propose -> Maintainer Approve -> Apply -> Verify -> Archive`.
3. Enforce a **Strict English-Only Repository Policy** across all documentation, specs, comments, code, scripts, and Issues (exempting only UI i18n translation files/fixtures).
4. Align GitHub Milestones (`M1`–`M6`), process labels, Issue templates, PR templates, branch protection, and organization Project board synchronization.
5. Provide a zero-dependency validator (`process/scripts/validate-openspec.mjs`) enforced on every PR.

## 3. Non-Goals

- Does not modify source code inside the four legacy local repositories (`respire-core`, `respire-runtime`, `respire-cli`, `respire-client2`).
- Does not define detailed API endpoints (`002`) or execute the code import (`003`).

## 4. Acceptance Criteria

1. `node process/scripts/validate-openspec.mjs` exits `0` locally and in GitHub Actions (verifying Change artifacts, `<= 400`-line doc cap, OpenAPI 3.1 baseline, and Zero-CJK outside i18n).
2. `M1`–`M6` Milestones, 17 labels, and `main` branch protection are active on both `respire-resources` and `respire`.
3. Pre-open-source secret/license audit of `respire-core` and template sync (`CARD-002`) plus org Project board sync (`CARD-001`) are ready for execution.
