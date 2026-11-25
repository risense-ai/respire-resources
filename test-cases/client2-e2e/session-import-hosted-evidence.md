# Windows Session Import preview acceptance

The [hosted Windows x64 job](https://github.com/risense-ai/respire-resources/actions/runs/45527398870/job/138914040746)
passed on 2026-11-25. This was a real Wails server-mode browser test
against compiled Client2 and Runtime, not the Mock Runtime gallery.

## Pinned inputs

- Runtime source: risense-ai/respire commit
  e836ccb2a1ab431f3f4f33f5e77eac5d49421aa4, built with locked dependencies.
- Runtime executable SHA-256:
  87fda8b317714344cc2ebed631bb9dec13d8477966870e5020b7a81667540bb7.
- Client2 source: risense-ai/respire commit
  7c1b323c8110845f8093b79b97c438e4713ad2d5 with generated Go Runtime SDK.
- [Isolated test source](https://github.com/risense-ai/respire-resources/tree/2fae8c1df66f33cd6899f51bf4d22e943a2c64e2/test-cases/client2-e2e/hosted-session-import).
  The one-off workflow itself is not installed by this change.

## What passed

The owned Runtime first found no session roots. Only then did the fixture
create one synthetic Codex rollout. The second native discovery reported
exactly its one fixture root; no other source could proceed to parsing.
The browser used the actual Workspace Session Import page and performed
one read-only preview per locale. Both English and Chinese runs verified
the expected row and account scope at 1280 and 480 pixel widths. Both
confirmed unchanged memory revision and no import cursor, then gracefully
drained their own Runtime and removed their fixture profiles.

Previews use the legacy RPC bridge, not a new versioned Session Import
route. This does not cover Apply, native WebView packaging, another
provider's transcript format, or end-to-end runs of all acceptance cases.
It never used an existing workstation or a real session history.


## Reproduction boundary

The [test sources](hosted-session-import/run-import-real.mjs) are included here
so the fixture is reviewable with the suite. Do not run this integration on a
workstation or persistent Windows account. The runner requires a clean standard
GitHub-hosted Windows x64 job. Its checked-in one-off example at the pinned
workflow source shows the tool and artifact wiring. Keep credential checkout
persistence off and avoid restoring account directories from caches.

Build Runtime from the pinned source, then generate its pinned Go SDK and
stage the exact Go fixture under Client2's internal/desktop package before
compiling the server,production test binary beside the test scripts. Supply
the pinned Chromium and Playwright paths and the built Runtime's SHA-256.
The runner checks each process and source before preview and fails rather
than reading an unexpected discovery root. The browser must not run Apply.
Cross-platform invocation and product packaging belong to CARD-019.
