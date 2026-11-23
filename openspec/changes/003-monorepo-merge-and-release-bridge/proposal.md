# Proposal: 003-monorepo-merge-and-release-bridge

- **Change ID**: `003-monorepo-merge-and-release-bridge`
- **Status**: `proposed`
- **Depends On**: `001-resources-openspec-foundation`, `002-runtime-openapi-v1-migration`

## 1. Why

Splitting `respire-core`, `respire-runtime`, `respire-cli`, and `respire-client2` into separate repositories created heavy coordination overhead: duplicated contracts (674 files), 54,500+ lines of server crates stranded in CLI, private Core binary SDK tarball/cache workflows, and 23 unpruned CLI workflows.

With the decision to **open-source `respire-core`** alongside the three open-source clients/runtime, all four product components belong inside **`risense-ai/respire`** (`apps/core`, `apps/runtime`, `apps/cli`, `apps/client2`) while preserving strict **build isolation** (touching `apps/client2` MUST NEVER compile Rust) and **zero-downtime legacy Release/NPM mirrors** for existing users.

> **Status Update**: Archived repo renamed to `risense-ai/respire-back`; public Monorepo `risense-ai/respire` is created and live (`T03-01` done).

## 2. Goals

1. Import `respire-runtime`, `respire-cli` (filtered to drop 54k legacy server lines and 23 old workflows), `respire-client2`, and post-audit open-source `respire-core` into `risense-ai/respire` with preserved Git history.
2. Keep **physically isolated dependency manifests** (`apps/core`, `apps/runtime`, `apps/cli`, `apps/client2` each own independent lockfiles; no root `Cargo.toml`).
3. Run **Path-Filtered CI + `ci-gate`** so modifying a single component skips unaffected apps in 0 seconds without blocking branch protection.
4. Implement **component-scoped Tag releases + Legacy/NPM Release Fan-Out** (`runtime-vX.Y.Z`, `cli-vX.Y.Z`, `client2-vX.Y.Z`) mirroring to the frozen legacy repos until users transition.
5. Retire closed-source Core SDK tarball/cache workflows once `apps/core` lands openly in-tree (keeping `apps/core` pure in-memory via `contracts/core-abi/`).

## 3. Non-Goals

- Does not fold `respire-resources` into `risense-ai/respire` (SSOT specs/prototypes/E2E stay separate).
- Does not delete legacy GitHub Releases or static assets (`model-bge-m3-ort-v1`).
- Does not flip legacy `risense-ai/respire-core` visibility to public; audited Core source is published under **Respire Noncommercial License 1.0** (preserving third-party notices) in `risense-ai/respire/apps/core/` after `CARD-002`, while legacy `respire-core` stays private archive.

## 4. Acceptance Criteria

1. All imported `apps/*` build and test independently inside `risense-ai/respire`.
2. Single-app PRs verify untouched components report `skipped` while `ci-gate` succeeds.
3. Component tag builds publish to `risense-ai/respire`, NPM (`cli`), and legacy mirror repositories with matching `SHA256SUMS` and metadata JSON.
