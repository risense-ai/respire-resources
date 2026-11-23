# Six-Role Collaboration & Permissions Matrix

> Modeled on `ShiningRay/sebas` **Maker-Checker separation**: **the human Maintainer owns only front-gate approval and back-gate final merge**, while planning, coding, read-only verification, archiving, and mechanical releases run across isolated AI roles.

## Role Overview

| Role | Actor | Permitted Scope | Forbidden Actions | Guide |
| --- | --- | --- | --- | --- |
| **Maintainer** | **Human** | Full repo admin, Change/Milestone approvals, final PR merge, release tags | — | — |
| **Triager / Spec** | AI | Draft/update `openspec/changes/*`, triage Issue labels & DAG links | Approving Changes (`spec:approved`), editing product code | [triager.md](triager.md) |
| **Implementer** | AI | Edit code in `.worktrees/<id>/`, write unit tests, open Milestone PRs | Self-verifying, touching clean clones, bypassing OpenSpec | [implementer.md](implementer.md) |
| **Verifier** | AI (**fresh read-only session**) | Inspect PR diff, run `test-cases/` E2E, post structured verdict | Modifying code/Issues, relaxing assertions, hiding `UNTESTED` | [verifier.md](verifier.md) |
| **Scribe** | AI | Archive verified Changes into `openspec/specs/`, maintain `LESSONS.md` | Altering product source logic or weakening specs | [scribe.md](scribe.md) |
| **Release Manager** | AI | Push Maintainer-specified component tags, verify legacy/NPM Fan-Out | Inventing version numbers or shipping over failing CI | [release-manager.md](release-manager.md) |

---

## One-Line Dispatch Prompts (Copy & Paste)

- **Implementer**:
  > Read `respire-resources/AGENTS.md`, `openspec/AGENT_EXECUTION_GUIDE.md`, and `process/roles/implementer.md`. Run `node process/scripts/respire-process.mjs next` inside `respire-resources`; if it exits 2, stop and report. Otherwise claim the card, work in `../.worktrees/` strictly in English (no CJK outside UI i18n), pass guardrails, open a Milestone-linked PR with `Fixes <repo>#<num>`, and never self-verify.
- **Verifier (launch in a NEW read-only session)**:
  > You are Respire's read-only Verifier (`process/roles/verifier.md`). Modify zero files or Issues. Inspect the PR diff, CI checks, matching OpenSpec scenarios, and `test-cases/` runs, then issue a `PASS`, `CONDITIONAL`, or `REJECT` verdict anchored to concrete outputs (mark skipped items `UNTESTED`).
- **Triager**:
  > Read `process/roles/triager.md` and `openspec/ROADMAP.md`. Triage Issues, draft OpenSpec 4-file Change packages in English, and check DAG metadata; never add `spec:approved` or edit product code.
- **Scribe**:
  > Read `process/roles/scribe.md` and `LESSONS.md`. Archive approved & merged Changes into `openspec/specs/`, update `ROADMAP.md` and `LESSONS.md` in English, and ensure `validate-openspec.mjs` passes.
- **Release Manager**:
  > Read `process/roles/release-manager.md`. Given Maintainer's component and version tag (`runtime-v*`, `cli-v*`, `client2-v*`), verify green `main` CI, push the tag, and confirm new, legacy mirror, and NPM artifacts match `SHA256SUMS`.
