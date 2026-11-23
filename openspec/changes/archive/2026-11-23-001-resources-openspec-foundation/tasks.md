# Tasks: 001-resources-openspec-foundation

## Phase 1: Repository & OpenSpec Skeleton (Completed)

- [x] **T01-01** Initialize `D:\sources\repos-new\gh\1memory\respire-resources` with `README.md`, `AGENTS.md`, and `LESSONS.md`
- [x] **T01-02** Create `openspec/config.yaml`, `openspec/ROADMAP.md`, `openspec/AGENT_EXECUTION_GUIDE.md`, and Changes `001`–`006`
- [x] **T01-03** Create `process/roles/*`, `process/scripts/validate-openspec.mjs`, and `.github/workflows/validate.yml`
- [x] **T01-04** Publish public repository `risense-ai/respire-resources` on GitHub

## Phase 2: English-Only Conversion, GitHub Governance & Project Sync

- [x] **T01-06** Create aligned Milestones (`M1`–`M6`), 17 process/area labels, and 20 DAG-linked orchestration Issues across `risense-ai/respire-resources` and `risense-ai/respire`
- [x] **T01-08** Enable `main` branch protection on `risense-ai/respire-resources` (`validate-openspec`) and `risense-ai/respire` (`ci-gate`)
- [x] **T01-10** Convert all docs, specs, scripts, templates, and GitHub Issues to strict English-only and enforce Zero-CJK scanning in CI
- [x] **T01-05** Sync org-level GitHub Project v2 board (`CARD-001`): `Respire Transformation (001-006)` live at `https://github.com/orgs/risense-ai/projects/1` with all 20 M1–M6 cards synced and `CARD-001` closed
- [x] **T01-07** Perform pre-open-source secret/license audit of `respire-core` (for publication under **Respire Noncommercial License 1.0** inside `risense-ai/respire/apps/core/`, preserving third-party notices while keeping legacy `risense-ai/respire-core` private) and sync `.coderabbit.yaml` + Issue/PR templates (`CARD-002`)
- [x] **T01-09** Archive Change `001` by merging `specs/governance/spec.md` into `openspec/specs/governance/spec.md` once Phase 2 closes

Closeout: [CARD-001](https://github.com/risense-ai/respire-resources/issues/1) and [CARD-002](https://github.com/risense-ai/respire-resources/issues/2) are closed. The Core pre-publication audit and template sync were accepted with a CONDITIONAL Verifier verdict. This does not publish Core source or change the legacy repository visibility.

## Verification Commands

```sh
node process/scripts/validate-openspec.mjs
node process/scripts/respire-process.mjs status
gh api repos/risense-ai/respire-resources/branches/main/protection --jq '.required_status_checks.contexts'
gh api repos/risense-ai/respire/branches/main/protection --jq '.required_status_checks.contexts'
```
