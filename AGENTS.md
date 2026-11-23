# AGENTS.md — Global AI Engineering Constitution for Respire

> This document is the **supreme engineering constitution** across all Respire repositories (`risense-ai/respire-resources` and `risense-ai/respire`). Repository-local `AGENTS.md` files may add local build commands or stricter checks, but **MUST NOT weaken any rule defined here**.

---

## 1. Strict English-Only Policy (Hard CI Gate)

1. **English everywhere except UI i18n**: Every specification, document, source file, code comment, script, workflow, commit message, PR description, and GitHub Issue MUST be written in **English**.
2. **Only permitted exception**: Localized user-facing strings (such as Chinese translations) inside dedicated UI i18n files (`**/i18n/**`, `**/i18n.js`, `**/locales/**`, `**/*_zh*.json`, `**/*.zh-CN.*`, `**/test-cases/fixtures/i18n/**`).
3. **CI enforcement**: Both `validate-openspec.mjs` and `check-guardrails.mjs` fail immediately if any CJK character appears outside those explicit i18n paths.

---

## 2. Spec-First Gate (No Unapproved Code)

1. **No work without an OpenSpec Change**: Every new feature, cross-module refactor, contract change, or UI redesign MUST first exist as an OpenSpec Change package in `respire-resources/openspec/changes/<change-id>/` (`proposal.md`, `design.md`, `tasks.md`, `specs/<domain>/spec.md`).
2. **Approval before implementation**: Implementer Agents MUST NOT branch or modify product code until the target Change and GitHub Issue carry Maintainer approval (`spec:approved`).
3. **Contract-First**: `contracts/runtime-api/openapi.yaml` is the single source of truth for Runtime APIs, and `contracts/core-abi/` defines the Core FFI boundary. Hand-written duplicate DTOs across components are forbidden.

---

## 3. Four-Layer Architecture Boundaries (Zero Tolerance)

| Component | Sole Responsibility | Hard Prohibition (Blocks PR) |
| --- | --- | --- |
| **`apps/core`** *(open-source)* | Pure in-memory algorithms & inference (embeddings, ONNX/MLX sessions, hybrid ranking, `deepen_plan`, classification, FFI ABI) | No filesystem, directory, SQLite, keyring, HTTP, or network I/O crates in production code; receives buffers/callbacks from host only |
| **`apps/runtime`** | Sole authoritative control & data plane (SQLite persistence, model catalog, managed downloads/hot-switch, OpenAPI 3.1 + SSE, frozen legacy JSON-RPC shim, account/space transactions) | No Clap secondary CLI parser, no TTY `prompt`, no IDE `inject`, no unpreemptable background write locks |
| **`apps/cli`** | Ultra-thin CLI, TUI, `rsrs mcp` stdio bridge, OS autostart & Runtime binary installer/watchdog | No server/storage crates (`storage`, `core-sdk`, `app`, `axum`), no direct SQLite reads, no stopping Runtime or writing `Paused` for downloads/config/uninstall |
| **`apps/client2`** | Wails desktop shell, tray, OS proxy/keyring bridge, OpenAPI + SSE consumer, WebUI | No SQLite drivers (`go-sqlite3` WASM) in `go.mod`, no Go-side account/space/model state machines, no `cli.exec` argv tables |

---

## 4. Maker-Checker Separation (Independent Verification)

1. **Independent context**: An Implementer Agent MUST NEVER sign off final verification of its own code. Verification MUST be performed by a **read-only Verifier Agent** running in a fresh session/process.
2. **Evidence-only claims**: Every claim MUST cite concrete command output, test logs, HTTP responses, or preview screenshots/videos.
3. **Honest untested reporting**: If an environment lacks hardware/OS coverage (for example macOS or Windows ARM64), mark it explicitly as `UNTESTED` with the reason; never fabricate or relax assertions.
4. **Tool- & Agent-Agnostic Governance**: Repository specs, workflows, and scripts MUST remain agent-agnostic—never commit vendor-specific agent names or session prompts into repository files.

---

## 5. Capability Negotiation & Windows Rules

1. **Negotiate by capabilities, never version strings**: Clients (`apps/cli`, `apps/client2`, plugins) MUST inspect `capabilities` returned by `GET /v1/health` (or legacy health fallback) rather than comparing Runtime version strings.
2. **No Windows CLI argument transport**: Plugins and tools MUST call Runtime over local HTTP OpenAPI 3.1 or `rsrs mcp` stdio—never by concatenating large payloads onto CLI arguments.

---

## 6. Worktree Isolation, File Caps & Commit Hygiene

1. **Worktree isolation**: Never modify or build inside clean `main` clones; work strictly in `../.worktrees/<change-id>/<repo>` branches.
2. **File size caps**:
   - Non-archive Markdown docs under `openspec/` MUST NOT exceed **400 lines**.
   - New or refactored code files (Rust / Go / JS / TS) MUST NOT exceed **600 lines**.
3. **No line-number anchors in docs**: Reference `§` sections, file paths, or symbol names—never brittle source line numbers.
4. **Rust safety**: Never introduce new `.unwrap()` or `.expect()` calls in non-test Rust code.
5. **Commit & PR hygiene**: Use Conventional Commits (`feat(runtime): ...`), attach the matching GitHub Milestone, and include `Fixes <owner/repo>#<issue>` plus real verification output in every PR body.
