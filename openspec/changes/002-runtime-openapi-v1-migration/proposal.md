# Proposal: 002-runtime-openapi-v1-migration

- **Change ID**: `002-runtime-openapi-v1-migration`
- **Status**: `proposed`
- **Depends On**: `001-resources-openspec-foundation`

## 1. Why

`respire-runtime` currently exposes ad-hoc JSON-RPC methods (`assets.status`, `cli.exec`, `model.catalog`, `model.switch`, `runtime.status`, etc.) with no machine-readable OpenAPI schema and no push event stream:

1. `respire-cli` and `respire-client2` hand-write duplicate DTOs and brittle `cli.exec` argv translation tables, causing multi-repo drift whenever endpoints evolve.
2. Without SSE streaming, `respire-client2` polls `/api/state` every 700ms and fires redundant `/api/health` checks.
3. Legacy external plugins invoke business commands via subprocess CLI arguments, hitting Windows `CreateProcess` command-line length limits, quoting bugs, and encoding corruption.

Because older CLI, Client2, and plugin releases remain deployed in the wild, the OpenAPI 3.1 migration MUST provide a clean backward-compatible transition.

## 2. Goals

1. Establish `contracts/runtime-api/openapi.yaml` (OpenAPI 3.1 + SSE) as the **sole interface contract** between `apps/runtime` and all consumers (`apps/cli`, `apps/client2`, `rsrs mcp`, plugins).
2. Cover all V1 domains: `health` (with `capabilities`), `status/light`, `memories`, `diary`, `organize`, `models`, `operations` (`202 Accepted` + SSE + `DELETE` cancel), `spaces`, `sync`, and `host` transactions.
3. Standardize non-2xx responses on **RFC 9457 `ProblemDetails`**.
4. Automate typed SDK generation (`packages/runtime-sdk-rs`, `runtime-sdk-go`, `runtime-sdk-ts`) plus `oasdiff breaking` CI gates.
5. Implement a single-domain-core / dual-port Runtime (REST/SSE primary + `<200`-line frozen legacy JSON-RPC shim) so older clients keep working during transition.
6. Migrate plugins off Windows CLI argument passing onto local OpenAPI HTTP or `rsrs mcp` stdio.

## 3. Non-Goals

- Does not alter the in-process FFI contract (`contracts/core-abi/`) between `apps/core` and `apps/runtime`.
- Does not delete legacy JSON-RPC/`cli.exec` handlers immediately; deprecation and removal wait for a separate post-transition approval.

## 4. Acceptance Criteria

1. `contracts/runtime-api/openapi.yaml` validates cleanly and passes `oasdiff breaking` gates on every PR.
2. Runtime `/v1/*` and legacy `/rpc` handlers share one domain layer, with zero broken existing CLI/Client2 RPC compatibility tests.
3. Generated Rust, Go, and TypeScript SDKs pass round-trip golden JSON tests.
4. Windows E2E confirms 100 KB+ UTF-8 JSON payloads succeed via HTTP OpenAPI and `rsrs mcp` without CLI truncation.
