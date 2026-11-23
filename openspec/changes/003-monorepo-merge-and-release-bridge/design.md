# Design: 003-monorepo-merge-and-release-bridge

## 1. Monorepo Directory & Isolation Layout

```text
risense-ai/respire/
├── .github/workflows/
│   ├── ci.yml                # detect-changes -> core/runtime/cli/client2 CI -> ci-gate
│   ├── verify.yml            # guardrails / Zero-CJK / sync.lock.json checks
│   ├── e2e.yml               # cross-app E2E from respire-resources/test-cases
│   └── release.yml           # component-prefixed tag builds + legacy/NPM Release Fan-Out
├── apps/
│   ├── core/                 # Independent Cargo.toml + Cargo.lock (open-source pure engine)
│   ├── runtime/              # Independent Cargo.toml + Cargo.lock
│   ├── cli/                  # Independent Cargo.toml + Cargo.lock (never depends on runtime/core)
│   └── client2/              # Independent go.mod + go.sum
├── packages/                 # Auto-generated runtime-sdk-{rs,go,ts} (never hand-edited)
├── contracts/                # sync.lock.json + synced openapi.yaml
└── scripts/check-guardrails.mjs
```

**Why never share a top-level Cargo Workspace?** A shared `Cargo.toml` ties `apps/core`, `apps/runtime`, and `apps/cli` into one lockfile and dependency graph, breaking independent builds and inviting accidental cross-layer imports.

## 2. Filtered History Import (`git filter-repo`)

Prerequisite: install `git-filter-repo` if missing (`pip install --user git-filter-repo`, `brew install git-filter-repo`, or `apt-get install git-filter-repo`). Run inside isolated temporary clones (never modify clean local master clones):

1. **`respire-runtime` -> `apps/runtime/`**:
   `git filter-repo --to-subdirectory-filter apps/runtime --invert-paths --path contracts/ --path .github/workflows/`
2. **`respire-cli` -> `apps/cli/`** (drop ~54.5k legacy server lines & 23 workflows during import):
   Invert-exclude `runtime/`, `crates/{core-sdk,app,app-domain,storage,crypto}/`, the 14 `server`-gated files (`crates/commands/src/{admission,bench,engine,lexical,lexical_cache,model_install,network,recall_select,rpc_serve,rpc_worker,runtime_http,skill,sync_flow,util}.rs`), `crates/commands/src/{model_progress,model_granite}.rs`, `cli/src/network.rs`, `contracts/`, `.github/workflows/`, and `.worktrees/`, then `--to-subdirectory-filter apps/cli`.
3. **`respire-client2` -> `apps/client2/`**:
   `git filter-repo --to-subdirectory-filter apps/client2 --invert-paths --path .github/workflows/ --path .worktrees/`
4. **`respire-core` -> `apps/core/`** (ONLY after `CARD-002` secret/license audit passes):
   Import audited pure algorithm crates into `apps/core/` under **Respire Noncommercial License 1.0** (preserving third-party notices; legacy `risense-ai/respire-core` stays private archive) and retire closed-source binary SDK tarball/cache ceremony (`build-core-sdk`, `fetch-core-sdk`, `private-sdk-cache`).

## 3. Path-Filtered CI & `ci-gate`

- `detect-changes` outputs booleans `core`, `runtime`, `cli`, `client2`, `contracts`:
  - `apps/core/**` triggers `core-ci` AND `runtime-ci` (since Runtime links Core), while `cli-ci` and `client2-ci` skip in 0s;
  - `apps/client2/**` triggers ONLY `client2-ci` (plus `ui-preview` in `005`);
  - `apps/cli/**` triggers ONLY `cli-ci`;
  - `apps/runtime/**` triggers ONLY `runtime-ci`;
  - `contracts/**` or `packages/**` triggers affected component checks + `contract-check`.
- `ci-gate` (`if: always()`) requires every dependency to finish `success` or `skipped` and serves as the sole branch protection status check.

## 4. Component Tag Releases & Legacy/NPM Fan-Out

| Tag Prefix | Monorepo Release | Legacy Mirrors & Package Registries |
| --- | --- | --- |
| **`runtime-vX.Y.Z`** | `risense-ai/respire` (`runtime-vX.Y.Z`) | Mirror 8 target `.tar.gz` + `runtime-build-<triple>.json` (schema-2) to `risense-ai/respire-runtime` (`vX.Y.Z`) |
| **`cli-vX.Y.Z`** | `risense-ai/respire` (`cli-vX.Y.Z`) | Publish `rsrs-cli` + `@rsrsai/{linux-x64-gnu,linux-x64,linux-arm64-gnu,linux-arm64,macos-x64,macos-arm64,win32-x64,win32-arm64}` to NPM + mirror to `risense-ai/respire-cli` (`vX.Y.Z`); preserve `model-bge-m3-ort-v1` |
| **`client2-vX.Y.Z`** | `risense-ai/respire` (`client2-vX.Y.Z`) | Mirror 6-platform installers/archives, `SHA256SUMS`, `client-updates.json`, `release-notes.md` to `risense-ai/respire-client2` (`vX.Y.Z`) |

Updaters in `apps/cli` (`runtime_fetch.rs`) and `apps/client2` (`releases.go`) switch to **new Monorepo prefixed tags primary, legacy repos fallback** before legacy mirrors are eventually retired.

## 5. Risks & Rollback

- **Risk**: Secret or third-party license residue in `respire-core` history prior to publishing `apps/core/`.
- **Mitigation**: Gate `apps/core` import on `CARD-002` full secret/license scan (`gitleaks`/Respire Noncommercial License 1.0 + third-party notice check) before merging into `risense-ai/respire`; keep legacy `risense-ai/respire-core` private archive so historical CI logs remain private.
- **Rollback**: Legacy repositories remain frozen and intact throughout migration.
