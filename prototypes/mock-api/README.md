# prototypes/mock-api — Deterministic Mock Runtime Server

In Change `005`, `respire-client2/.verification/ui-mock/server.mjs` migrates here and upgrades to implement `contracts/runtime-api/openapi.yaml` `/v1/*` routes and SSE event streams for:

1. **Interactive Prototype Walkthroughs**: Simulating empty DB, 1k-memory workspace, SSE download progress, model switch rollback errors, and multi-account states.
2. **Automated Client2 PR UI Preview**: Executed by the sandboxed `record` job in `ui-preview.yml` to capture `en`/`zh` Playwright screenshots and MP4 demos.
