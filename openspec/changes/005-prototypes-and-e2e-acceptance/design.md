# Design: 005-prototypes-and-e2e-acceptance

## 1. 高保真 HTML 原型体系（`prototypes/`）

- **共享设计令牌（`prototypes/tokens/`）**：提取与 Client2 一致的流体根字号 `clamp(14px, 0.5rem + 0.62vw, 18.8px)`、`rem` 间距/字号标尺、明暗主题色板与圆点状态组件。
- **完整 16 个界面原型清单（`prototypes/pages/`）**：
  - 引导与速览：`wizard.html`、`overview.html`、`quickpanel.html`
  - 记忆核心：`workspace.html`（树形 / 列表 / 卡片 / 图谱四种视图）、`recall.html`、`diary.html`、`organize.html`
  - 模型与存储：`models.html`、`storage.html`、`session-import.html`、`stats.html`
  - 账户与配置：`accounts.html`、`grants.html`、`space-members.html`、`injection.html`、`settings.html`
- **确定性 Mock Runtime（`prototypes/mock-api/server.mjs`）**：从 `respire-client2/.verification/ui-mock/server.mjs` 升级迁移并严格实现 `openapi.yaml` 全部 `/v1/*` 路由与 SSE 进度流，内置 5 套固定种子数据（`empty`、`rich-1k`、`downloading-sse`、`switch-rollback-error`、`multi-account`）。

## 2. 黑盒 E2E 验收裁判库（`test-cases/`）

1. **`scenarios/*.yaml`**：声明式场景驱动器对真实启动的 `rsrs-runtime` 发请求并校验状态跃迁（冷启动、SSE 下载取消、模型切换期并发 `recall` 不卡死、切换失败回滚）。
2. **`plugin-rpc/` & Windows 专项必测命令**：
   - 在隔离目录启动真实 `rsrs-runtime` 与 `rsrs mcp`，经 HTTP `POST /v1/memories` 与 MCP stdio 提交 **100 KB+ UTF-8（含中文与 Emoji）JSON 载荷**并核验召回一致；
   - 在含空格/中文与 OneDrive reparse point 模拟目录的 Windows Runner 上测试在线卸载非活跃模型与 `Paused` 零残留。
3. **`client2-e2e/`（Playwright 双语断言）**：在 `en` 与 `zh` 两种语言下遍历全部核心页面，断言无控制台报错、无缺失 i18n Key、无溢出截断与状态同步正常。

## 3. Client2 PR 自动 UI Preview 流水线（借鉴 `yetone/magpie`）

在 `risense-ai/respire/.github/workflows/ui-preview.yml` 实现三段式权限隔离预览流：

1. **`detect` job**（`contents: read`, `pull-requests: write`）：仅当 PR 改动 `apps/client2/**/frontend/**`、`apps/client2/**/desktop/**` 或带 `ui-preview` 标签时触发；写入 PR 摘要占位块并导出安全元数据 Artifact。
2. **`record` job**（`permissions: {}`，无写权限沙箱）：拉起 `prototypes/mock-api/server.mjs` + 编译 PR 头部 Client2 WebUI，运行 Playwright 按受影响页面录制 **英文/中文高清截图** 及带模拟指针轨迹的 **MP4 演示视频**，扫描产物确认无 Token 泄露后上传 Artifact。
3. **`publish` job**（`contents: write`, `pull-requests: write`，不执行任何 PR 代码）：将截图/视频推送至 `ui-previews` 预览分支并在 PR 描述固定标记区内嵌展示图片与视频链接。

## 4. Risks & Rollback

- **风险**：PR 代码在 `record` job 运行可能存在不可信 fork 安全隐患。
- **缓解**：严格遵循 `magpie` 安全隔离模式——`record` job 零写入 Token 且只连接本地 Mock；`publish` job 绝不 checkout 或执行 PR 代码。
- **回滚**：UI Preview 独立成 workflow，异常时不影响非 UI PR 的 `ci-gate`。
