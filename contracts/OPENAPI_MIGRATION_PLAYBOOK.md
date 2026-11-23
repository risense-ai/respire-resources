# OpenAPI 3.1 (REST + SSE) Stable Transition Playbook

> Step-by-step zero-downtime cutover from ad-hoc JSON-RPC / `cli.exec` to `contracts/runtime-api/openapi.yaml` across `apps/runtime`, `apps/cli`, `apps/client2`, and external plugins.

---

## 1. Four-Phase Expand-and-Contract Rollout

| Phase | Runtime State | Client & Plugin State | Safety Guarantee |
| --- | --- | --- | --- |
| **Phase 1: Contract & SDKs** *(M2 `CARD-003`, `CARD-004`)* | Legacy `/rpc` unchanged | Generate `packages/runtime-sdk-{rs,go,ts}` + golden JSON tests + `oasdiff` gate | Zero runtime behavioral change |
| **Phase 2: Dual-Port Runtime** *(M2 `CARD-010`)* | Single domain layer exposes BOTH `/v1/*` + SSE (`capabilities: ["openapi.v1", "sse.operations.v1", ...]`) AND frozen `<200`-line `/rpc` shim | Older CLI, Client2, and plugins keep using `/rpc` transparently | Old clients never break; zero duplicated business logic |
| **Phase 3: Client & Plugin Cutover** *(M2 `CARD-011`)* | Serves both `/v1/*` + legacy `/rpc` | CLI, Client2, and `rsrs mcp` switch to OpenAPI SDKs + SSE when `capabilities` advertises `openapi.v1`; delete `cli.exec` tables and 700ms `/api/state` polling | Mixed old/new pairings always work cleanly |
| **Phase 4: Legacy Shim Retirement** *(Future post-transition Change)* | Remove frozen `/rpc` & `cli.exec` after adoption window closes | Only OpenAPI 3.1 + SSE supported | Requires dedicated deprecation OpenSpec Change |

---

## 2. Capability Negotiation Matrix (Zero Version Comparisons)

Clients MUST probe `GET /v1/health` first (treating HTTP `404` as a legacy Runtime missing `openapi.v1`) and branch solely on `capabilities`:

| Scenario | Client Probing Behavior | Fallback / User Action |
| --- | --- | --- |
| **New Client + New Runtime** | `GET /v1/health` -> `200`, `capabilities` includes `openapi.v1`, `sse.operations.v1`, `host.transactions.v1` | Full OpenAPI SDKs + SSE progress streams |
| **New Client + Legacy Runtime** | `GET /v1/health` -> `404`, falls back to legacy `runtime.status` | Basic reads/writes run via thin compatibility adapter; unsupported heavy transactions (`host.transactions.v1`) prompt user to upgrade Runtime (NEVER revive Go/CLI state machines) |
| **Legacy Client + New Runtime** | Calls legacy `/rpc` (`runtime.status`, `model.switch`, `cli.exec`) | Handled by Runtime's frozen `<200`-line `/rpc` shim over the same domain core |

---

## 3. SSE & Async Operation Lifecycle Contract

1. **Start**: `POST /v1/models/switch`, `POST /v1/models/downloads`, `POST /v1/sync/trigger`, `POST /v1/organize/deepen/apply` immediately return `202 Accepted` with `{ operation_id, status: "pending" | "running" }` (never rejected as unconfirmed).
2. **Stream**: Client subscribes to `GET /v1/operations/{operationId}/events` (`text/event-stream`). Runtime emits throttled `progress` events and terminal `completed`, `failed` (with RFC 9457 `ProblemDetails`), or `cancelled`.
3. **Reconnect & Cancel**: On network/webview reconnect, client queries `GET /v1/operations/{operationId}` to rehydrate snapshot before re-subscribing; cancel sends `DELETE /v1/operations/{operationId}` (202 Accepted) and triggers safe cleanup of `pending` state.

---

## 4. Plugin Migration Off Windows CLI Arg Passing

- Runtime writes its loopback discovery descriptor (`{ base_url, pid, auth_token_ref, capabilities }`).
- Plugins send structured JSON via `packages/runtime-sdk-ts` (`POST /v1/memories`, `POST /v1/memories/recall`) or `rsrs mcp` stdio—eliminating Windows 32 KB `CreateProcess` limits and shell-quoting bugs permanently.
