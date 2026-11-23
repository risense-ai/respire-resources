# Proposal: 005-prototypes-and-e2e-acceptance

- **Change ID**: `005-prototypes-and-e2e-acceptance`
- **Status**: `proposed`
- **Depends On**: `002-runtime-openapi-v1-migration`, `003-monorepo-merge-and-release-bridge`

## 1. Why（为什么做）

过去四仓只有零散的单元测试和部分平台诊断脚本，缺少两个关键基础设施：

1. **视觉与交互事实源缺失**：`respire-client2` 没有独立的高保真 HTML 原型库与标准 Mock 夹具，AI 写完 UI 后没有客观参考基准，Maintainer 不拉代码编译到本地就看不到真实画面，还出现过引导页 `wizard.js` 正常而模型页 `models.js` 报错的页面分裂。
2. **黑盒 E2E 与跨端裁判缺失**：核心流程（冷启动、模型热切换、取消回滚、Windows 超长载荷插件调用、多语言 UI 排版）没有独立于实现之外的黑盒用例集，导致每次拆仓或重构都提心吊胆。

## 2. Goals（目标）

1. 在 `respire-resources/prototypes/` 建设覆盖 Client2 全页面的**高保真可交互 HTML 原型库**、共享 `rem` 设计令牌与确定性 Mock Runtime 夹具。
2. 在 `respire-resources/test-cases/` 建立语言无关的**黑盒 E2E 验收裁判库**（场景 YAML/JSON、`cli-e2e`、`plugin-rpc`、`client2-e2e` 与 Windows 专项回归）。
3. 借鉴 `yetone/magpie`，为 Monorepo 的 `apps/client2` 建立 **PR 自动 UI Preview 流水线**：CI 自动用 Mock Runtime 启动页面、跑 Playwright 录制双语（`en` / `zh`）截图与 MP4 交互视频并直接回贴到 PR 描述中。

## 3. Non-Goals（明确不做）

- 原型页不直接耦合真实后端二进制构建；它只消费符合 `openapi.yaml` 契约的 Mock Runtime 数据。
- UI Preview 不运行真实闭源模型推理（避免 CI 动辄拉取数 GB 模型权重拖慢反馈），模型切换与进度条由 Mock SSE 流精准模拟。

## 4. Acceptance Criteria（验收标准）

1. `prototypes/pages/` 覆盖全部核心页面，并在浏览器直接打开即可完整交互演示多状态场景。
2. `test-cases/` 覆盖核心黑盒流程与 Windows 专项测试，可在 `e2e.yml` 中一键执行校验真实产物。
3. 任何修改 `apps/client2` 前端的 PR 自动触发 UI Preview，并在 PR 描述区生成可在线观看的截图与视频。
