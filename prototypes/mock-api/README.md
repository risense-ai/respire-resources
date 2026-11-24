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
a separate synthetic scoped lease. The owner-session button on Grants or
Statistics issues a fresh challenge through `POST /preview/owner-challenge`
with the preview bearer and an empty JSON object. Prefix the returned
`challenge` with `synthetic-owner-proof-` and send it once through
`X-Respire-Handshake-Proof`. Challenges expire after 30 seconds. The handshake
checks scopes and issues a 300-second lease for the active account and space.
Profile and space switches, completed login, and logout invalidate both
outstanding challenges and leases. Use the button again to reauthorize.

This handshake is **not production authentication evidence**. It performs no
signing, credential extraction, OS ownership verification or secret access.
Its deterministic proof and lease values are deliberately synthetic and must never
be used against a production Runtime. HTTP previews use a monotonic clock;
direct fixture tests advance a deterministic clock explicitly.

All 44 canonical method/templates are exercised by the parity suite. Tests
read `contracts/runtime-api/openapi.yaml` directly and check exact coverage,
request schemas, success/problem status and media mappings, response schemas,
and typed SSE `OperationEvent` frames. The small test-only parser supports the
canonical document's current schema syntax; it is not a general YAML or
JSON Schema implementation. Unsupported mapping syntax fails assertions.
No contract copy or root dependency manifest is needed.

Memory deletion retains synthetic tombstones. The seeded profiles share the
seeded spaces and each remembers its own active space. New spaces belong to
the creating profile or to the signed-out guest. The empty scenario starts
with a separate, empty Offline demo space for the guest. Demo data stays with
the guest when the setup wizard signs in to Studio. Logout returns to the
guest's own workspace, if any. Signing in restores Studio's saved selection.
Profile switching is available after sign-in. Spaces isolate memories,
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
Scope changes close open streams immediately. Each frame also checks current
operation access. Jobs can finish in the background, and their timers stop
at a terminal state. New subscriptions and replay check operation access again.

The gallery uses `/preview/scope` and `X-Preview-Scope` to track the synthetic
account and selected space. It rechecks on tab activation and before actions
and polls visible HTTP tabs once a second. A changed scope replaces the screen
and discards responses from the earlier screen. File previews keep a separate
in-memory fixture per page and use the same scope checks.

Controls without a canonical Runtime operation use `/preview/` for synthetic
model uninstall and profile selection. Grant revocation uses canonical routes
and cannot bypass owner authorization through the preview namespace.

Offline checks without opening sockets:

```sh
node --test prototypes/mock-api/parity.test.mjs prototypes/mock-api/behavior.test.mjs prototypes/mock-api/gallery.test.mjs
node --test --test-name-pattern="16 exact|all five|HTTP adapter|direct operation" prototypes/mock-api/server.test.mjs
node process/scripts/validate-openspec.mjs
```

The gallery inventory test checks all 16 filenames, local assets, control IDs,
script syntax, file caps and language policy; it does not claim browser layout
or accessibility acceptance. The Coordinator runs native TCP and browser
checks independently:

```sh
node --test prototypes/mock-api/server.test.mjs
```
