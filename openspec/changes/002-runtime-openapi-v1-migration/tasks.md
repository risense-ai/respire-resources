# Tasks: 002-runtime-openapi-v1-migration

## Phase 1: Contract Hardening & Cross-Language SDK Pipeline

- [ ] **T02-01** Complete remaining OpenAPI 3.1 schemas (backup import/export, mirror fallback error codes, local Bearer auth scheme) in `contracts/runtime-api/openapi.yaml` and validate syntax (`CARD-003`)
- [ ] **T02-02** Add golden JSON fixtures under `contracts/runtime-api/fixtures/` covering `ProblemDetails`, `OperationEvent`, `MemoryItem`, and `ModelCatalogResponse` (`CARD-003`)
- [ ] **T02-03** Implement `scripts/sync-contracts.mjs` and SDK generators in `risense-ai/respire` outputting `packages/runtime-sdk-{rs,go,ts}` with round-trip serialization tests (`CARD-004`)
- [ ] **T02-04** Wire `oasdiff breaking` and `sync.lock.json` verification into CI (`CARD-003`, `CARD-004`)

## Phase 2: Runtime Server Implementation (Dual-Port Single Domain Core)

- [ ] **T02-05** Expose domain service traits/functions and implement `GET /v1/health` (`capabilities`), `GET /v1/status/light`, and RFC 9457 error middleware (`CARD-010`)
- [ ] **T02-06** Implement async `operations` manager, `GET /v1/operations/{id}`, `DELETE /v1/operations/{id}`, and `GET /v1/operations/{id}/events` SSE stream (`CARD-010`)
- [ ] **T02-07** Implement all V1 resource handlers (`/v1/memories*`, `/v1/diary`, `/v1/organize/*`, `/v1/models/*`, `/v1/spaces*`, `/v1/sync/*`, `/v1/host/*`) (`CARD-010`)
- [ ] **T02-08** Collapse legacy JSON-RPC / `cli.exec` dispatch into a frozen `<200`-line shim delegating to the same domain core (`CARD-010`)
- [ ] **T02-09** Add Runtime route-parity test (registered routes === `openapi.yaml` `paths`) and legacy RPC regression tests (`CARD-010`)

## Phase 3: Client & Plugin Migration

- [ ] **T02-10** Migrate `apps/cli` onto `packages/runtime-sdk-rs` + `capabilities` negotiation (`CARD-011`)
- [ ] **T02-11** Migrate `apps/client2` onto `packages/runtime-sdk-go` + SSE streams, eliminating 700ms `/api/state` polling and `cli.exec` argv tables (`CARD-011`)
- [ ] **T02-12** Update `rsrs mcp` and plugin docs/examples; pass Windows 100 KB+ UTF-8 JSON HTTP & MCP E2E tests (`CARD-011`)
- [ ] **T02-13** Archive `specs/runtime-api/spec.md` into `openspec/specs/runtime-api/spec.md` once all tasks pass Verifier sign-off

## Verification Commands

```sh
oasdiff breaking origin/main:contracts/runtime-api/openapi.yaml contracts/runtime-api/openapi.yaml
node process/scripts/validate-openspec.mjs
```
