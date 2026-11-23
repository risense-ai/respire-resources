# Design: 006-multi-agent-automation-workflow

## 1. Six-Role Collaboration Topology

Detailed role playbooks live under `process/roles/`. Human Maintainer controls ONLY the **front gate** (approving OpenSpec/Milestones/prototypes) and **back gate** (final PR merge and release tag numbers); every intermediate step runs deterministically across isolated AI roles:

- **Process-level Maker-Checker split**: Implementers execute inside `.worktrees/`; after CI turns green, a **fresh read-only Verifier** audits the diff, runs `test-cases/`, and posts a structured `PASS` / `CONDITIONAL` / `REJECT` verdict.

## 2. Deterministic CLI `respire-process.mjs` Specification

Modeled on `sebas-process`, exit codes are strict and Fail-Closed:
- `0` — Success / READY card selected;
- `1` — Invalid arguments, missing metadata, or verification failure (Fail-Closed);
- `2` — `blocked` or `needs:human` (awaiting Maintainer approval, manual action, or upstream dependencies).

| Subcommand | Purpose | Fail-Closed Rule |
| --- | --- | --- |
| `status` | Summarize `M1`–`M6` Milestones and all `respire-card` Issues | Errors out if zero orchestration cards exist |
| `next [--json]` | Select highest-priority `READY` card (`M1`->`M6`, then Card ID) | Exits `2` unless `spec:approved` is set, `needs:human` absent, and ALL `depends_on` Issues closed |
| `claim <card>` | Lock card (`+agent:in-progress -agent:ready`) | Rejects unless card status is strictly `READY` |
| `approve-milestone <M*\|all>` | Maintainer helper toggling `spec:proposed` -> `spec:approved` | Evaluates `depends_on` before adding `agent:ready` |
| `verify-merge <pr> <issue>` *(T06-03)* | Final pre-merge gate check | Requires green `ci-gate`, independent Verifier `PASS`, zero open `must_fix` |
| `evidence-register <pr>` *(T06-03)* | Bot-only structured Evidence poster | Requires PR merged to `main`, closed Issue, green checks, idempotency |

## 3. Trusted Identity Allowlist & `LESSONS.md` Audit Loop

- `.github/agents.yml` separates `maintainers: [luodaoyi]` and `trusted_bots: [github-actions[bot]]`.
- `evidence-register.yml` triggers after green `main` CI runs and verifies author identity against `.github/agents.yml` before posting structured Evidence comments.
- Periodic audit script scans recent `fix:` and `revert` commits, drafts new `LESSONS.md` entries, and files `guardrail` Issues whenever a failure category hits **≥ 3 occurrences**.

## 4. Risks & Rollback

- **Risk**: Overly strict gates slow urgent production hotfixes.
- **Mitigation**: Maintainer may merge `hotfix/` PRs directly while requiring independent post-merge Verifier review and a `LESSONS.md` update within 24 hours.
