# Design: 002-runtime-openapi-v1-migration

## 1. Single-Core Dual-Port Transition Architecture

Inside `apps/runtime`, HTTP/RPC transport adapters MUST remain strictly separated from domain services:

```text
OpenAPI 3.1 REST (/v1/*) + SSE ──┐
                                  ├──▶ Single Domain Layer ──▶ apps/core (C ABI / Rust crate)
Frozen Legacy JSON-RPC (<200 LoC)┘
```

- **Primary Interface (`/v1/*`)**: Every new capability (managed downloads, SSE progress, SQL-aggregated light status, host auth/space transactions) is added ONLY to `openapi.yaml` and `/v1/*`.
- **Frozen Compatibility Shim (`/rpc`)**: Existing methods stay mapped to the exact same domain service functions in `<200` lines; adding new features or diverging state inside `/rpc` is forbidden.

## 2. Legacy JSON-RPC to OpenAPI 3.1 Mapping

Audited directly from `respire-runtime/crates/commands/src/rpc_serve.rs`:

| Legacy RPC Method | OpenAPI 3.1 Endpoint | Transition Policy |
| --- | --- | --- |
| `runtime.status` / `runtime.result` | `GET /v1/health`, `GET /v1/status/light` | Keep `/rpc` shim during transition; `/v1/health` advertises `capabilities` |
| `assets.status` / `model.catalog` | `GET /v1/models/catalog`, `GET /v1/models/active-assets` | Returns engine `available` flags & active locked paths |
| `model.configure` / `model.prepare` / `model.switch` / `model.resume` | `POST /v1/models/switch`, `POST /v1/models/downloads` | Always returns `202 Accepted` + `operation_id` |
| `model.progress` / `cli.progress` / `index.prepare` | `GET /v1/operations/{id}`, `GET /v1/operations/{id}/events` (SSE) | Clients migrate to SSE; legacy poll kept temporarily |
| `runtime.stop` | Daemon lifecycle endpoint | Never triggered for model downloads, uninstall, or config edits |
| `cli.exec` (memory/diary/organize/spaces/sync/host) | `/v1/memories*`, `/v1/diary`, `/v1/organize/*`, `/v1/spaces*`, `/v1/sync/*`, `/v1/host/*` | Frozen thin `<200`-line argv dispatcher; no new flags allowed |

*(Test-only RPC hooks such as `runtime.test_native_fault`, `test_worker_hold`, and `test_worker_lifecycle` remain scoped behind `#[cfg(test)]` and excluded from `openapi.yaml`.)*

## 3. Uniform Errors & Capability Negotiation

- **RFC 9457 `ProblemDetails`**: All non-2xx responses return `application/problem+json` (`{ type, title, status, detail, code, instance, retryable }`).
- **Capability Negotiation Only**: Clients probe `GET /v1/health` (falling back to legacy `runtime.status` on `404`) and branch strictly on `capabilities` flags (`openapi.v1`, `sse.operations.v1`, `model.catalog.v2`, `model.active_assets`, `model.managed_download`, `host.transactions.v1`), NEVER on version strings.

## 4. SDK Codegen & Route-Parity Gate

| Generated Package (`risense-ai/respire`) | Codegen Toolchain | Primary Consumer |
| --- | --- | --- |
| `packages/runtime-sdk-rs/` | `progenitor` or `openapi-generator` (`rust`) + `utoipa` checks | `apps/cli` & Runtime contract parity |
| `packages/runtime-sdk-go/` | `oapi-codegen` (`-package runtimesdk`) | `apps/client2` sole backend client |
| `packages/runtime-sdk-ts/` | `openapi-typescript` + `openapi-fetch` | Client2 WebUI, plugins, Playwright E2E |

- **Breaking-Change Gate**: `oasdiff breaking origin/main:contracts/runtime-api/openapi.yaml contracts/runtime-api/openapi.yaml`.
- **Route Parity Test**: `apps/runtime` unit tests load `openapi.yaml` and fail if registered router paths drift from `paths`.

## 5. Eliminating Windows CLI Command-Line Limits for Plugins

Runtime writes a discovery file (`{ base_url, pid, auth_token_ref, capabilities }`). Plugins migrate to `packages/runtime-sdk-ts` (local HTTP JSON bodies) or `rsrs mcp` stdio. Existing `rsrs` CLI flags remain intact for backward compatibility while delegating internally to `runtime-sdk-rs`.

## 6. Risks & Rollback

- **Risk**: Generator quirks between Rust and Go for OpenAPI 3.1 nullable/union types.
- **Mitigation**: Restrict `openapi.yaml` to a generator-verified schema subset validated by cross-language golden JSON round-trip tests (`T02-02`, `T02-03`).
- **Rollback**: `/v1/*` routes sit cleanly alongside `/rpc`; capability flags allow immediate client fallback if an endpoint regresses.
