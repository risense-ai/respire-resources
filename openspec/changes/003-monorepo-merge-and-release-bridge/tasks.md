# Tasks: 003-monorepo-merge-and-release-bridge

## Phase 1: Scaffold & Filtered History Import

- [x] **T03-01** Rename archived repo to `risense-ai/respire-back`, create public `risense-ai/respire` with path-filtered `ci.yml`, `verify.yml`, and `scripts/check-guardrails.mjs`
- [ ] **T03-02** Lock `main` writes on legacy `respire-runtime`, `respire-cli`, and `respire-client2` repos and post migration notices while preserving Releases and `model-bge-m3-ort-v1` (`CARD-005`)
- [ ] **T03-03** Run `git filter-repo` in isolated clones to import `apps/runtime/` (`CARD-006`), filtered `apps/cli/` dropping ~54k legacy server lines & 23 workflows (`CARD-007`), and `apps/client2/` (`CARD-008`)
- [ ] **T03-04** Fix relative paths and verify `apps/runtime`, `apps/cli`, and `apps/client2` compile and pass unit tests independently (`CARD-006`–`CARD-008`)

## Phase 2: Path-Filtered CI, Open-Source Core Import & Release Fan-Out

- [ ] **T03-05** Wire real Rust/Go test steps into `ci.yml` (`core-ci`, `runtime-ci`, `cli-ci`, `client2-ci`) while keeping `ci-gate` as sole branch check (`CARD-006`–`CARD-008`)
- [ ] **T03-06** Verify path isolation with single-app test PRs confirming skipped jobs do not block `ci-gate` (`CARD-008`)
- [ ] **T03-07** Configure minimal-permission `release` Environment and `release.yml` triggered by `runtime-v*`, `cli-v*`, `client2-v*` tags (`CARD-009`)
- [ ] **T03-08** Implement Release Fan-Out mirroring binaries, `runtime-build-<triple>.json`, `SHA256SUMS`, `client-updates.json`, and `@rsrsai/*` NPM packages (`CARD-009`)
- [ ] **T03-09** Update `apps/cli` and `apps/client2` self-updaters to read `risense-ai/respire` prefixed tags first with legacy repo fallback (`CARD-009`)
- [ ] **T03-10** After `CARD-002` security/license audit completes, import open-source `apps/core` into `risense-ai/respire` and retire private Core SDK download/cache steps (`CARD-013`)
- [ ] **T03-11** Archive `specs/monorepo-ci-release/spec.md` into `openspec/specs/` after canary release verification

## Verification Commands

```sh
node scripts/check-guardrails.mjs
cargo check --manifest-path apps/runtime/Cargo.toml --locked
cargo check --manifest-path apps/cli/Cargo.toml --locked
cd apps/client2 && go vet ./... && go test ./...
```
