# Design: 005-prototypes-and-e2e-acceptance

## 1. 高保真 HTML 原型体系（`prototypes/`）

- **共享设计令牌（`prototypes/tokens/`）**：与 Client2 统一使用流体根字号 `clamp(14px, 0.5rem + 0.62vw, 18.8px)` 与 `rem` 比例尺、颜色变量、字体栈与状态圆点规范（与 `respire-client2` 现有视觉规范一脉相承）。
- **页面全覆盖清单（`prototypes/pages/`）**：
  - 主工作区：`overview`、`recall`、`workspace`（树形 / 列表 / 卡片 / 图谱四种记忆视图）、`diary`、`organize`、`stats`；
  - 模型与设置：`wizard`（引导向导）、`models`、`accounts`、`grants`、`space-members`、`storage`、`injection`、`session-import`、`settings`、`quickpanel`。
- **确定性 Mock Runtime（`prototypes/mock-api/`）**：从现存 `respire-client2/.verification/ui-mock/server.mjs` 升级迁移而来，严格对齐 `contracts/runtime-api/openapi.yaml`，并内置多场景种子数据集（空库 / 正常千条记忆 / 模型下载与 SSE 进度 / 切换报错回滚 / 多账号切换）。

## 2. 语言无关 E2E 验收裁判库（`test-cases/`）

将验收逻辑彻底从被测应用代码库中抽离出来：

1. **`test-cases/scenarios/`（声明式黑盒场景）**：使用统一 YAML/JSON 描述前置条件、API/CLI 操作序列、SSE 状态跃迁与终态断言（例如：冷启动、模型下载中断续传、热切换期间并发 `recall` 不阻塞、失败安全回滚）。
2. **`test-cases/plugin-rpc/`（插件通信验收）**：实测外部插件通过 HTTP OpenAPI 与 `rsrs mcp` stdio 调用 Runtime。
3. **`test-cases/cli-e2e/`（真实产物黑盒）**：在隔离临时目录启动真实 `rsrs-runtime` 与 `rsrs`，验证文本/JSON 输出、自启与退出码。
4. **`test-cases/client2-e2e/`（Playwright 跨语种 + 布局守护）**：在 `en` 与 `zh` 两种语言下验证全页面无 i18n 缺失键、无 `NaN`/溢出截断、图标对齐及交互可用性。
5. **Windows 专项回归用例（必跑）**：
   - 超长 UTF-8 JSON（> 64 KB）经 HTTP/MCP 写入与召回无截断；
   - 包含空格/中文/OneDrive reparse point 的数据目录安全操作与在线模型清理；
   - 单实例互斥锁与正常停止语义（无僵尸进程、无残余 `Paused`）。

## 3. Client2 PR 自动 UI Preview 流水线（借鉴 Magpie）

```text
PR 修改 apps/client2/frontend/**
  ├─▶ detect job (仅读元数据，打回无写权限)
  ├─▶ record job (无令牌沙箱：起 Mock Runtime + Playwright Chromium)
  │      ├─ 生成 en / zh 关键页面高清截图
  │      ├─ 录制交互操作 MP4 (含模拟鼠标轨迹)
  │      └─ 扫描截图/录屏确保无敏感 Token 泄露
  └─▶ publish job (推送产物至预览分支并在 PR 正文锚点区插入截图与视频链接)
```

安全边界同 Magpie 一致：执行 PR 代码的 `record` job 不持有仓库写入凭据；持有写入权限的 `publish` job 不执行 PR 代码。

## 4. Risks & Rollback

- **风险**：HTML 原型与真实前端逐渐脱节，变成“两份静态废纸”。
- **缓解**：要求所有 UI 类 OpenSpec Change 必须先更新原型并通过 `test-cases/client2-e2e` 视觉基线比对；原型直接复用 `tokens/` 与 `mock-api/`。
- **回滚**：UI Preview 初期可先设 `continue-on-error: false` 于独立预览流水线，不直接阻断后端非 UI PR 的合入。
