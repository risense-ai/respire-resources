# Black-box acceptance

This suite implements the offline part of CARD-018 and provides entry points for
compiled acceptance. Each result names its target. A skipped check contributes
no acceptance evidence.

Add `--verify` to the scenario runner, legacy smoke, or Windows transport command
when execution is required. Missing prerequisites then fail instead of allowing
required cases to skip successfully. In `--mock --verify`, only the five mock
scenarios are required; the two compiled-only legacy cases remain optional.
Compiled scenario verification requires all seven cases and their fixtures.
Legacy verification requires both legacy cases. Preflight cannot verify behavior.
Without `--verify`, prerequisite discovery retains its optional skip behavior.

## Offline commands

Run from the Resources root with Node.js 22 or later.

~~~sh
node test-cases/runner.mjs --mock
node --test test-cases/runner.test.mjs prototypes/mock-api/parity.test.mjs prototypes/mock-api/behavior.test.mjs prototypes/mock-api/gallery.test.mjs
node --test test-cases/modern-ready.test.mjs
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
loopback, verifies the owned process identity, creates a fresh external temp
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

Modern readiness requires `status: ready`, a nonblank `instance_id`, and a
`capabilities` array containing only strings, as defined by `HealthResponse`.
An empty or partial capability list is valid; generic CLI and legacy HTTP/MCP
startup do not require optional `openapi.v1` or `sse.operations.v1` flags.
Feature-specific checks retain their explicit capability requirements. It then reads
`runtime/endpoint.json` under the owned fixture profile and requires its `pid`
to equal the spawned child PID, its `instance_id` to match modern health, and
its `url` to equal the reserved loopback URL. A health `pid` cannot substitute
for this record. Missing or mismatched records fail; there is no HTTP fallback
from modern to legacy health. The record shape follows `rpc_worker::endpoint_body`
and `rpc_serve::endpoint_identity` in Runtime; current-artifact publication still
needs a successful compiled run on a host that permits loopback.

### Focused capability-readiness regression evidence

On 2026-11-25, the focused readiness regression first failed with
`Missing canonical OpenAPI/SSE capabilities` before the probe fix. After the fix:

- `node --test test-cases/runner.test.mjs test-cases/modern-ready.test.mjs`:
  22 passed, zero failures or skips. Guards accept empty and partial string
  lists, including `auth.handshake.v1` alone; reject missing, null, non-array,
  and mixed-type capabilities; and retain endpoint PID/instance/URL rejection.
  The synthetic startup sequence also uses only `auth.handshake.v1`.
- `node --test prototypes/mock-api/parity.test.mjs prototypes/mock-api/behavior.test.mjs prototypes/mock-api/gallery.test.mjs`:
  64 passed, zero failures or skips, including typed SSE checks.
- `node test-cases/runner.mjs --mock --verify`:
  `passed=5 skipped=2 failures=0 preflight=false`; compiled legacy cases are
  optional in mock mode and supply no native acceptance evidence.
- `node process/scripts/validate-openspec.mjs` and `git diff --check`: passed.
- `node --test test-cases/plugin-rpc/windows-junction.test.mjs`: failed before
  Runtime launch with `Owned synthetic junction creation failed; code=EPERM`.

Native compiled CLI/HTTP/MCP acceptance remains UNTESTED in this regression run.
Released-old checks, actual junction requirements, and feature-specific
OpenAPI/SSE assertions remain unchanged. No Runtime source or API contract changed.

### Explicit synthetic modern ready setup

An empty modern profile reports `degraded` before unlock. For a disposable ready
profile, opt in explicitly; do not pass `--profile-fixture` or `--released-old`:

~~~powershell
node test-cases/cli-e2e/smoke.mjs --synthetic-ready --runtime-bin "$RuntimeBin" --cli-bin "$CliBin" --verify
node test-cases/plugin-rpc/windows.mjs --synthetic-ready --runtime-bin "$RuntimeBin" --cli-bin "$CliBin" --verify
node test-cases/runner.mjs --synthetic-ready --runtime-bin "$RuntimeBin" --cli-bin "$CliBin" --verify
~~~

A scenario manifest may instead set `"syntheticReady": true` for a case. It must
not also supply `profile`. Prepared model cases still require their local assets
and declared inputs; this setup supplies no models. Mock and preflight modes
reject the command-line opt-in. Existing supplied-profile and released-old paths
retain their previous startup behavior and do not invoke synthetic unlock.

The harness prints `FIXTURE SYNTHETIC MODERN READY` before launch. The isolated
root holds a freshly generated Vault v4 session, a random host token, and an empty
model directory. It disables autosync. On Windows it applies owner-only ACLs to
that newly created root, following the existing monorepo smoke. The fixture uses
no real user configuration, credentials, keyring, installer, or remote service.
The synthetic unlock key stays in memory and in the loopback unlock request; it is
never written to session.json, command arguments, or diagnostic output.

`modern-ready.mjs` follows `apps/runtime/scripts/smoke-owner-handshake.mjs` and
`runtime-release-smoke-helpers.mjs` in the monorepo: generate the disposable
`onememory:kek:v4` session, require the child-written endpoint PID/instance/URL
before HTTP, and inspect `/api/health` solely for the locked unlock binding.
Require modern `/v1/health` to report `degraded` before posting the supported
`/api/runtime/unlock` request with profile, session SHA-256, instance, generation,
and synthetic credentials. Unlock must report `store_ready: true`. The regular
modern probe then still requires `ready`, string-array capabilities, and matching
endpoint PID/instance/URL, with the same instance as before unlock. Legacy health
does not substitute for modern readiness; no failed probe triggers this setup.

The Windows command still places the workspace and profile through an actual
test-owned junction. It neither canonicalizes that path away nor treats a
junction rejection as success. The coordinator-reported configured-junction
result (`exit 2`, `endpoint path contains a symlink`) belongs to the separate
Runtime investigation. It was not reproduced by the restricted-host runs below.
The latest coordinator report supersedes that startup observation with strict
ready and confirmed ownership; actual transport acceptance still needs the
feature round trips described in the T05-05 gate below.

The focused Node tests use synthetic HTTP replies and a Node child in place of
Runtime for startup sequencing. They verify the fixture's AES-GCM unwrap,
session digest, locked-to-ready ordering, identity rejection, explicit opt-in,
released-profile exclusions, and cleanup on failed unlock. They are harness
evidence, not compiled Runtime acceptance.

Startup failures include the child exit code and signal plus fixed, allowlisted
diagnostic fragments. Each pipe retains only 128 trailing characters for split
fragments; the retained matches are limited to the fixed allowlist. Arbitrary
child logs, fixture paths, and credentials are excluded. On a startup failure,
diagnostics allow up to 250 ms for the child to exit naturally before teardown.
Junction creation failures report only the error code. These failures remain
failures, including under `--verify`.

### Restricted-host observation (2026-11-25)

Only an empty, disposable synthetic fixture was used with these exact candidates:

- `Temp/respire-card018-monorepo-candidates-20261124/rsrs-runtime.exe`
- `Temp/respire-coordinator-20261124-1208/card-007.target/debug/rsrs.exe`

The Runtime child exited with code `2` and the allowlisted fragment
`os error 10013`; `runtime/endpoint.json` was absent (`ENOENT`). The HTTP probe
also failed with restricted socket access. Separately, synthetic junction
creation failed with `EPERM` before Runtime launch. This does not establish a
Runtime junction rejection or an ancestor canonicalization bug. No ACL failure
was established, so no fixture ACL or Runtime safety rule was changed. The CLI
was not reached through a ready Runtime.

Coordinator must rerun on permitted localhost and normal NTFS, first without a
junction to establish current-artifact endpoint publication and identity, then
with a disposable junction. If that run establishes a legitimate ancestor
canonicalization failure, its diagnostics belong in a separate Runtime change;
this suite must not bypass the safety check. These observations do not complete
CARD-018 or provide compiled acceptance evidence.

After adding the explicit synthetic-ready mode, the two exact candidates above
were retried with the smoke command and `--synthetic-ready --verify`. Both cases
failed before unlock with child exit `2` and `os error 10013`; summary:
`passed=0 skipped=0 failures=3 preflight=false` (the third failure is the
verification guard for zero passing cases). The synthetic Windows transport
command with `--verify` failed while creating the actual junction with `EPERM`,
before Runtime launch. These are separate host restrictions, not verification
of the reported configured-junction Runtime rejection. No compiled ready,
CLI/RPC, or junction transport success is claimed.

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

### T05-05 feature checks and native gate

The Change 005 large-payload scenario requires actual HTTP and MCP persistence
and complete recall, not a particular health flag. OpenAPI `HealthResponse`
describes `openapi.v1` as an example string; it defines no required capability
member. The migration playbook still uses that flag for client transport
selection. This runner selects its transport explicitly and tests the actual
features; it does not change client negotiation or the E2E-001 capability case.
Strict ready health and endpoint PID/instance/URL ownership remain mandatory.

The Windows runner executes HTTP/en, HTTP/zh, MCP/en, and MCP/zh independently,
each with its own disposable Runtime, profile, and junction. All four run even
if an earlier check fails. Each request exceeds 100 KiB. HTTP requires create
201, a nonempty stored ID, recall 200, the same ID, and byte-exact content;
the HTTP case also requires the concurrent store/recall burst. MCP requires
initialize, advertised remember/show/recall tools, matching JSON-RPC IDs,
successful ResultEnvelopes, the same stored ID and byte-exact full content in
`memory_show`, the stored ID in recall, and clean CLI exit. Recall byte equality
remains a separate strict assertion: shortened recall fails acceptance even when
show returns the complete content. Truncation semantics are unconfirmed.
PASS is printed only after owned Runtime teardown and cleanup succeed.

Run each transport separately when collecting native evidence:

~~~powershell
node test-cases/plugin-rpc/windows.mjs --synthetic-ready --transport http --runtime-bin "$RuntimeBin" --cli-bin "$CliBin" --verify
node test-cases/plugin-rpc/windows.mjs --synthetic-ready --transport mcp --runtime-bin "$RuntimeBin" --cli-bin "$CliBin" --verify
node test-cases/cli-e2e/smoke.mjs --synthetic-ready --runtime-bin "$RuntimeBin" --cli-bin "$CliBin" --verify
~~~

These memory routes use the installation-local bearer and Runtime-bound owner
scope, rather than the six action-specific handshake leases. The fixture still
uses the supported typed `/api/runtime/unlock` request documented above; it does
not bypass authentication or manufacture a ready response. An empty-model
fixture supplies no embedding model: any model-dependent store or recall
failure remains FAIL. A fully ready, synthetic offline model profile may be
supplied with `--profile-fixture` instead of `--synthetic-ready`.

The coordinator reports native HTTP/en and HTTP/zh round trips exceeding
196 KiB, concurrent store/recall, and actual junction ownership passing with
the current synthetic Runtime and installed CLI. These are coordinator
observations, not locally reproduced acceptance.

E2E-007 keeps its read-only requests and success assertions. After strict
modern ready health and endpoint PID/instance/URL ownership, only its
`cli.exec` request reads `/api/health` for the mandatory legacy scope. That
reply must identify the same child PID and modern instance, report the legacy
server/protocol and completed ready state, and supply account, instance, and
positive safe-integer generation. A mismatch fails before RPC dispatch.
Modern requests still use `/rpc`; released-old requests deliberately use
`/api/rpc` and the already validated released health scope. Status and catalog
requests neither read this additional health reply nor acquire a scope.
RPC bearer authentication remains required. Legacy health is never a
substitute for modern readiness.

Assertion failures identify the rule or field without printing actual or
expected values. Focused harness checks cover routing, scope rejection,
authentication retention, strict-ready ordering, unchanged E2E-007 assertions,
and diagnostics with private synthetic values. On 2026-11-25,
`node --test test-cases/runner.test.mjs test-cases/modern-ready.test.mjs`
passed 23 tests with zero failures or skips. These use synthetic replies and
a Node child; native E2E-007 acceptance still requires the coordinator rerun.

The coordinator reports that the latest compiled E2E-006 and E2E-007 both
PASS after the scope correction. These are coordinator observations, not
acceptance reproduced in this restricted session.

The coordinator directly verified that `ITEM VALUE` is CLI startup failure
output before any MCP JSON-RPC, not a text tool result. With raw junction
aliases in `RSRS_DATA_DIR`, `HOME`, and `USERPROFILE`, both `rsrs mcp` and
`rsrs --client-only mcp` exit 1 on linked/outside-category profile checks.
Canonical config paths into the same private fixture allowed both commands
to initialize with real JSON-RPC, while retaining the actual junction cwd,
the same Runtime through the junction, and strict ownership checks.

The runner therefore constructs a separate MCP CLI environment from the
owned fixture. It resolves only home/profile config fields (`HOME`,
`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, the four `XDG_*` home fields, and
`RSRS_DATA_DIR`). Before resolution, the environment must exactly match
`isolatedEnv`, optionally with both fixed synthetic startup fields:
`RSRS_M3_DIR=join(ownedRoot, "empty-models")` and `RSRS_NO_AUTOSYNC=1`.
The models directory must be a regular owned directory without inner links,
and its canonical path must match that exact child of the owned root. Missing
paired fields, changed values, extra tools, and unknown flags remain rejected.
The workspace must resolve to the expected physical directory
inside the owned temp root. Config directories must resolve to that same
directory or its exact profile child. Inner links remain forbidden.
Runtime environment, junction cwd, temp paths, and binary paths keep their
original aliases. No arbitrary environment or real profile is accepted.

This tests Runtime and workspace junction behavior with spaces and UTF-8.
The CLI home/profile is configured canonically for MCP; this does not prove
that CLI profiles accept linked roots. The committed invocation remains
`--client-only mcp`, with strict JSON-RPC and embedded JSON ResultEnvelopes,
real tool errors, bilingual byte equality, and concurrent HTTP checks.
Startup prose and corrupt replies remain failures. Native MCP/en and MCP/zh
tool round-trip acceptance remains UNTESTED here; initialization alone is
not acceptance. The coordinator runs the native rerun.

Focused checks now cover unchanged Runtime environment, exact canonical
config destinations, unchanged temp/bin aliases, arbitrary environment
rejection, inner junction rejection, and workspace alias redirection.
The non-native suite passed 24 tests with zero failures or skips using
`node --test test-cases/runner.test.mjs test-cases/modern-ready.test.mjs`.
The native junction fixture failed at junction creation with `EPERM` in
this restricted host, before the new junction assertions could run.

This restricted-host run used candidate directory
`Temp/respire-card018-monorepo-candidates-1652`, Runtime SHA-256
`8CA6D8CCBFAAF5508345DC5C33ECE5A741B3F35991B1CB82D18246EDD1554200`,
and the CLI in `Temp/respire-coordinator-20261124-1208/card-007.target/debug`.
CLI smoke failed before readiness with child exit 2 and `os error 10013`
(`passed=0 skipped=0 failures=3`, including the verification guard).
All four transport cases failed before launch with junction `EPERM`.
Actual feature request/response acceptance is therefore UNTESTED on this host.
Neither the prior assertion failure nor these host restrictions provide PASS.
Native CLI, legacy RPC, HTTP/en+zh, and MCP/en+zh must all be green before push.

### Synthetic MCP environment and three-tool regression (2026-11-25)

The coordinator reported that the post-1728 native fixture failed before MCP
spawn because synthetic preparation adds the two fixed environment fields.
The validator now checks that exact pair and its owned models path, while
retaining the original junction, profile, and arbitrary-environment checks.
No Runtime code, real profiles, or arbitrary launch environment was changed.

The coordinator also reported matching recall IDs with shorter content in both
languages, while existing `memory_show {id}` returned full decrypted
`details.entry`. This is independent coordinator evidence, not a local native
PASS or confirmation that primary recall is intended to truncate.

The isolated MCP allowlist now contains exactly remember, recall, and show.
After remember, the fixture requires show to return the same ID and exact full
UTF-8 content, then checks recall matching and clean CLI exit. It prints a
separate show verification diagnostic before asserting recall byte equality.
A shortened recall reports its actual and expected byte lengths and
`truncation semantics UNCONFIRMED; strict acceptance failed`; it is never
silently accepted as expected behavior.

Local validation:
- `node --test test-cases/runner.test.mjs test-cases/modern-ready.test.mjs`:
  25 passed, zero failures or skips. The Node child fixture checks both
  languages, full show/recall success, shortened show rejection, wrong recall
  ID rejection, and shortened recall rejection. These are harness tests, not compiled acceptance.
- The same suite checks the actual synthetic preparation through `withRuntime`,
  fixed fields, partial pairs, changed values, unexpected flags, and extra tools.
- `node --test test-cases/plugin-rpc/windows-junction.test.mjs`: FAIL at
  junction creation with `EPERM`, before the synthetic environment assertions.
- Native MCP/en and MCP/zh with `--synthetic-ready --transport mcp --verify`
  and the candidates listed above: both FAIL at junction creation with `EPERM`,
  before Runtime or CLI launch. Native initialization, show, recall lengths,
  and full UTF-8 transport remain UNTESTED in this session.

### Raw MCP content and occupied synthetic fixture regression (2026-11-25)

The coordinator's native byte inspection found the original input unchanged as
a suffix after a 29-byte legacy diary stamp in both languages. The stamp uses
U+3010, U+65E5 U+8BB0, U+3011, local `YYYY-MM-DD HH:MM`, and a space.
The fixture requested `importance: trivial`, which `dispatch_remember`
intentionally stores as a titled diary. This observation identifies a fixture
semantics mismatch, rather than transport corruption.

The raw-content fixture now requests `importance: important` through the
existing `memory_remember` tool. Both show and recall still require exact UTF-8
byte equality and the stored ID. The three-tool allowlist, canonical MCP config,
native junction association, ownership, framing, cleanup, and error checks stay
in place. No product behavior changes or diary-specific acceptance claims are made.

Synthetic preparation now rejects a nonempty profile or an existing
`empty-models` fixture before any ACL command. It reports `EEXIST` with
`Synthetic ready fixture already exists; refusing setup before ACL changes`.
Owner-only ACL setup for fresh fixtures and exclusive `wx` creation remain.
This prevents a second setup from failing on `SeSecurityPrivilege` before the
intended occupied-fixture diagnostic.

Local verification for this correction:

- `node --test test-cases/runner.test.mjs test-cases/modern-ready.test.mjs`:
  26 passed, zero failures or skips. Harness checks require important storage in
  both languages and retain shortened show/recall rejection. Occupied session,
  token, models directory, and unrelated-file cases assert zero ACL subprocess
  calls and unchanged file bytes, names, modes, sizes, modification/change
  timestamps, and environment.
- Native MCP/en and MCP/zh with `--synthetic-ready --transport mcp --verify`
  and the same candidate Runtime/CLI paths listed above: both FAIL with
  `Owned synthetic junction creation failed; code=EPERM`, before Runtime/CLI
  startup. Corrected native show/recall acceptance is UNTESTED on this host.
  There was no bypass, substitute executable, or legacy clone.
- The coordinator separately reported a native modern-ready positive result.
  That report is external evidence; this local harness run does not reproduce
  native readiness or the diary behavior.

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
Before measurement, each screen must finish initialization and show its own
loaded content. Quick Panel performs a synthetic recall to populate its results.
Recall receives the valid synthetic query `field` before its initial health
response releases setup; Quick Panel uses the same query. This verifies loaded
search results, not the gallery's empty-query initial state (which the fixture
rejects with `invalid_query`). No production behavior is changed here.
Models layout uses the stable `rich-1k` seed; cancellation uses its controlled
running stream. An application error notice fails validation even without a
console error. Two negative checks inject a failing health capability response
and require validation to reject initialization. The launcher requires all 38
Mock Render checks (the original 36 plus two negative checks) to pass without skips.

Set `RESPIRE_E2E_CLIENT2_FIXTURE` to an absolute directory holding a compiled
web build with index.html and acceptance.json. The latter has a `catalogs`
object with the actual en and zh string catalogs and a `screens` object
keyed by the 16 IDs in the localized fixture. Each entry supplies an
origin-relative `path` and the expected `en` and `zh` level-one headings.
Supply the required translation keys from the application in `requiredKeys`.
Each screen must also provide `ready.en` and `ready.zh` objects with CSS `selector`
and nonempty `text` identifying application-specific loaded content, for example
`"ready":{"en":{"selector":"[data-testid=model-row]","text":"Active"},"zh":{"selector":"[data-testid=model-row]","text":"..."}}`.
Choose content rendered after data loading, not a static heading or placeholder.
The manifest must supply `errorSelector` matching application error notices only.
The suite waits for loaded content or that error selector, then rejects errors.
Compiled mode requires all 32 layout checks; only the six gallery-specific SSE
and synthetic failure checks are skipped. Compiled fixtures without these
readiness and error declarations fail rather than measuring an unloaded shell.
The build must support locale selection through `?locale=en` or `?locale=zh`,
expose a main landmark, and use same-origin Mock Runtime requests. In this mode
the suite reads the compiled output and leaves its translations untouched.
This mode covers the compiled WebUI against Mock Runtime. Native Wails and
compiled Runtime integration require separate execution.

Actual Client2 embeds multiple HTML entry points. The
[compiled Client2 WebUI qualification](client2-e2e/compiled-webui/README.md)
uses that actual product asset export and the real Wails bootstrap bytes,
not the generic fixture described above. Its hosted Linux run passed all 32
bilingual layout cases against Mock Runtime, with loaded data and loopback
isolation. That result is separate from the 38 gallery cases.

The [merged-product Windows qualification](https://github.com/risense-ai/respire-resources/actions/runs/45740798117)
used product commit `4da41a593ea1663a8199b4b9a1475eb05b8620a8` and passed
14 native screen-and-locale cases: Overview, Memories, Recall, Storage,
Settings, Diary, and Accounts in English and Chinese. It used compiled Wails,
compiled Runtime, and pinned Chromium with synthetic data on IPv4 loopback.
The job verified its file manifest and firewall rules before launch, required
independent scoped readback, and verified owned-process and firewall cleanup.
This native evidence does not replace the separate 32 compiled WebUI layouts.

## CARD-018 acceptance evidence

This record preserves the evidence reviewed for CARD-018 and separates follow-up checks that have not passed. The [task list](../openspec/changes/005-prototypes-and-e2e-acceptance/tasks.md), [frozen design](DESIGN.md), [SQLite and legacy transport addendum](https://github.com/risense-ai/respire-resources/issues/6#issuecomment-7113520462), and [Vault and feature parity addendum](https://github.com/risense-ai/respire-resources/issues/6#issuecomment-7113638815) define the unchanged acceptance criteria.

| Task and scenario | Executed evidence | Coverage and follow-up |
| --- | --- | --- |
| T05-04 cold start and spaces | Windows E2E-005 passed space CRUD and scoped memory reads. E2E-001 reached public health and failed its required capability assertion. The same job passed frozen E2E-007. [Scenario job](https://github.com/risense-ai/respire-resources/actions/runs/45765454095/job/139726114390) | Space isolation verified. A compiled cold start passing the complete capability assertion remains open. |
| T05-04 download and live model switch | E2E-002 passed 11/11, including two live cancellations with no residual model files. E2E-003 passed 9/9: old-index recall succeeded after positive progress, the same switch was still running afterward, and the replacement assets completed. [Download job](https://github.com/risense-ai/respire-resources/actions/runs/45638768058/job/139291281146) · [Merged switch scenario and exact verdict](https://github.com/risense-ai/respire-resources/pull/19) | These receipts cover the two named scenarios. |
| T05-04 rollback | Native Windows verification exercised a bounded candidate build, fifth-row rollback, incumbent recall, cancellation, revocation and worker cleanup. [Product change and verdict](https://github.com/risense-ai/respire/pull/43#issuecomment-7164870365) | Product rollback verified on the eligible path. A passing transcript of the complete frozen E2E-004 scenario remains unlocated. |
| T05-04 SQLite and Vault | See the migration receipts below. All eight combinations of Vault v1-v4 and the two historical namespaces unlocked in compiled Windows Runtime and returned the exact expected UTF-8 legacy record. [Fixture and native checks](fixtures/crypto/README.md) · [Merged compatibility evidence](https://github.com/risense-ai/respire-resources/pull/13) | Ordinary unlock and decryption verified. The full design also calls for historical auth hashes, keyring aliases and account-directory coverage. |
| T05-05 Windows transport and cleanup | Native large UTF-8 HTTP/MCP and scoped recall/show passed; the strict bilingual MCP payloads were 178,975 and 180,475 bytes. The synthetic-junction HTTP test restored host configuration and sampled three maintenance markers. Active-model refusal and online Small/M3 removal have a separate native receipt. Product #68 passed five named profile-admission cases on Windows x64 at head 385534a5. [Transport record](https://github.com/risense-ai/respire-resources/pull/13) · [Junction run](https://github.com/risense-ai/respire-resources/actions/runs/45756631807) · [Online removal](client2-e2e/ONLINE-MODEL-WINDOWS.md) · [Exact #68 qualification](https://github.com/risense-ai/respire-resources/actions/runs/45766379563/job/139728878781) · [Merged scope](https://github.com/risense-ai/respire/pull/68#issuecomment-7184395163) | #68 supports one approved interior junction ancestor. The component receipts do not establish a single combined online-removal and junction-cleanup sequence or real OneDrive hydration. |
| T05-05 legacy parity | Production CLI/RPC smoke, MCP framing, Windows injection and Linux interactive injection have scoped receipts. Linux checked initial insertion, idempotency, cancellation, confirmation, removal and sibling preservation. [Legacy smoke](https://github.com/risense-ai/respire-resources/pull/13) · [Linux CLI and terminal job](https://github.com/risense-ai/respire-resources/actions/runs/45758909482/job/139703990568) | Complete CLI flags/JSON, TUI, IDE adapters, legacy model.switch and the all-feature parity matrix remain unproven. |
| T05-06 bilingual layout | 32/32 loaded layouts passed across 16 compiled Client2 screens in English and Chinese against Mock Runtime. Separately, seven native Windows screens passed in both locales using compiled Client2 and Runtime. [Merged layout suite](https://github.com/risense-ai/respire-resources/pull/36) · [32-case run](https://github.com/risense-ai/respire-resources/actions/runs/45751112648) · [14-case run](https://github.com/risense-ai/respire-resources/actions/runs/45740798117) | Bilingual layout coverage verified. Functional parity across all 16 screens remains a separate issue requirement. |

### SQLite migration, restart and transaction receipts

- The v1.0.10 storage constructor built from [historical source](https://github.com/risense-ai/respire-cli/blob/08e57d648248f7d79f9d711bd4315471be2c39c7/crates/storage/src/transport/local.rs#L72) created a synthetic marker-0 database. On Ubuntu 24.04, compiled product ca7d3d30 upgraded it to marker 1. The product-named backup matched the pre-DDL schema and all compared original memory/outbox fields. Two memories and two pending operations survived. A distinct second Runtime process (PID 15769 after 15750) drained cleanly with the same witness and no second backup. [Exact #45 job](https://github.com/risense-ai/respire-resources/actions/runs/45775347998/job/139757554067)
- The published dev.17 Golden took the ordinary restart path with marker 0 and consistent rows/outbox. Count that as restart preservation. Its older inventory filter could miss the product backup filename. [#42 restart run](https://github.com/risense-ai/respire-resources/actions/runs/45769297931) · [Golden provenance and populated storage probe](fixtures/db/README.md)
- Hosted Linux x64 reported `schema_upgrade_rolls_back_if_existing_query_log_is_unsupported` and `refuses_an_unknown_version_before_any_local_database_mutation` as passed. The explicitly gated `published_golden_repair_is_durable_and_failure_keeps_original` was ignored in that job. The separate Windows published-Golden verification was recorded alongside 78/78 storage tests and an older binary's refusal with settled bytes preserved. Its test checks backup collision admission, rollback after a post-DDL error, and a readable pre-DDL backup inside the transaction callback. [Linux job log](https://github.com/risense-ai/respire/actions/runs/45612639204/job/139200124501) · [Windows verification](https://github.com/risense-ai/respire/pull/42#issuecomment-7162487424) · [Named Golden test](https://github.com/risense-ai/respire/blob/ca7d3d309581017be32aa0a303740c2a011619c1/apps/runtime/crates/storage/src/transport/local/migration_backup.rs#L293)
- Production startup acquires the immediate transaction, publishes the backup before DDL, performs the repair and integrity check, stamps the marker and commits. Source order, the transaction-error tests and the #45 preimage comparison support distinct assertions. No process-crash or power-loss result was measured. [Production transaction boundary](https://github.com/risense-ai/respire/blob/ca7d3d309581017be32aa0a303740c2a011619c1/apps/runtime/crates/storage/src/transport/local/startup_schema.rs#L105)

The design also requires checked-in representative Golden files, including a comprehensive populated fixture with review, grants, queries, skill runs, entry audit and triggers. The published empty Golden, seeded storage probes and generated #45 library cover different subsets. A committed comprehensive fixture and its preservation receipt remain outstanding. [Frozen fixture criteria](DESIGN.md)

The Change 005 Windows large-payload scenario maps to
[windows.mjs](plugin-rpc/windows.mjs). Its legacy compatibility scenario is
partially covered by the [smoke suite](cli-e2e/smoke.mjs). The prototype review
and automated PR preview scenarios belong to CARD-017 and CARD-019.

### Windows native Codex injection

`node test-cases/cli-e2e/verify-inject-win.mjs <owned-temp-dir>
<absolute-cli-exe> <lowercase-cli-sha256>` uses the compiled CLI in an isolated
synthetic home and project. It checks real configuration insertion, managed
block content, idempotent insertion and removal, preservation of project
files, and no standalone Runtime launch. The existing CLI may leave two
trailing LF bytes after removal; the probe reports this separately rather
than asserting byte-exact restoration.

A separate Windows pseudo-terminal check rendered the actual injection
picker and exited cleanly on `q`, without writes in the isolated home. This is
not an interactive write or general TUI/IDE parity check.
