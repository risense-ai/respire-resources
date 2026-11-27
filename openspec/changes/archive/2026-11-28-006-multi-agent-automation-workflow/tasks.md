# Tasks: 006-multi-agent-automation-workflow

## Phase 1: Role Playbooks & Trusted Allowlist

- [x] **T06-01** Create six-role definitions and one-line dispatch prompts under `process/roles/`
- [x] **T06-02** Create `.github/agents.yml` (`maintainers` + `trusted_bots`) and sync English-only review settings to `risense-ai/respire` (`respire-core` tracked via `CARD-002`)

## Phase 2: Full `respire-process.mjs` & Trusted Bot Evidence *(Promoted & Landed in M1)*

- [x] **T06-03** Extend `process/scripts/respire-process.mjs` with `review-next`, `post-verdict`, `verify-merge` (allowlist + commit status), `evidence-register`, `archive-next`, and `release-check` (promoted to `M1`)
- [x] **T06-04** Add comprehensive `node:test` unit suite (`process/scripts/respire-process.test.mjs`) covering Fail-Closed blocking, DAG dependencies, allowlist validation, and idempotent comments (promoted to `M1`)
- [x] **T06-05** Deploy `.github/workflows/verdict-gate.yml` + `evidence-register.yml` across `respire-resources` and `respire/verify.yml`, and enable Auto-Merge + `verdict-gate` protection (promoted to `M1`)

## Phase 3: Nightly Lessons Audit & End-to-End Dry Run

- [x] **T06-06** Implement periodic `lessons-audit` script/workflow scanning merged `fix:` commits for `LESSONS.md` updates and 3-strike `guardrail` Issues ([CARD-020 audit evidence](https://github.com/risense-ai/respire-resources/issues/7#issuecomment-7223580272))
- [x] **T06-07** Execute one complete end-to-end feature cycle through Triager -> Maintainer Approve -> Implementer -> Read-Only Verifier + UI Preview -> Merge -> Bot Evidence -> Scribe Archive ([CARD-021 evidence](evidence/card-021.md))
- [x] **T06-08** Promote the delta to the [canonical agent workflow spec](../../../specs/agent-workflow/spec.md)

## Verification Commands

```sh
node process/scripts/respire-process.mjs status
node --test process/scripts/respire-process.test.mjs
node process/scripts/validate-openspec.mjs
```
