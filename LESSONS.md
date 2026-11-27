# LESSONS.md — Incident Ledger & Automated Guardrail Graduation

> **Repeated failures MUST graduate into deterministic CI checks and regression tests.**

## Graduation Rule (3-Strike Policy)

1. Whenever a production defect, CI regression, or multi-round PR rejection occurs, record an entry below (Symptom, Root Cause, Guardrail Target, Status).
2. **Once the same failure pattern appears ≥ 3 times** (or violates a hard architectural boundary), it MUST be converted into an automated CI check or permanent regression test (`guardrail` label).

---

## Historical Baseline Lessons

### L-001: Legacy Server Crates & Duplicate Contracts Lingering Inside CLI
- **Symptom**: After splitting repositories, `respire-cli` kept ~54,500 lines of legacy server code (`runtime/`, `crates/{core-sdk,app,app-domain,storage,crypto}`, and 14 `server`-gated files) plus 674 duplicated contract fixtures alongside `respire-runtime`.
- **Root Cause**: Splitting repos without dependency bans or build-manifest isolation allowed convenient cross-layer coupling to persist.
- **Guardrail Target (`003` / `004`)**: Enforce isolated `Cargo.toml` manifests per app in `risense-ai/respire` and run `scripts/check-guardrails.mjs` to block server/storage/cross-app dependencies in `apps/cli`.
- **Status**: CLI dependency guardrails are active. Change `004` is archived, and Change `003` remains active.

### L-002: Client2 Re-implementing 11k Lines of State Machines & Importing WASM SQLite
- **Symptom**: `respire-client2` imported `github.com/ncruces/go-sqlite3` (WASM) to inspect Runtime databases directly and wrote 52 Go files (~11,267 lines) duplicating account, space, model, and migration state machines.
- **Root Cause**: Runtime lacked typed HTTP/OpenAPI transaction APIs, tempting the desktop host to bypass Runtime.
- **Guardrail Target (`002` / `004`)**: Expose `/v1/host/transactions/*`, `/v1/spaces/*`, and `/v1/models/*` in `openapi.yaml`; fail CI whenever `apps/client2/go.mod` contains any SQLite dependency.
- **Status**: The `go.mod` ban is active in `check-guardrails.mjs`. `CARD-016` is closed.

### L-003: 4x–7x Back-to-Back Full-File SHA-256 Hashing on Model Load & Download
- **Symptom**: Multi-gigabyte embedding models were hashed up to 7 times across download, staging, publish, cold load, and startup checks, causing memory spikes, lock contention, and stalls.
- **Root Cause**: No single-pass streaming verification contract existed across layers, and no regression test asserted hash pass count or memory bounds.
- **Guardrail Target (`004` / `005`)**: Enforce single-pass streaming SHA-256 on Runtime load/download, drop redundant `.onnx` requirement in CPU-owned `.ort` mode, and assert budgets in E2E tests.
- **Status**: `CARD-014` and `CARD-018` are closed. The [canonical guardrails](openspec/specs/architecture-guardrails/spec.md) retain the single-pass verification requirement.

### L-004: Plugins & Clients Shelling Out via CLI Arguments Failing on Windows
- **Symptom**: Passing prompts, memories, and batch payloads through `cli.exec` / subprocess argv triggered Windows `CreateProcess` command-line length limits, quote escaping corruption, and encoding issues.
- **Root Cause**: Missing standard local HTTP REST + SSE contract forced external tools to tunnel RPCs through CLI arguments.
- **Guardrail Target (`002` / `005`)**: Route all clients and plugins over OpenAPI 3.1 HTTP or `rsrs mcp` stdio, backed by mandatory Windows 100 KB+ UTF-8 JSON E2E tests.
- **Status**: The [canonical Runtime API spec](openspec/specs/runtime-api/spec.md) retains the transport requirement. `CARD-018` records Windows HTTP and MCP evidence.

### L-005: Unbounded CI Workflow & One-Off Script Sprawl
- **Symptom**: `respire-cli` accumulated 23 workflows (5,745 lines of YAML) and 125 scripts (~39k lines) from ad-hoc release recovery patches, slowing PR feedback and hiding real failures.
- **Root Cause**: No workflow budget cap and no path-filtered Monorepo gate.
- **Guardrail Target (`003` / `004`)**: Cap `.github/workflows/*.yml` at 5 core pipelines in `check-guardrails.mjs` and route per-app CI via `detect-changes` + `ci-gate`.
- **Status**: Active in `risense-ai/respire`.

### L-006: Non-English Text Drifting into Docs, Scripts, and Comments
- **Symptom**: Mixed-language prose made repository instructions harder to follow and reviews less consistent.
- **Root Cause**: No automated scanner prevented non-English prose from being committed outside UI i18n resources.
- **Guardrail Target (`001` / `004`)**: Enforce Zero-CJK scanning across both `respire-resources` and `respire`, exempting only UI i18n paths.
- **Status**: Active in `validate-openspec.mjs` and `check-guardrails.mjs`.

### L-007: Audit Closeout Is Not Publication

- **Observation**: The private Core template and pre-publication audit merged after a `CONDITIONAL` Verifier verdict. The remaining template-path limitation applied only to the private archive.
- **Practice**: Keep audit and publication evidence separate. Preserve third-party notices, keep legacy Core private, and use the published noncommercial license only for the new public repositories.
- **Status**: [CARD-002](https://github.com/risense-ai/respire-resources/issues/2) is closed. This records one governance lesson, not a new automated gate.
