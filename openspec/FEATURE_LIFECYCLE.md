# Day-2 Feature, Bugfix & Change Lifecycle

> This playbook defines how ANY agent or contributor ships new features, fixes bugs, updates UI/CLI screens, and adds model engines **after `001`–`006` baseline governance is active**—without drifting back into ad-hoc patches.

---

## 1. Standard Eight-Step Autonomous Loop

```text
1. Maintainer Intent or Bug Report (user outcome or broken spec behavior)
2. Triager Agent drafts OpenSpec Change (`proposal.md`, `design.md`, `tasks.md`, `specs/<domain>/spec.md`)
   OR opens a bug card referencing the violated spec + updates `openapi.yaml` / `prototypes/` / `test-cases/`
3. [HUMAN FRONT GATE] Maintainer reviews spec + HTML prototype -> adds `spec:approved`
4. Implementer / Bugfixer Agent claims card via `respire-process.mjs next` -> works in `.worktrees/<id>/`
5. CI runs Path-Filtered build/tests + Guardrails + Zero-CJK + `ui-preview.yml` (if Client2 UI)
6. Implementer runs `respire-process.mjs mark-verify <CARD>` -> Fresh Read-Only Verifier Agent discovers via `review-next`, audits & posts verdict (`post-verdict`)
7. [HUMAN BACK GATE] Maintainer runs `verify-merge <owner/repo#pr>`, inspects UI Preview + verdict -> merges PR -> runs `complete`
8. Scribe Agent merges delta spec into `openspec/specs/`, archives Change, and logs lessons (`LESSONS.md`);
   Release Manager pushes independent component tag (`runtime-v*`, `cli-v*`, or `client2-v*`) when releasing
```

---

## 2. Change, Bugfix & Review Recipes

### Recipe A: Adjusting a Client2 UI Screen or Interaction

- **Example**: Redesigning the Models card layout or adding a filter bar on `workspace.html`.
- **Execution Chain**:
  1. **Spec + Prototype First (`respire-resources`)**: Triager creates `openspec/changes/NNN-<slug>/` updating `prototypes/pages/<page>.html` and `prototypes/mock-api/` deterministic fixtures (using fluid `rem` tokens and isolated `i18n` keys for `en` + `zh`).
  2. **Front-Gate Approval**: Maintainer opens `prototypes/pages/<page>.html` directly in a browser, confirms look/states, and sets `spec:approved`.
  3. **Isolated Implementation (`risense-ai/respire`)**: Implementer edits strictly inside `apps/client2/` (consuming existing `packages/runtime-sdk-go` / SSE streams—never importing `go-sqlite3` or adding Go state machines) and updates `test-cases/client2-e2e/`.
  4. **Path-Filtered CI & Visual Verification**: `ci.yml` runs ONLY `client2-ci`, `guardrails`, and `ui-preview.yml` (`core-ci`, `runtime-ci`, and `cli-ci` skip in 0s). `ui-preview.yml` posts fresh `en` and `zh` Playwright screenshots + MP4 recording onto the PR.
  5. **Visual Sign-Off & Independent Release**: Maintainer reviews PR screenshots/MP4 + Verifier `PASS` -> merges -> Release Manager ships `client2-vX.Y.Z` independently of CLI/Runtime.

### Recipe B: Adjusting a CLI Subcommand or TUI Screen

- **Example**: Adding a structured filter flag to `rsrs recall` or a new view inside `rsrs tui`.
- **Execution Chain**:
  1. **Contract Check First**: Check if `contracts/runtime-api/openapi.yaml` already supports the required capability; if a new backend parameter is needed, land the Runtime API Change first (additive change passing `oasdiff breaking`), then regenerate `packages/runtime-sdk-rs`.
  2. **Thin Client Implementation (`risense-ai/respire`)**: Implementer modifies `apps/cli/` (`<= 600` lines/file), negotiates capability flags via `GET /v1/health` (fallback cleanly if connected to an older Runtime), and adds black-box tests in `test-cases/cli-e2e/`.
  3. **Prohibited Shortcuts**: NEVER pull server/storage crates into `apps/cli/Cargo.toml`, NEVER compare version strings, and NEVER add stop-Runtime/`Paused` logic.
  4. **CI & Release**: `ci.yml` executes ONLY `cli-ci` + `guardrails`; Release Manager ships `cli-vX.Y.Z` (including NPM `@rsrsai/*` + legacy `respire-cli` mirror).

### Recipe C: Supporting a New Embedding Model or Hardware Engine in Runtime

- **Example**: Adding support for a new multilingual model family or a verified hardware accelerator.
- **Execution Chain**:
  1. **Spec & Catalog Design (`respire-resources`)**: Define model ID, minimal asset manifest (no redundant `.onnx` on CPU-only ORT), SHA-256 checksums, immutable source URLs + mirror templates, and engine availability flags (`available: bool`, `reason`) in the Change delta spec.
  2. **Pure Core vs. Runtime Split (`risense-ai/respire`)**:
     - If tokenization/pooling/tensor math requires kernel support, update `apps/core/` first (strictly in-memory buffers only; `core-ci` + `runtime-ci` run together automatically).
     - Register the model entry inside `apps/runtime/` single authoritative catalog (`GET /v1/models/catalog`), obeying **1x streaming SHA-256**, foreground preemption, non-blocking `model.switch`, and clean `pending` rollback.
  3. **Zero Client Hardcoding**: `apps/cli` and `apps/client2` MUST discover the new model dynamically via `/v1/models/catalog` and `/v1/models/active-assets` with zero hardcoded model lists or client-side downloaders.
  4. **Verification & Release**: Verifier runs `test-cases/scenarios/` model switch, cancel, and concurrent `recall` tests; Release Manager ships `runtime-vX.Y.Z`.

### Recipe D: Fixing a Bug (Regression-First Bugfix Workflow)

- **Case 1 — Lightweight Bugfix (Existing Spec Already Defines Correct Behavior)**:
  1. **Bug Card (`respire-card`)**: Open or claim an Issue citing the exact violated `openspec/specs/<domain>/spec.md` § section and reproduction steps (no new 4-file OpenSpec Change needed when contracts and UX do not change). Wait for Maintainer `spec:approved`.
  2. **Fail-First Regression Test**: Inside `../.worktrees/<card-id>/<repo>`, write a failing unit test or `test-cases/` reproduction scenario FIRST, confirm it fails before patching, then apply the minimal English-only fix (`<= 600` lines/file, preserving all 4-layer boundaries).
  3. **Local Gates & Hand-Off**: Verify the new regression test + `check-guardrails.mjs` + path-filtered component tests pass, open a Milestone-linked PR with `Fixes <repo>#<num>` and pasted failure->pass evidence, and run `respire-process.mjs mark-verify <CARD>`.
  4. **`LESSONS.md` 3-Strike Audit**: Scribe logs non-trivial root causes in `LESSONS.md`; if the failure pattern reaches **>= 3 occurrences**, file a `guardrail` Issue to add an automated static or CI parity check.
- **Case 2 — Spec-Changing Bugfix (Contract, Behavior, or UI Flow Changes)**:
  - Treat as a standard Change (`openspec/changes/NNN-<slug>/` with delta spec + `oasdiff` / prototype update) through the 8-step loop above.

### Recipe E: Self-Dispatching Task & Review Discovery

Any agent session can self-dispatch cleanly with zero external orchestration:
1. **Implementer / Bugfixer Loop**: `respire-process.mjs sync` -> `next` (exit `2` = stop) -> `claim <CARD>` -> `.worktrees/` fix/feature + tests -> PR -> `mark-verify <CARD>`.
2. **Independent Reviewer / Verifier Loop**: `respire-process.mjs review-next` (exit `2` = stop) -> read-only diff, CI, OpenSpec, UI Preview, & `test-cases/` audit -> `post-verdict <owner/repo#pr> --verdict <PASS|CONDITIONAL|REJECT> --summary "..."`.
3. **Maintainer Merge Loop**: `respire-process.mjs verify-merge <owner/repo#pr>` -> merge PR -> `complete <CARD> --pr <PR_URL>` (automatically closes card & unlocks downstream DAG cards).
