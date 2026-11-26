# Compiled Quick Panel proof of concept

This separate two-case product cut (English and Chinese) and negative status
check does not replace the gallery, claim the 32-case gate, run real Runtime,
or certify native Wails. It uses the actual shipped Quick Panel status UI,
not the gallery search interaction. Workspace requires the real Wails runtime
module, which is not in the frontend embed. Do not stub this module or
ignore its absence to grow this cut.

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
node --test test-cases/client2-e2e/compiled-webui/quick-panel-adapter.test.mjs
node test-cases/client2-e2e/compiled-webui/quick-panel-layout.mjs
~~~

The runner downloads nothing and rejects unpinned bytes, links, extra files,
external origins, unexpected host requests, and failed status. The actual
localized metric and positive Mock Runtime count must be visible before
measurement, with the stock Quick Panel viewport/checks and extra shell
control checks. The negative proves failed status cannot qualify as loaded
content even when the product can render a fallback.

## Workspace cut: Overview, Memories and Recall

Set `RESPIRE_E2E_WAILS_RUNTIME` to the verified production asset from the
actual Client2-locked Wails module `github.com/wailsapp/wails/v3 v3.0.0`
(source commit `7b11001b92b712210b27d8cb53430e83f67ad8e4`). The tracked
`v3/internal/assetserver/bundledassets/runtime.js` is the production embed;
its SHA-256 pin is in the adapter. Non-server Wails prepends no transport
prelude. We neither synthesize nor patch this byte stream. The optional
server-script HEAD request correctly returns the same 404 as normal
desktop Wails. Other Wails calls are unsupported and fail.

This incremental cut adds six browser cases to the two Quick Panel cases.
Each Workspace case tests both desktop viewports, ready data, independent
bilingual localized captions, stock layout, no app/asset errors, and fluid
rem scaling. Recall requires actual Enter submission, the typed Mock
positive terminal and the genuine matching title, not a look-alike page.

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
The four surfaces do not certify the other twelve or the complete matrix.
