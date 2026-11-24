# prototypes/mock-api — Deterministic Mock Runtime Server

In Change `005`, `respire-client2/.verification/ui-mock/server.mjs` migrates here and upgrades to implement `contracts/runtime-api/openapi.yaml` `/v1/*` routes and SSE event streams for:

1. **Interactive Prototype Walkthroughs**: Simulating empty DB, 1k-memory workspace, SSE download progress, model switch rollback errors, and multi-account states.
2. **Automated Client2 PR UI Preview**: Executed by the sandboxed `record` job in `ui-preview.yml` to capture `en`/`zh` Playwright screenshots and MP4 demos.

## Running the preview

From the repository root, run `node prototypes/mock-api/server.mjs [port]`
(default 4173). The gallery and HTTP adapter share one loopback origin.
Use `?scenario=rich-1k` or the `X-Mock-Scenario` header. The query takes
precedence. Unknown names return a 400 problem document. The server keeps
each scenario in process memory and never opens a user profile.

Health is public. Ordinary fixture routes accept
`Authorization: Bearer synthetic-preview-only`. Owner metadata routes require
a separate synthetic scoped lease. Use the explicit owner-session button on
Grants or Statistics; the browser does not discover a proof automatically.
The fixture handshake accepts the literal `synthetic-owner-proof-only` once
per scenario and server lifetime through `X-Respire-Handshake-Proof`.
It checks scopes, rejects replay and expires leases after 300 seconds.
Profile/space switches and logout invalidate leases. Restart the server to
restore the seed and reuse the fixture proof. File previews restart per page.

This handshake is **not production authentication evidence**. It performs no
signing, credential extraction, OS ownership verification or secret access.
Its literal proof and lease values are deliberately synthetic and must never
be used against a production Runtime. HTTP previews use a monotonic clock;
direct fixture tests advance a deterministic clock explicitly.

All 44 canonical method/templates are exercised by the parity suite. Tests
read `contracts/runtime-api/openapi.yaml` directly and check exact coverage,
request schemas, success/problem status and media mappings, response schemas,
and typed SSE `OperationEvent` frames. The small test-only parser supports the
canonical document's current schema syntax; it is not a general YAML or
JSON Schema implementation. Unsupported mapping syntax fails assertions.
No contract copy or root dependency manifest is needed.

Memory deletion retains synthetic tombstones. Spaces isolate memories,
member invitations, grants, diary entries and query aggregates. Split and
deepen operations modify fixture state on completion. Query logs contain
counts only; reviews and conflicts contain metadata, never credentials.

Backup export streams actual `application/octet-stream` bytes. Import accepts
only byte-identical exports issued by that same fixture instance for the
same space, then restores synthetic notes and diary entries asynchronously.
It never opens a filesystem path or accepts a production archive. This is
an interactive backup fixture, not a real backup-format compatibility test.

SSE uses named `progress`, `completed`, `failed`, and `cancelled` events whose
JSON data is `OperationStatus`; tests reconstruct and validate `OperationEvent`.
Finished streams replay their terminal state. Reads never advance operations.

Controls without a canonical Runtime operation use `/preview/` for synthetic
model uninstall and profile selection. Grant revocation uses canonical routes
and cannot bypass owner authorization through the preview namespace.

Offline checks without opening sockets:

```sh
node --test prototypes/mock-api/parity.test.mjs prototypes/mock-api/behavior.test.mjs prototypes/mock-api/gallery.test.mjs
node --test --test-name-pattern="16 exact|all five|HTTP adapter" prototypes/mock-api/server.test.mjs
node process/scripts/validate-openspec.mjs
```

The gallery inventory test checks all 16 filenames, local assets, control IDs,
script syntax, file caps and language policy; it does not claim browser layout
or accessibility acceptance. The Coordinator runs native TCP and browser
checks independently:

```sh
node --test prototypes/mock-api/server.test.mjs
```
