# Delta Spec: Runtime OpenAPI 3.1 & Transition Contract (`002`)

## ADDED Requirements

### Requirement: OpenAPI 3.1 as Sole Runtime External Contract
`respire-resources/contracts/runtime-api/openapi.yaml` MUST serve as the sole machine-readable source of truth for `apps/runtime` HTTP REST and SSE APIs; typed client SDKs (`packages/runtime-sdk-{rs,go,ts}`) MUST be generated from it, and hand-written duplicate DTOs across apps are forbidden.

#### Scenario: Adding or modifying a Runtime API field
- **GIVEN** a Change requires a new Runtime request parameter or response field
- **WHEN** an Implementer opens a PR
- **THEN** the PR MUST update `openapi.yaml`, regenerate affected SDKs, and pass `oasdiff breaking` + route-parity checks before merge

### Requirement: Async Operations & SSE Streams Replace High-Frequency Polling
Long-running operations (model downloads, index rebuilds, hot-switching, full sync) MUST return `202 Accepted` with an `operation_id`, stream progress and terminal states via `GET /v1/operations/{id}/events` (`text/event-stream`), and support cooperative cancellation via `DELETE /v1/operations/{id}`.

#### Scenario: Client2 tracks model switch progress via SSE
- **GIVEN** Client2 submits `POST /v1/models/switch` and receives `202 Accepted` with `operation_id`
- **WHEN** Client2 subscribes to `/v1/operations/{id}/events`
- **THEN** Runtime SHALL emit throttled `progress` events followed by `completed` or `failed` (with RFC 9457 `ProblemDetails`), without requiring `/api/state` full-state polling

### Requirement: Capability Negotiation & Legacy JSON-RPC Transition
Runtime MUST advertise supported flags via `capabilities` on `GET /v1/health` (and legacy health endpoints); clients MUST branch solely on `capabilities`, NEVER on version strings, while the frozen legacy JSON-RPC shim continues sharing the single domain core during transition.

#### Scenario: Modern client connects to an older Runtime
- **GIVEN** a modern CLI or Client2 connects to a legacy Runtime that omits `openapi.v1` in `capabilities`
- **WHEN** the client probes health and capabilities
- **THEN** the client MUST NOT crash on version parsing, SHALL fall back to legacy compatible endpoints for simple operations, and SHALL prompt to upgrade Runtime for heavy transactions missing `host.transactions.v1`

#### Scenario: Legacy plugin calls frozen JSON-RPC or existing CLI flags against new Runtime
- **GIVEN** an un-upgraded plugin invoking legacy `/rpc` (`runtime.status`, `model.switch`, `cli.exec`) or existing `rsrs` CLI / `rsrs mcp` commands
- **WHEN** the user upgrades to the new `-dev` or stable `apps/runtime` and `apps/cli`
- **THEN** all existing legacy `/rpc` methods, CLI flags/JSON output contracts, and MCP tool signatures SHALL continue succeeding over the shared domain core without breaking existing integrations

### Requirement: HTTP OpenAPI & MCP Transport for Plugins (No Windows CLI Arg Passing)
Plugins and external integrations MUST communicate with Runtime over local OpenAPI HTTP JSON bodies or `rsrs mcp` stdio rather than passing large business payloads on CLI command lines.

#### Scenario: Plugin stores a 100 KB+ UTF-8 payload on Windows
- **GIVEN** a plugin running on Windows submits > 64 KB of nested UTF-8 text and metadata
- **WHEN** it calls `POST /v1/memories` or the equivalent `rsrs mcp` tool
- **THEN** Runtime SHALL persist and recall the full unmodified payload with zero `CreateProcess` truncation or quoting errors
