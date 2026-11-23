# Tasks: 005-prototypes-and-e2e-acceptance

## 阶段一：高保真原型与共享 Mock 数据集

- [ ] **T05-01** 将 Client2 现有 `ui-mock/server.mjs` 升级迁移至 `prototypes/mock-api/`，对齐 `openapi.yaml` V1 路由与 SSE 进度模拟
- [ ] **T05-02** 抽离 `prototypes/tokens/`（流体 `rem` 字体与配色令牌）及多场景测试种子数据（空库/大数据/下载报错/多账号）
- [ ] **T05-03** 在 `prototypes/pages/` 补齐核心高保真 HTML 原型（优先覆盖 `wizard`、`models`、`workspace` 四视图、`diary`、`organize`、`accounts`、`quickpanel`）

## 阶段二：黑盒 E2E 验收裁判库（`test-cases/`）

- [ ] **T05-04** 编写核心场景执行器（消费 `test-cases/scenarios/*.yaml` 对真实 Runtime 发起黑盒调用并断言）
- [ ] **T05-05** 落地 `cli-e2e/` 与 `plugin-rpc/`（含 Windows 64KB+ UTF-8 JSON、reparse point 与 `Paused` 零残留专项测试）
- [ ] **T05-06** 落地 `client2-e2e/` Playwright 双语（`en`/`zh`）回归测试集（含页面无报错、i18n 完整性与关键状态交互）

## 阶段三：Client2 PR 自动视觉预览与 E2E 集成

- [ ] **T05-07** 在 Monorepo 实现 `e2e.yml`（拉取 `respire-resources/test-cases` 在三平台 Runner 对真实编译产物执行黑盒验收）
- [ ] **T05-08** 实现 Client2 PR UI Preview 工作流（`detect -> record -> publish` 权限隔离，自动贴双语截图与 MP4 至 PR 描述）
- [ ] **T05-09** 验收归档：跑通首轮全链路 E2E 与 UI Preview 后将 `specs/prototypes-and-e2e/spec.md` 合并至 `openspec/specs/`
