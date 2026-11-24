# Black-box acceptance

This suite implements the offline part of CARD-018 and provides entry points for
compiled acceptance. Each result names its target. A skipped check contributes
no acceptance evidence.

## Offline commands

Run from the Resources root with Node.js 22 or later.

~~~sh
node test-cases/runner.mjs --mock
node --test test-cases/runner.test.mjs prototypes/mock-api/parity.test.mjs prototypes/mock-api/behavior.test.mjs prototypes/mock-api/gallery.test.mjs
node --test '--test-name-pattern=16 exact|all five|HTTP adapter|direct operation' prototypes/mock-api/server.test.mjs
node process/scripts/validate-openspec.mjs
git diff --check
~~~

The scenario files use JSON syntax, a YAML 1.2 subset. Any language can
read the files without embedding Node.js code. Each step has one action:

- `request` sends `method`, `path`, and optional JSON `body`. Use
  `public: true` for unauthenticated health discovery.
- `subscribe` opens a named operation event stream. `event` reads up to the
  expected event name and fails on an unexpected terminal event or early EOF.
  Progress events can require numeric fields to be `above` a threshold.
- `parallel` starts independent request steps together and waits for them all.
- `cli` runs literal `args` after `--client-only` using the explicit CLI binary.
  Set `format` to `json` or `text` and assert the subprocess `exit` code. Use
  `matches` on `$` to check text output with a case-insensitive, multiline
  regular expression.
- `expect` accepts HTTP `status` and `media`, presence checks, field equality,
  inequality, permitted values and array membership or exclusion.
- `save` captures response fields by name for later use. Dotted selectors
  traverse fields, `*` projects an array, and `$` references the whole body.
  Dollar-brace references use captured values or declared fixture inputs.
  Values interpolated into URLs are individually percent-encoded.

The mock runner advances CARD-017 operation state when a scenario reads a frame.
The Node tests also exercise CARD-017's in-process HTTP adapter, independent SSE
framing, the request-driven cancellation fixture, large MCP message serialization,
and a normal OS temp directory with spaces and a UTF-8 name. These checks
require no TCP connection or installed Respire.
On a host with TCP loopback access, run the full mock/prototype suite
with `node --test test-cases/runner.test.mjs prototypes/mock-api/*.test.mjs`.
The loopback walkthrough uses an actual TCP socket and a Mock Runtime.

## Compiled Runtime and Windows transport

Use explicitly supplied, offline-ready binaries and a known synthetic profile on
a network-isolated test host. A preloaded model case must use only local assets
or a test-owned loopback model source. The runner starts an owned Runtime on OS
loopback, requires its PID to match health, creates a fresh external temp
profile per scenario, and removes the profile after the owned process exits.
Fixture profiles contain regular files and directories. Do not supply installed
profiles, credential files, or live service endpoints.

~~~powershell
node test-cases/runner.mjs --runtime-bin "$RuntimeBin" --cli-bin "$CliBin" --runtime-fixtures "$ScenarioFixtures"
node --test test-cases/plugin-rpc/windows-junction.test.mjs
node test-cases/plugin-rpc/windows.mjs --runtime-bin "$RuntimeBin" --cli-bin "$CliBin" --profile-fixture "$SyntheticProfile"
node test-cases/cli-e2e/smoke.mjs --runtime-bin "$RuntimeBin" --cli-bin "$CliBin" --profile-fixture "$SyntheticProfile"
node test-cases/cli-e2e/smoke.mjs --preflight --runtime-bin "$RuntimeBin" --cli-bin "$CliBin" --profile-fixture "$SyntheticProfile"
node test-cases/cli-e2e/smoke.mjs --released-old --runtime-bin "$OldRuntimeBin" --cli-bin "$OldCliBin" --profile-fixture "$SyntheticProfile"
~~~

The variables are absolute paths. The optional scenario manifest is a JSON object
keyed by case ID. A case can provide a `profile` directory and an `inputs`
object. The CLI and legacy RPC cases each need a `profile` entry, for example
`{"E2E-006":{"profile":"D:/fixtures/card018"},"E2E-007":{"profile":"D:/fixtures/card018"}}`.
The runner copies the source profile separately for each case. E2E-007 uses
the Runtime's own RPC dispatcher and can run with only the Runtime binary.
Both cases report `SKIP` under `--mock`.

Legacy smoke preflight requires the Runtime and synthetic profile paths. It
checks that the supplied binary paths are absolute files and that the profile
is an absolute directory containing only regular files and directories. It
reports `PLANNED` for cases with all inputs and `SKIP` for E2E-006 when the
CLI path is omitted. It reads directory entries only and starts no product
process. Executable identity, build matching, profile provenance, and behavior
require separate evidence.

Use `--released-old` for the baseline with Runtime `v1.0.21-dev.17`
(`1d8a1bda4b6c43ec4df0dad8f4578908e13ba322`) and CLI `v1.0.21-dev.6`
(`425f397db2a64347d3d27fa93db630fad6b9b520`). Both binaries and the
synthetic profile are required. This mode checks `GET /api/health` for
the owned PID, `state: ready`, and `startup_complete: true`. It sends the
same RPC scenario through `POST /api/rpc` and supplies the health scope
for `cli.exec`. The Runtime tag defines these contracts in
`crates/commands/src/runtime_http.rs` and `crates/commands/src/rpc_serve.rs`.
The CLI tag exercises the scoped status request in `cli/tests/net_rpc_http.rs`.
Default compiled checks require `GET /v1/health` and use `POST /rpc` for
the compatibility shim.

The model cases require `downloadModel` (slow local download that
reaches progress), `switchModel` (installed CPU model that stays in flight
during recall), or `rollbackModel` (accepted switch that fails while checking
the prepared local assets), respectively. Cases missing these inputs report
`SKIP`. The cold-start case uses an empty workspace. Model cases need
separate copies of their prepared state.

The Windows transport check launches both binaries with a workspace and
profile reached through a test-owned directory junction. It sends nested
JSON with quotes, backslashes, line breaks, and multibyte text through
`POST /v1/memories` and `rsrs mcp` stdin. It requires each serialized request
to exceed 100 KiB and compares the UTF-8 bytes returned by recall.
The filesystem-only junction check requires a Windows host that permits
junction creation. It writes a synthetic frame through the junction and
verifies that removing the junction leaves the physical target bytes intact.
Both the junction and its target live under a fresh temp directory.

Online model uninstall still needs a compiled CLI or Client2 action and an
offline profile with a known active model and an installed inactive model.
The OpenAPI `GET /v1/models/active-assets` call only reports the loaded assets.
A product acceptance run must invoke the real uninstall action and check
inactive asset removal, active asset preservation, the same Runtime PID,
and the absence of a lingering `Paused` sentinel.

The legacy smoke entry point
runs the same two declarative cases. E2E-006 checks the exit code and status JSON
envelope plus an `inject`-specific usage line. E2E-007 checks HTTP status and the echoed version
and ID, success fields, and command envelope for `runtime.status`,
`model.catalog`, and `cli.exec` with read-only status arguments.
Assertions for the status and catalog payload fields require checked-in legacy
response schemas or reference replies from a pinned release. The OpenAPI
success bodies cover different endpoints.

## Client2 Playwright

Use an already installed `@playwright/test@1.56.1` and a local browser.
For example, run with installed Chrome and a provisioned dependency directory
outside the checkout. Set the two absolute paths to match your host.

~~~powershell
$env:NODE_PATH = 'D:\fixtures\card018-playwright\node_modules'
$env:RESPIRE_E2E_BROWSER_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node test-cases/client2-e2e/run.mjs
~~~

Without an executable override, the launcher uses the Playwright-managed
Chromium installation. Set `RESPIRE_E2E_BROWSER=webkit` for a provisioned
WebKit installation. The launcher downloads nothing. An absent or mismatched
package, absent executable, or failed browser run exits nonzero. The launcher
keeps browser profiles, transform cache, and test output under a per-run temp
directory and removes it after the run. Use a host that permits browser access
to IPv4 loopback.

The default **Mock Render** serves CARD-017 on private loopback. The gallery
ships in English. The test supplies localized headings and navigation labels
from the isolated fixture for layout measurement and checks the unmodified
English headings first. Each locale covers 16 screens and the Models SSE
cancel and completion states. The cancel test uses a separate loopback
server. It holds the seeded download in `running` until the browser's DELETE
returns 202, then delivers a terminal `cancelled` SSE frame.
The Quick Panel has a dedicated viewport, and the desktop cases
check the root font at two viewport sizes. The suite also checks overflow,
clipped controls, icon alignment, invalid rendered values, and browser errors.

Set `RESPIRE_E2E_CLIENT2_FIXTURE` to an absolute directory holding a compiled
web build with index.html and acceptance.json. The latter has a `catalogs`
object with the actual en and zh string catalogs and a `screens` object
keyed by the 16 IDs in the localized fixture. Each entry supplies an
origin-relative `path` and the expected `en` and `zh` level-one headings.
Supply the required translation keys from the application in `requiredKeys`.
The build must support locale selection through `?locale=en` or `?locale=zh`,
expose a main landmark, and use same-origin Mock Runtime requests. In this mode
the suite reads the compiled output and leaves its translations untouched.
This mode covers the compiled WebUI against Mock Runtime. Native Wails and
compiled Runtime integration require separate execution.

## Acceptance inventory

| Requirement | Implemented checks | Outstanding evidence or implementation |
| --- | --- | --- |
| T05-04 | Cold start and capabilities, download cancel and retry, live recall during switch, rollback, space CRUD and isolation | All five compiled Runtime scenarios need execution. Model cases also need offline model fixtures. |
| T05-04 legacy SQLite | [Fixture provenance and blockers](fixtures/README.md) | UNSUPPORTED by the runner. Historical snapshots and migration, backup, restart, downgrade, and row-preservation checks need the legacy schema and a controlled target. |
| T05-04 Vault | [Fixture provenance and blockers](fixtures/README.md) | UNSUPPORTED by the runner. Vault v1–v4 vectors and unlock/decryption checks need historical codec evidence and a controlled target. |
| T05-05 transport | Windows HTTP/MCP entry point through a test-owned UTF-8 junction, offline HTTP byte checks and concurrent store/recall, MCP framing, junction target preservation on teardown | Native junction and compiled Windows executions are required. Online model operations, Paused sentinel, OneDrive-specific behavior, and single-pass hashing checks need a product fixture. |
| T05-05 CLI and legacy RPC | Production-only E2E-006 and E2E-007 | Compiled execution is pending. Full CLI subcommands and legacy flag parity, TUI, actual IDE injection, `keys-export`, `doctor --fix`, model uninstall, upgrade/fallback, and legacy `model.switch` are unsupported by these checks. |
| T05-06 | Static fixture validation, Playwright en/zh Mock Render and compiled WebUI modes | Browser execution needs a local Playwright package and browser. Compiled WebUI needs the build fixture. Native Wails and Client2 with compiled Runtime are unsupported by this suite. |

The Change 005 Windows large-payload scenario maps to
[windows.mjs](plugin-rpc/windows.mjs). Its legacy compatibility scenario is
partially covered by the [smoke suite](cli-e2e/smoke.mjs). The prototype review
and automated PR preview scenarios belong to CARD-017 and CARD-019.
