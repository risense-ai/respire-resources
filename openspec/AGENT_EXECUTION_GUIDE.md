# Multi-Agent Cold-Start Execution Guide

> **Goal**: Any newly started AI Agent (Codex / Claude Code / Antigravity / Cursor) MUST be able to read this file and drive `001`–`006` execution directly via `process/scripts/respire-process.mjs` with zero prior conversation context.

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

1. **Select the next task deterministically (NEVER pick tasks ad-hoc)**:
   ```sh
   cd respire-resources
   node process/scripts/respire-process.mjs status   # View M1-M6 Milestone & DAG status
   node process/scripts/respire-process.mjs next     # Pick the single next READY card (Fail-Closed)
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
     `git -C respire worktree add ../.worktrees/<card-id>/respire -b feat/<card-id>`
   - NEVER commit feature work into legacy `respire-runtime`, `respire-cli`, `respire-client2` repos.
5. **Implement atomically & run local gates**:
   - Keep code files **≤ 600 lines**, OpenSpec `.md` files **≤ 400 lines**, Rust non-test code free of `.unwrap()`/`.expect()`, and **zero CJK characters outside UI i18n paths**.
   - Run `node process/scripts/validate-openspec.mjs` (in `respire-resources`) and `node scripts/check-guardrails.mjs` (in `respire`) plus component unit tests.
6. **Open a Milestone-linked PR & hand off to an independent Verifier**:
   - Attach the **exact GitHub Milestone** from the card, include **`Fixes <owner/repo>#<issue>`** in the PR body, and paste real command outputs.
   - Hand off verification to a **fresh read-only Verifier session** (`process/roles/verifier.md`). Never grade your own PR.

---

## 3. STOP & Escalate Conditions

An Agent MUST halt immediately and report to the Maintainer if:
- `respire-process.mjs next` returns exit code `2` (`WAITING_APPROVAL` or `NEEDS_HUMAN`);
- An API edit triggers `oasdiff breaking` failures;
- A guardrail or CI check fails twice consecutively;
- Any requirement appears to violate the 4-layer boundaries (`apps/core` I/O, `apps/cli` server crates, `apps/client2` SQLite).

---

## 4. Ready-to-Copy One-Line Dispatch Prompts

- **Autonomous Implementer**:
  > Read `respire-resources/AGENTS.md` and `respire-resources/openspec/AGENT_EXECUTION_GUIDE.md`. Inside `respire-resources`, run `node process/scripts/respire-process.mjs next`. If it exits with code 2, stop and report the blocker. Otherwise claim the card, create a worktree under `../.worktrees/`, implement the linked OpenSpec tasks strictly in English (no CJK outside UI i18n), pass local guardrails/tests, and open a PR linked to the card's Milestone with `Fixes <repo>#<num>`. Do not self-verify.
- **Independent Read-Only Verifier (fresh session)**:
  > You are the read-only Verifier (`respire-resources/process/roles/verifier.md`). Modify no files or Issues. Inspect the target PR diff, CI checks (`ci-gate`, `validate-openspec`, `check-guardrails`), matching OpenSpec scenarios, and `test-cases/` outputs, then issue a `PASS`, `CONDITIONAL`, or `REJECT` verdict with concrete command evidence (mark anything unavailable as `UNTESTED`).
- **Role Cheat Sheet**: Run `node process/scripts/respire-process.mjs roles --one-line`.
