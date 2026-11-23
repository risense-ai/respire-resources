# Tasks: 005-prototypes-and-e2e-acceptance

## 阶段一：高保真原型与确定性 Mock 服务

- [ ] **T05-01** 将 `respire-client2/.verification/ui-mock/server.mjs` 升级迁移至 `prototypes/mock-api/server.mjs`，完整实现 `openapi.yaml` `/v1/*` 路由、SSE 事件流与 5 套种子场景数据集
- [ ] **T05-02** 抽离 `prototypes/tokens/tokens.css`（流体 `rem` 字号、色彩与圆点状态组件）
- [ ] **T05-03** 在 `prototypes/pages/` 补齐 16 个核心高保真 HTML 原型页面并支持无构建直接浏览器交互演示

## 阶段二：黑盒 E2E 验收裁判库（`test-cases/`）

- [ ] **T05-04** 编写 `test-cases/runner.mjs` 场景执行器并扩充 `scenarios/*.yaml`（覆盖冷启动、模型下载取消、切换期并发 `recall`、失败安全回滚、多空间隔离）
- [ ] **T05-05** 落地 `test-cases/cli-e2e/` 与 `test-cases/plugin-rpc/`（含 Windows 100 KB+ UTF-8 JSON HTTP/MCP 写入召回与 reparse point 在线清理测试）
- [ ] **T05-06** 落地 `test-cases/client2-e2e/` Playwright 双语（`en`/`zh`）全页面交互、i18n 与布局断言套件

## 阶段三：跨端 E2E 与 Client2 PR 自动 UI Preview 流水线

- [ ] **T05-07** 在 `risense-ai/respire` 落地 `.github/workflows/e2e.yml`（三平台 Ubuntu/macOS/Windows 拉取 `respire-resources/test-cases` 跑真实产物黑盒验收）
- [ ] **T05-08** 在 `risense-ai/respire` 落地 `.github/workflows/ui-preview.yml`（`detect -> record -> publish` 权限隔离，自动生成双语截图与 MP4 视频并更新 PR 描述）
- [ ] **T05-09** 验收归档：全部 E2E 与 UI Preview 实际跑绿一次后，由 Scribe 将 `specs/prototypes-and-e2e/spec.md` 合并至 `openspec/specs/`

## 验收命令

```sh
node test-cases/runner.mjs --runtime-bin <path-to-rsrs-runtime>
npx playwright test --config test-cases/client2-e2e/playwright.config.mjs
```
