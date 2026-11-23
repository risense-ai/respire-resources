# Delta Spec: Prototypes, E2E Suite & Visual UI Preview (`005`)

## ADDED Requirements

### Requirement: High-Fidelity HTML Prototypes as UI Truth Source
Every new desktop screen or major interaction redesign MUST provide offline-interactive HTML prototypes under `respire-resources/prototypes/pages/` wired to deterministic `prototypes/mock-api/` scenarios before frontend implementation begins.

#### Scenario: Reviewing a redesigned Models page
- **GIVEN** an OpenSpec Change proposes modifying the Client2 Models page
- **WHEN** Maintainer opens `prototypes/pages/models.html` in a browser
- **THEN** the prototype SHALL interactively demonstrate downloading, SSE progress, failed rollback, and online uninstall states

### Requirement: Out-of-Repo Black-Box E2E & Windows Regression Suite
`respire-resources/test-cases/` MUST verify compiled `apps/runtime`, `apps/cli`, `apps/client2`, and plugin HTTP/MCP workflows independently of implementation repositories, including Windows-specific edge cases.

#### Scenario: Windows large UTF-8 plugin payload regression
- **GIVEN** compiled `rsrs-runtime` and `rsrs` binaries running on Windows
- **WHEN** `test-cases/plugin-rpc` submits a 100 KB+ UTF-8 JSON payload (loaded from isolated i18n fixtures) over HTTP and `rsrs mcp`
- **THEN** the payload MUST persist and recall completely with zero CLI truncation or encoding corruption

#### Scenario: Legacy 1.x SQLite database & legacy plugin backward-compatibility regression
- **GIVEN** sanitized real 1.x SQLite `.db` fixtures under `test-cases/fixtures/db/` (containing encrypted memories, pending `sync_outbox` rows, `review_history`, `access_grants`, and `query_log`) alongside legacy `/rpc` and `rsrs` CLI test scripts
- **WHEN** `test-cases/` launches the newly compiled `rsrs-runtime` and `rsrs` binaries against copies of those legacy `.db` fixtures
- **THEN** Runtime SHALL back up and migrate each database losslessly with zero row/sync loss, succeed on idempotent restart, and serve existing legacy `/rpc`, CLI flag, and `rsrs mcp` plugin calls without breaking compatibility

### Requirement: Automated Client2 PR Visual Preview
Any PR altering `apps/client2` frontend or desktop UI assets MUST run Playwright against Mock Runtime in a tokenless sandbox and embed `en`/`zh` screenshots or MP4 recordings into the PR description.

#### Scenario: UI styling PR opened on Client2
- **GIVEN** an Implementer opens a PR modifying `apps/client2` model card layout
- **WHEN** `ui-preview.yml` completes
- **THEN** the PR body SHALL contain updated bilingual screenshots and MP4 recordings for rapid visual sign-off
