# Compiled Client2 WebUI layout qualification

This Playwright lane verifies the actual embedded Client2 pages against the
deterministic Mock Runtime. It checks 16 surfaces independently in English and
Chinese. It is separate from the 38-case prototype gallery and from native
Wails, real Runtime, model, installer, and platform integration tests.

From the reviewed product checkout with local Go 1.26 and a fresh absolute
output directory:

~~~sh
export RESPIRE_E2E_PRODUCT_SHA='<reviewed full product SHA>'
export RESPIRE_E2E_EXPORT_WEBUI_DIR='/absolute/fresh-directory'
cd apps/client2/internal/desktop
GOTOOLCHAIN=local GOPROXY=off go test -count=1 -run '^TestExportEmbeddedWebUI$' \
  frontend_assets.go frontend_assets_export_test.go
~~~

Record the product SHA and SHA-256 of `webui.json` as trusted producer metadata
before transfer. From the Resources root with provisioned @playwright/test@1.56.1
and its local reviewed browser:

~~~sh
export RESPIRE_E2E_WEBUI_BUNDLE='/absolute/verified-transfer-directory'
export RESPIRE_E2E_WEBUI_MANIFEST_SHA='<reviewed manifest SHA-256>'
export RESPIRE_E2E_PRODUCT_SHA='<same reviewed product SHA>'
node --test test-cases/client2-e2e/compiled-webui/*.test.mjs
~~~

The runner downloads nothing and rejects unpinned bytes, links, extra files,
external origins, unexpected host requests, and failed status. The actual
localized metric and positive Mock Runtime count must be visible before
measurement, with the stock Quick Panel viewport/checks and extra shell
control checks. The negative proves failed status cannot qualify as loaded
content even when the product can render a fallback.

## Workspace cases and the production Wails bootstrap asset

Set `RESPIRE_E2E_WAILS_RUNTIME` to the verified production asset from the
actual Client2-locked Wails module `github.com/wailsapp/wails/v3 v3.0.0`
(source commit `7b11001b92b712210b27d8cb53430e83f67ad8e4`). The tracked
`v3/internal/assetserver/bundledassets/runtime.js` is the production embed;
its SHA-256 pin is in the adapter. Non-server Wails prepends no transport
prelude. We neither synthesize nor patch this byte stream. The optional
server-script HEAD request correctly returns the same 404 as normal
desktop Wails. Other Wails calls are unsupported and fail.

The Quick Panel uses its actual status view at 560×520. Every other
surface uses both 1440×900 and 1024×768 and verifies fluid root typography.
Playwright must observe loaded data, known scoped requests and actual
localized captions before layout measurements. Its stock overflow,
bounds/clipping and error checks are not replaced by fixture logic.

| Surfaces | Ready evidence |
| --- | --- |
| Quick Panel and Overview | Positive scoped Runtime counts |
| Memories and Recall | Loaded list and submitted search with matching synthetic result |
| Diary | Pinned calendar entry and loaded timeline |
| Accounts and Space Members | Current account, space data and an actual member dialog |
| Storage and Settings | Configured directory, theme and non-default read-only settings |
| Grants and Injection | Loaded grant and host target, no mutation |
| Stats | A matching local recall summary and dated row |
| Wizard and Organize | Current startup step; loaded classification provider |
| Session Import and Models | Selected source and seeded model engine/variant data |

Terminal responses use issued, single-use fixture acknowledgement IDs.
Only explicit read requests matching the selected surface are accepted.
The Quick Panel failure assertion is additional and does not count as a layout.
No application DOM, CSS, translation catalog, or production Wails bridge is
rewritten by the harness.

Provision local Go 1.26, Playwright 1.56.1 and its reviewed Chromium Linux
revision 1194 or approved pinned WebKit before starting the browser.
Record Go/browser asset hashes from the reviewed source and verify again
before execution. Browser phases must use a private kernel namespace with
only loopback, not just request interception. On Linux with user and
network namespaces enabled, run for example:

~~~sh
unshare -Urn python3 test-cases/client2-e2e/compiled-webui/loopback-only-exec.py \
  node test-cases/client2-e2e/compiled-webui/quick-panel-layout.mjs
unshare -Urn python3 test-cases/client2-e2e/compiled-webui/loopback-only-exec.py \
  node test-cases/client2-e2e/compiled-webui/workspace-layout.mjs
~~~

The launcher checks the absence of other interfaces and on-link routes
before and after bringing up its private loopback. Do not rerun on a network
or home containing production credentials if the namespace setup fails.
Both scripts must finish without failures. Count the 32 explicit en/zh
layout results, not the negative status test or a readiness-only entry.


## Hosted qualification evidence

[Run 45751112648](https://github.com/risense-ai/respire-resources/actions/runs/45751112648),
job `139678842436`, passed all 32 distinct product surface/locale cases on
Linux. It pinned product commit `4fc4e4e5d9f0cc2d099d27f25b0a3cbfe3c393c8`
and Resources qualification commit `c9f2280081a6ec2ba150013e84db00ea21a723b6`.
The exported asset manifest SHA-256 was
`f0bbea3bbf0aa081c146f97cfb6040d6fe392a354d458ff2a0f1821fc53cbcf9`.
The separate negative Quick Panel readiness guard passed. The disposable
qualification workflow was not merged.
