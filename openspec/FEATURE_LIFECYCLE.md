# Day-2 Feature & Change Lifecycle

> This playbook defines how Respire ships new features, UI changes, CLI/TUI changes, and new model engines **after `001`–`006` baseline governance is active**—without ever drifting back into ad-hoc patches.

---

## 1. Standard Eight-Step Autonomous Loop

```text
1. Maintainer Intent (1 sentence describing user outcome)
2. Triager/Spec Codex drafts OpenSpec Change (`proposal.md`, `design.md`, `tasks.md`, `specs/*/spec.md`)
   + updates `openapi.yaml` / `prototypes/` / `test-cases/` stubs + opens Milestone Issue(s)
3. [HUMAN FRONT GATE] Maintainer reviews spec + HTML prototype -> adds `spec:approved`
4. Implementer Codex claims card via `respire-process.mjs next` -> works in `.worktrees/<id>/`
5. CI runs Path-Filtered build/tests + Guardrails + Zero-CJK + `ui-preview.yml` (if Client2 UI)
6. Implementer runs `respire-process.mjs mark-verify <CARD>` -> Fresh Read-Only Verifier Codex audits & runs `test-cases/`
7. [HUMAN BACK GATE] Maintainer inspects UI Preview screenshots/MP4 + Verifier `PASS` verdict -> merges PR
8. Scribe Codex merges delta spec into `openspec/specs/`, archives Change, and logs lessons (`LESSONS.md`);
   Release Manager pushes independent component tag (`runtime-v*`, `cli-v*`, or `client2-v*`) when releasing
```

---

## 2. Three Concrete Change Recipes

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
