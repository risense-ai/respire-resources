# Design: 006-multi-agent-automation-workflow

## 1. Six-Role Collaboration Topology

Detailed role playbooks live under `process/roles/`. Human Maintainer controls ONLY the **front gate** (approving OpenSpec/Milestones/prototypes) and **back gate** (final PR merge and release tag numbers); every intermediate step runs deterministically across isolated AI roles:

- **Process-level Maker-Checker split**: Implementers execute inside `.worktrees/`; after CI turns green, a **fresh read-only Verifier** audits the diff, runs `test-cases/`, and posts a structured `PASS` / `CONDITIONAL` / `REJECT` verdict.

## 2. Deterministic CLI `respire-process.mjs` Specification

The CLI uses strict, fail-closed exit codes:
- `0` — Success / READY card selected;
- `1` — Invalid arguments, missing metadata, or verification failure (Fail-Closed);
- `2` — `blocked` or `needs:human` (awaiting Maintainer approval, manual action, or upstream dependencies).

| Subcommand | Purpose | Fail-Closed Rule |
| --- | --- | --- |
| `status` | Summarize `M1`–`M6` Milestones and all `respire-card` Issues | Errors out if zero orchestration cards exist |
| `next [--json]` | Select highest-priority `READY` card (`M1`->`M6`, then Card ID) | Exits `2` unless `spec:approved` is set, `needs:human` absent, and ALL `depends_on` Issues closed |
| `claim <card>` | Lock card (`+agent:in-progress -agent:ready`) | Rejects unless card status is strictly `READY` |
| `mark-verify <card>` | Move card to `agent:verify` for independent Verifier | Rejects if Issue is closed |
| `review-next [--json]` | Discover next open non-draft PR lacking fresh head-SHA verdict | Scans `respire-resources`, `respire`, `respire-core`; exits `2` when idle |
| `post-verdict <pr-ref>` | Post `<!-- respire-verdict: <V> head=<sha> -->` comment on open PR | Validates enum (`PASS`/`CONDITIONAL`/`REJECT`) and open PR state |
| `verify-merge <pr-ref>` | Pre-merge CI + verdict gate (`--verdict-only --publish-status`) | Enforces `.github/agents.yml` allowlist, open PR, and matching head-SHA verdict |
| `evidence-register` *(M1)* | Post-merge Bot Evidence, Issue close & DAG/Project #1 sync | Requires merged PR into `main`, linked card, and idempotent `sha=` marker |
| `archive-next [--json]` *(M1)* | Discover completed Changes ready for Scribe archiving | Exits `2` unless 100% of Change cards are closed |
| `release-check <comp> <ver>` *(M1)* | Pre-tag release readiness check on `risense-ai/respire` | Verifies unused tag, green `ci-gate` on `main`, and manifest presence |
| `complete <card>` | Manual fallback to close card, post evidence & resync DAG | Runs `sync` to unlock downstream `agent:ready` cards |
| `approve-milestone <M*\|all>` | Maintainer helper toggling `spec:proposed` -> `spec:approved` | Evaluates `depends_on` before adding `agent:ready` |

## 3. Trusted Identity Allowlist & `LESSONS.md` Audit Loop

- `.github/agents.yml` configures `maintainers`, `trusted_bots` (`github-actions[bot]`), optional `trusted_reviewers`, and `enforce_distinct_reviewer`.
- `verdict-gate.yml` (and `respire/.github/workflows/verify.yml`) evaluates `verify-merge --verdict-only --publish-status` on PRs and verdict comments to drive the required `verdict-gate` commit status + GitHub Auto-Merge.
- `evidence-register.yml` triggers after `main` merges, posts idempotent `<!-- respire-evidence: ... -->` comments, closes linked Issues, and unlocks downstream `agent:ready` cards (optionally using org secret `RESPIRE_BOT_TOKEN` for cross-repo writes and Project #1 updates).
- Periodic audit script (`T06-06`) scans recent `fix:` and `revert` commits, drafts `LESSONS.md` entries, and files `guardrail` Issues whenever a failure category hits **>= 3 occurrences**.

## 4. Risks & Rollback

- **Risk**: Overly strict gates slow urgent production hotfixes.
- **Mitigation**: Maintainer may merge `hotfix/` PRs directly while requiring independent post-merge Verifier review and a `LESSONS.md` update within 24 hours.
