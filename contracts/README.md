# contracts — Canonical Interface Contracts

This directory serves as the **Single Source of Truth (SSOT)** for Respire's machine-readable contracts. Repositories MUST NOT maintain divergent DTO definitions.

- **[runtime-api/openapi.yaml](runtime-api/openapi.yaml)**: Canonical OpenAPI 3.1.0 specification (REST + SSE) consumed by `apps/runtime`, `apps/cli`, `apps/client2`, MCP, and external plugins (see OpenSpec `002`).
- **[core-abi/README.md](core-abi/README.md)**: Canonical FFI/ABI boundary specification between `apps/core` and `apps/runtime`.
