# Tasks: 006-multi-agent-automation-workflow

## Phase 1: Role Playbooks & Trusted Allowlist

- [x] **T06-01** Create six-role definitions and one-line dispatch prompts under `process/roles/`
- [x] **T06-02** Create `.github/agents.yml` (`maintainers` + `trusted_bots`) and sync English-only `coderabbit.yaml` to `risense-ai/respire` (`respire-core` tracked via `CARD-002`)

## Phase 2: Full `respire-process.mjs` & Trusted Bot Evidence

- [ ] **T06-03** Extend `process/scripts/respire-process.mjs` (beyond existing `status`/`next`/`claim`/`approve-milestone`/`roles`) with `verify-merge` and `evidence-register` (`CARD-020`)
- [ ] **T06-04** Add comprehensive `node:test` unit suite (`process/scripts/respire-process.test.mjs`) covering Fail-Closed blocking, DAG dependencies, allowlist validation, and idempotent comments (`CARD-020`)
- [ ] **T06-05** Deploy `.github/workflows/evidence-register.yml` across `respire-resources` and `respire` (`CARD-020`)

## Phase 3: Nightly Lessons Audit & End-to-End Dry Run

- [ ] **T06-06** Implement periodic `lessons-audit` script/workflow scanning merged `fix:` commits for `LESSONS.md` updates and 3-strike `guardrail` Issues (`CARD-020`)
- [ ] **T06-07** Execute one complete end-to-end feature cycle through Triager -> Maintainer Approve -> Implementer -> Read-Only Verifier + UI Preview -> Merge -> Bot Evidence -> Scribe Archive (`CARD-020`)
- [ ] **T06-08** Archive `specs/agent-workflow/spec.md` into `openspec/specs/`

## Verification Commands

```sh
node process/scripts/respire-process.mjs status
node --test process/scripts/respire-process.test.mjs
node process/scripts/validate-openspec.mjs
```
