# Multi-Agent Cold-Start Execution Guide

> **Goal**: ANY newly started AI Agent or harness MUST be able to read this file and drive `001`–`006` or Day-2 feature, bugfix, and review work directly via `process/scripts/respire-process.mjs` with zero prior conversation context. See **[FEATURE_LIFECYCLE.md](FEATURE_LIFECYCLE.md)** for feature/bugfix recipes and **[../process/roles/oneline.md](../process/roles/oneline.md)** for concise one-line role prompts.

---

## 1. Local & GitHub Repository Map

All working clones live under `D:\sources\repos-new\gh\1memory\`:

| Directory | GitHub Repository | Role & Boundaries |
| --- | --- | --- |
| **`respire-resources/`** | `risense-ai/respire-resources` | **SSOT Hub** (OpenSpec, OpenAPI 3.1, HTML prototypes, E2E suites, orchestration CLI) |
| **`respire/`** | `risense-ai/respire` | **Open-Source Monorepo** (`apps/core`, `apps/runtime`, `apps/cli`, `apps/client2`, `packages/runtime-sdk-*`) |
| **`respire-core/`** | `risense-ai/respire-core` | **Legacy Source** (auditing for open-source migration into `respire/apps/core` via `CARD-002` / `CARD-013`) |
| **`respire-runtime/`** | `risense-ai/respire-runtime` | **Migration Source** (freezes source writes after `003`; Release mirror only) |
| **`respire-cli/`** | `risense-ai/respire-cli` | **Migration Source** (freezes source writes after `003`; Release/NPM mirror only) |
| **`respire-client2/`** | `risense-ai/respire-client2` | **Migration Source** (freezes source writes after `003`; Release mirror only) |

---

## 2. Mandatory 6-Step Agent Execution Protocol

1. **Run environment preflight & select the next task deterministically (NEVER pick tasks ad-hoc)**:
   ```sh
   cd respire-resources
   node process/scripts/respire-process.mjs preflight # Verify tools, gh auth & sibling clones
   node process/scripts/respire-process.mjs sync      # Refresh agent:ready DAG labels & Project #1
   node process/scripts/respire-process.mjs status    # View M1-M6 Milestone & DAG status
   node process/scripts/respire-process.mjs next      # Pick the single next READY card (Fail-Closed)
   ```
   - If `next` exits with code `2` (waiting for `spec:approved` or `needs:human`), **STOP immediately** and ask the Maintainer.
2. **Claim and lock the Issue**:
   ```sh
   node process/scripts/respire-process.mjs claim <CARD-XXX>
   ```
   - Adds `agent:in-progress` and removes `agent:ready` on GitHub.
3. **Read all governing documents**:
   - `respire-resources/AGENTS.md` (including the **Strict English-Only** rule outside UI i18n paths), `LESSONS.md`, and `openspec/changes/<change-id>/{proposal,design,tasks,specs/*/spec}.md`.
4. **Create an isolated Git Worktree (NEVER modify clean `main` clones)**:
   - Run the exact `worktree_command` printed by `next`, e.g.:
     `git -C ../respire worktree add ../.worktrees/<card-id>/respire -b feat/<card-id>`
   - NEVER commit feature work into legacy `respire-runtime`, `respire-cli`, `respire-client2` repos.
5. **Implement atomically & run local gates**:
   - Keep code files **≤ 600 lines**, OpenSpec `.md` files **≤ 400 lines**, Rust non-test code free of `.unwrap()`/`.expect()`, and **zero CJK characters outside UI i18n paths**.
   - Run `node process/scripts/validate-openspec.mjs` (in `respire-resources`) and `node scripts/check-guardrails.mjs` (in `respire`) plus component unit tests.
6. **Open a Milestone-linked PR & hand off to an independent Verifier**:
   - Attach the **exact GitHub Milestone** from the card, include **`Fixes <owner/repo>#<issue>`** in the PR body, and paste real command outputs.
   - Run `node process/scripts/respire-process.mjs mark-verify <CARD-XXX>` to move the Issue from `agent:in-progress` to `agent:verify`.
   - Hand off verification to a **fresh read-only Verifier session** (`process/roles/verifier.md`). Never grade your own PR.
   - Once the Verifier posts a trusted `PASS` verdict (`verdict-gate` turns green) and the Maintainer approves/auto-merges the PR, `evidence-register.yml` automatically posts Evidence, closes the linked Issue, and unlocks downstream `agent:ready` cards (`node process/scripts/respire-process.mjs complete <CARD-XXX> --pr <PR_URL>` remains as manual/cross-repo fallback when `RESPIRE_BOT_TOKEN` is unset).

---

## 2B. Self-Dispatching Reviewer / Verifier Protocol (Independent Session)

1. **Discover open PRs awaiting review deterministically**:
   ```sh
   cd respire-resources
   node process/scripts/respire-process.mjs review-next
   ```
   - Scans `risense-ai/respire-resources`, `risense-ai/respire`, and `risense-ai/respire-core` for non-draft open PRs lacking a fresh `<!-- respire-verdict: ... head=<sha> -->` marker matching the current PR head SHA (prioritizing `agent:verify` cards and passing CI).
   - If `review-next` exits with code `2`, **STOP immediately** (no PRs require review).
2. **Audit read-only & publish structured verdict**:
   - Inspect diff, `ci-gate`/`validate-openspec`/`check-guardrails` checks, linked OpenSpec scenarios, UI Preview artifacts, and `test-cases/` outputs without editing product code or Issues.
   - Publish verdict anchored to the exact head SHA:
     ```sh
     node process/scripts/respire-process.mjs post-verdict <owner/repo#pr> --verdict <PASS|CONDITIONAL|REJECT> --summary "<concrete evidence>"
     ```
   - Before merging, Maintainers verify CI + fresh verdict parity with `node process/scripts/respire-process.mjs verify-merge <owner/repo#pr>`.

---

## 3. STOP & Escalate Conditions

An Agent MUST halt immediately and report to the Maintainer if:
- `respire-process.mjs next` returns exit code `2` (`WAITING_APPROVAL` or `NEEDS_HUMAN`);
- An API edit triggers `oasdiff breaking` failures;
- A guardrail or CI check fails twice consecutively;
- Any requirement appears to violate the 4-layer boundaries (`apps/core` I/O, `apps/cli` server crates, `apps/client2` SQLite).

---

## 4. Ready-to-Copy One-Line Dispatch Prompts

Full role cheat sheet in **[../process/roles/oneline.md](../process/roles/oneline.md)** or via `node process/scripts/respire-process.mjs roles --one-line`:

- **Autonomous Implementer**:
  > Read `respire-resources/AGENTS.md` and `respire-resources/openspec/AGENT_EXECUTION_GUIDE.md`. Inside `respire-resources`, run `node process/scripts/respire-process.mjs next`. If it exits with code 2, stop and report the blocker. Otherwise claim the card, create a worktree under `../.worktrees/`, implement strictly in English (no CJK outside UI i18n), pass local guardrails/tests, open a Milestone-linked PR with `Fixes <repo>#<num>`, and run `mark-verify`. Do not self-verify.
- **Independent Read-Only Verifier (fresh session)**:
  > You are the read-only Verifier (`respire-resources/process/roles/verifier.md`). Modify no code or Issues. Run `node process/scripts/respire-process.mjs review-next` (stop on exit 2), inspect the PR diff, CI checks, matching OpenSpec scenarios, and `test-cases/` outputs, then run `post-verdict <owner/repo#pr> --verdict <PASS|CONDITIONAL|REJECT> --summary "<concrete evidence>"` (mark unavailable checks `UNTESTED`).
