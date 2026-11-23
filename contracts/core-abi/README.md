# core-abi — Core and Runtime Boundary Contract

This directory defines the version-independent FFI/ABI boundary between **`apps/core`** (pure in-memory computation engine, now transitioning to open-source inside `risense-ai/respire`) and **`apps/runtime`** (host persistence & service layer).

## Core Invariants

1. **Pure In-Memory Computation**: `apps/core` accepts caller-provided buffers, explicit config, and opaque index bytes via host callbacks; it NEVER performs filesystem, SQLite, keyring, or network I/O.
2. **Forward & Backward Compatibility**: Wire DTOs MUST ignore unknown fields so any cross-version pairing passes seamlessly.
3. **Single-Source Convergence**: During `003`/`004`, `respire_core.h`, `request.schema.json`, `response.schema.json`, and `core-api.json` consolidate here while retiring closed-source binary SDK tarball distribution.
