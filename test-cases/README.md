# test-cases — 语言无关的黑盒 E2E 验收裁判库

本目录保存独立于 `respire` 与 `respire-core` 源码之外的黑盒验收用例与自动化测试套件（参见 OpenSpec `005`）。

- **`scenarios/`** — 声明式业务场景验收规范（YAML），例如：[001-health-and-capabilities.yaml](scenarios/001-health-and-capabilities.yaml)
- **`cli-e2e/`**（待 `005` 填充）— 针对真实 `rsrs-runtime` 与 `rsrs` 产物的黑盒回归
- **`plugin-rpc/`**（待 `005` 填充）— 插件通过 HTTP OpenAPI 与 `rsrs mcp` stdio 调度验收（含 Windows 超长 UTF-8 JSON 回归）
- **`client2-e2e/`**（待 `005` 填充）— Playwright 驱动的双语视觉与交互断言
