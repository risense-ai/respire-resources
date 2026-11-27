# Proposal: 006-multi-agent-automation-workflow

- **Change ID**: `006-multi-agent-automation-workflow`
- **Status**: `archived`
- **Depends On**: `004-ci-guardrails-and-code-slimming`, `005-prototypes-and-e2e-acceptance`

## 1. Why

Even with OpenSpec contracts and E2E suites in place, running ad-hoc single-session AI coding causes three chronic failures:

1. **Self-grading bias**: An Agent writing both implementation and sign-off tends to weaken assertions or ignore edge cases.
2. **Task & dependency collisions**: Multiple Agents working concurrently guess which Issues are unblocked or collide inside clean clones.
3. **Repeat regressions**: Fixed bugs recur when root causes stay buried in chat history instead of becoming automated CI tests.

This Change combines Maker-Checker role isolation, a deterministic CLI, and nightly `LESSONS.md` audits to make the workflow auditable.

## 2. Goals

1. Enforce six distinct roles with strict capability boundaries: Human `Maintainer` + AI roles (`Triager`, `Implementer`, read-only `Verifier`, `Scribe`, `Release Manager`).
2. Complete the deterministic `process/scripts/respire-process.mjs` state machine (`status`, `next`, `claim`, `approve-milestone`, `verify-merge`, `evidence-register`, `roles`) plus `node:test` coverage.
3. Deploy bot-only trusted Evidence registration (`evidence-register.yml`) unlocking downstream DAG Issues automatically upon green `main` merges.
4. Automate periodic `LESSONS.md` audits converting 3x recurring defects into permanent `guardrail` Issues and CI checks.

## 3. Non-Goals

- NEVER delegate product vision, OpenSpec approval, breaking contract exceptions, or final PR merges to AI autonomously.
- NEVER replace deterministic tests and schema validators with subjective LLM-only scoring.

## 4. Acceptance Criteria

1. Implementers claim tasks solely via `respire-process.mjs next` and hand off PRs to fresh read-only Verifier sessions.
2. `verify-merge` enforces Fail-Closed gating (`ci-gate` green + independent Verifier `PASS` + E2E evidence).
3. Nightly/milestone `LESSONS.md` audit produces concrete candidate lessons and flags 3-strike patterns as `guardrail` tasks.
