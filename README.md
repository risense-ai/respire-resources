# respire-resources

**Single Source of Truth (SSOT) for Respire**: centralized home for cross-component OpenSpec specifications, machine-readable contracts (OpenAPI 3.1 + Core ABI), high-fidelity HTML prototypes, language-agnostic E2E test suites, and multi-agent engineering governance.

> **Agent-Agnostic Cold Start**: ANY AI Agent or contributor starts with **[openspec/AGENT_EXECUTION_GUIDE.md](openspec/AGENT_EXECUTION_GUIDE.md)**, **[openspec/FEATURE_LIFECYCLE.md](openspec/FEATURE_LIFECYCLE.md)**, and **[process/roles/oneline.md](process/roles/oneline.md)**. Task claiming (`next`) and PR review discovery (`review-next`) run deterministically via `process/scripts/respire-process.mjs`.

---

## Two-Repository Open-Source Topology

| Repository | GitHub | Visibility | Responsibilities & Hard Boundaries |
| --- | --- | --- | --- |
| **`respire-resources`** (this repo) | `risense-ai/respire-resources` | Public | OpenSpec specs, OpenAPI 3.1 / Core ABI contracts, HTML prototypes, E2E suites, role playbooks, and orchestration scripts |
| **`respire`** (open-source Monorepo) | `risense-ai/respire` | Public | Hosts `apps/core`, `apps/runtime`, `apps/cli`, `apps/client2`, and generated `packages/runtime-sdk-*` with isolated manifests and path-filtered CI |

> **Transition & Licensing Note**: Both `risense-ai/respire-resources` and `risense-ai/respire` (`apps/core`, `apps/runtime`, `apps/cli`, `apps/client2`) are published publicly under **Respire Noncommercial License 1.0** ([LICENSE](LICENSE); commercial terms in [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)), preserving third-party dependency licenses/notices. Audited Core source is published openly inside `risense-ai/respire/apps/core/`, while legacy `risense-ai/respire-core` remains a private historical archive. Historical repositories (`respire-runtime`, `respire-cli`, `respire-client2`) freeze source writes once imported in `003` and act solely as legacy release/NPM distribution mirrors; `risense-ai/respire-back` holds the earlier archived snapshot.

---

## Policy Highlight: Strict English-Only Code & Docs

All documentation, specifications, source code, comments, scripts, workflows, commit messages, PRs, and Issues MUST be written in **English**. Non-English / CJK text is permitted **strictly** inside dedicated UI i18n translation files and i18n test fixtures, enforced automatically by CI (`validate-openspec.mjs` and `check-guardrails.mjs`).

---

## Navigation

- **[openspec/AGENT_EXECUTION_GUIDE.md](openspec/AGENT_EXECUTION_GUIDE.md)** — Cold-start 6-step Agent execution protocol & dispatch prompts
- **[openspec/FEATURE_LIFECYCLE.md](openspec/FEATURE_LIFECYCLE.md)** — Day-2 workflow & recipes for Client2 UI, CLI/TUI, and new Runtime models
- **[openspec/ROADMAP.md](openspec/ROADMAP.md)** — Master `001`–`006` roadmap, dependency DAG, and 20-card Issue table
- **[openspec/config.yaml](openspec/config.yaml)** — OpenSpec schema rules and repository metadata
- **[openspec/specs/](openspec/specs/README.md)** — Canonical archived specifications
- **OpenSpec Change Packages (`001`–`006`)**:
  1. [001-resources-openspec-foundation](openspec/changes/archive/2026-11-23-001-resources-openspec-foundation/proposal.md) — OpenSpec governance, English-only gate, Milestones/Labels, branch protection
  2. [002-runtime-openapi-v1-migration](openspec/changes/archive/2026-11-27-002-runtime-openapi-v1-migration/proposal.md) — OpenAPI 3.1 (REST + SSE), SDK codegen, legacy JSON-RPC bridge, Windows plugin migration
  3. [003-monorepo-merge-and-release-bridge](openspec/changes/003-monorepo-merge-and-release-bridge/proposal.md) — Open-source `apps/core` + `runtime`/`cli`/`client2` monorepo merge, path-filtered CI, and legacy Release Fan-Out
  4. [004-ci-guardrails-and-code-slimming](openspec/changes/archive/2026-11-27-004-ci-guardrails-and-code-slimming/proposal.md) — Anti-regression CI guardrails and 60%+ redundancy elimination across all 4 components
  5. [005-prototypes-and-e2e-acceptance](openspec/changes/archive/2026-11-27-005-prototypes-and-e2e-acceptance/proposal.md) — 16 HTML prototypes, black-box E2E suite (with Windows checks), and Client2 PR UI Preview
  6. [006-multi-agent-automation-workflow](openspec/changes/archive/2026-11-28-006-multi-agent-automation-workflow/proposal.md) — Six-role Maker-Checker workflow, `respire-process` CLI, Bot Evidence, and `LESSONS.md` audits
- **[contracts/](contracts/README.md)** — Canonical API & ABI contracts ([OpenAPI 3.1](contracts/runtime-api/openapi.yaml), [OpenAPI Migration Playbook](contracts/OPENAPI_MIGRATION_PLAYBOOK.md), [Core ABI](contracts/core-abi/README.md))
- **[prototypes/](prototypes/README.md)** — High-fidelity HTML prototypes, [PR UI Preview Spec](prototypes/UI_PREVIEW_SPEC.md), tokens, and Mock Runtime
- **[test-cases/](test-cases/README.md)** — Black-box E2E scenarios & [E2E Acceptance Architecture](test-cases/DESIGN.md)
- **[process/](process/README.md)** — [One-line role prompts](process/roles/oneline.md), [Role playbooks](process/roles/README.md), [CI & Quality Gates](process/CI_AND_QUALITY_GATES.md), templates, and scripts
- **[AGENTS.md](AGENTS.md)** & **[LESSONS.md](LESSONS.md)** — Global AI engineering constitution and lessons ledger

---

## Local Validation

```sh
node process/scripts/validate-openspec.mjs
```
