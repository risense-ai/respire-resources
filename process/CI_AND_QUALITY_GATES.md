# CI, Regression Gates & How Sebas + Magpie Practices Land in Respire

> Concrete engineering constraints ensuring Respire scales at high AI commit velocity without reverting into bloated codebases or brittle workflows.

---

## 1. Borrowing Matrix: `ShiningRay/sebas` + `yetone/magpie` -> Respire

| Proven Practice | Origin Repo | Exact Respire Implementation |
| --- | --- | --- |
| **Spec-first § specs + WBS/DAG** | `sebas` | `openspec/specs/` + `openspec/changes/001..006/` + 20 GitHub Issues with `<!-- respire-card -->` `depends_on` DAG |
| **Deterministic lifecycle & review CLI** | `sebas` (`sebas-process`) | `process/scripts/respire-process.mjs` (`status`, `next`, `claim`, `mark-verify`, `review-next`, `post-verdict`, `verify-merge`, `evidence-register`, `archive-next`, `release-check`, `complete`, `approve-milestone`, Fail-Closed exit codes `0/1/2`) |
| **Maker-Checker hard merge gate** | `sebas` (`Implementer` vs `Verifier`) | `process/roles/{implementer,verifier}.md` + `.github/agents.yml` allowlist + required `verdict-gate` status check + Auto-Merge + Bot `evidence-register.yml` |
| **Trusted identity allowlist** | `sebas` (`.github/agents.yml`) | `.github/agents.yml` (`maintainers`, `trusted_bots`, optional `trusted_reviewers`, `enforce_distinct_reviewer`) |
| **Single-file line cap + doc anchors** | `sebas` (`<=400` lines, anchor checks) | `validate-openspec.mjs` (`<=400` lines in `openspec/`, Markdown link/anchor verification, scripts `<=600` lines), `check-guardrails.mjs` (`<=600` lines/code file), `AGENTS.md` |
| **Strict path-scoped CodeRabbit rules** | `sebas` (`.coderabbit.yaml`) | `process/templates/coderabbit.yaml` (`assertive`, blocking workflow, per-app Rust/Go/JS/Workflow rules, `en-US`) |
| **Subsystem docs + semantic PR before/after** | `magpie` (`docs/subsystems/`) | `PULL_REQUEST_TEMPLATE.md` mandatory Before/After behavior + linked OpenSpec specs |
| **PR automated UI Preview + Mock seeds** | `magpie` (`.github/ui-preview/`) | `prototypes/mock-api/` + privilege-separated `ui-preview.yml` (`detect -> record -> publish`) |
| **Nightly `LESSONS.md` -> 3-strike CI tests** | `magpie` (`LESSONS.md` + parity tests) | `LESSONS.md` 3-strike policy -> automated `guardrail` Issues + route/CLI/i18n parity tests |
| **Worktree isolation & shard fast CI** | `magpie` (`worktree --detach`, shards) | Mandatory `../.worktrees/<card>/<repo>` + `ci.yml` path-filtered `detect-changes` & `ci-gate` |

---

## 2. Hard CI Gates Enforced on Every PR

| Repository | Workflow | Mandatory Gates |
| --- | --- | --- |
| **`respire-resources`** | `validate.yml` + `verdict-gate.yml` + `evidence-register.yml` | OpenSpec 4-artifact completeness, `MUST`/`SHALL` + `GIVEN`/`WHEN`/`THEN`, `<= 400`-line doc cap, doc link/anchor integrity, `respire-process.test.mjs`, Zero-CJK, required `verdict-gate` + post-merge `evidence-register` |
| **`respire`** | `ci.yml` (`ci-gate`) + `verify.yml` | `detect-changes` path isolation; no root `Cargo.toml`; `apps/core` zero-I/O crates; `apps/cli` zero server crates; `apps/client2` zero SQLite drivers; `sync.lock.json` SHA-256 parity; `<= 5` workflows; Zero-CJK; `verdict-gate` + `evidence-register`; per-app unit tests |
| **`respire`** *(E2E / Release)* | `e2e.yml` + `ui-preview.yml` + `release.yml` | 3-OS black-box E2E (`test-cases/`), Windows 100 KB+ UTF-8 & reparse-point checks, `en`/`zh` Playwright screenshots/MP4, component tag Fan-Out parity |

---

## 3. Anti-Flake & Anti-Regression Discipline

1. **No skipped/relaxed assertions**: Failing tests MUST NOT be muted or relaxed to make CI green; real environment gaps require explicit `UNTESTED` reporting by the Verifier.
2. **Route & CLI parity guard**: Runtime unit tests verify registered HTTP routes match `openapi.yaml` 1:1; CLI tests verify capability negotiation rather than version checks.
3. **Commit & PR hygiene**: `git show --stat HEAD` MUST contain only files belonging to the claimed card—never carry edits from another worktree or session.
