# Delta Spec: Monorepo Isolation & Release Bridge (`003`)

## ADDED Requirements

### Requirement: Physically Isolated Component Build Manifests
`apps/core`, `apps/runtime`, `apps/cli`, and `apps/client2` inside `risense-ai/respire` MUST each own independent build manifests and lockfiles; a root `Cargo.toml` workspace combining `apps/*` is strictly forbidden, and `apps/cli` MUST NEVER path-depend on `apps/runtime` or `apps/core`.

#### Scenario: Dependency isolation guardrail check
- **GIVEN** CI runs `node scripts/check-guardrails.mjs`
- **WHEN** a PR introduces a root `Cargo.toml` or adds `../runtime` inside `apps/cli/Cargo.toml`
- **THEN** the guardrail script MUST fail immediately and block merge

### Requirement: Path-Filtered CI with Single Branch Gate
`ci.yml` MUST detect changed paths per PR and execute build/test jobs ONLY for affected components (`apps/core` triggers `core-ci` + `runtime-ci`; `apps/runtime`, `apps/cli`, and `apps/client2` trigger only themselves), while `ci-gate` aggregates results treating skipped jobs as passing.

#### Scenario: PR modifying only Client2
- **GIVEN** a PR edits files solely under `apps/client2/`
- **WHEN** GitHub Actions runs `ci.yml`
- **THEN** `client2-ci` SHALL run and pass, `core-ci` / `runtime-ci` / `cli-ci` MUST report `skipped`, and `ci-gate` MUST succeed

### Requirement: Component Tag Releases & Legacy/NPM Release Fan-Out
Releases MUST trigger per component via `runtime-vX.Y.Z`, `cli-vX.Y.Z`, and `client2-vX.Y.Z` tags; during transition, `release.yml` MUST automatically mirror identical artifacts, metadata manifests, and NPM packages to the frozen legacy repositories while preserving `model-bge-m3-ort-v1`.

#### Scenario: Publishing a new Runtime release
- **GIVEN** Maintainer pushes tag `runtime-v2.5.0` on `risense-ai/respire`
- **WHEN** `release.yml` finishes building and hashing targets
- **THEN** CI MUST publish `runtime-v2.5.0` on `risense-ai/respire` and mirror identical tarballs and `runtime-build-<triple>.json` to `risense-ai/respire-runtime` tag `v2.5.0`
