# test-cases — Out-of-Repo Black-Box E2E Referee Suite

This directory houses black-box acceptance suites decoupled from implementation source code (see OpenSpec `005`).

- **`scenarios/`** — Declarative YAML acceptance tests, starting with [001-health-and-capabilities.yaml](scenarios/001-health-and-capabilities.yaml).
- **`cli-e2e/`** *(Change `005`)* — End-to-end black-box checks against compiled `rsrs-runtime` and `rsrs`.
- **`plugin-rpc/`** *(Change `005`)* — OpenAPI HTTP & `rsrs mcp` stdio tests including mandatory Windows 100 KB+ UTF-8 JSON tests.
- **`client2-e2e/`** *(Change `005`)* — Playwright `en`/`zh` UI layout and interaction tests using isolated `fixtures/i18n/` data.
