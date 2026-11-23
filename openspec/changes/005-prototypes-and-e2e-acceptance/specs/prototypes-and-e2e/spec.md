# Delta Spec: Prototypes, E2E Suite & Visual UI Preview (`005`)

## ADDED Requirements

### Requirement: 高保真 HTML 原型作为 UI 唯一设计基准
所有桌面端新增界面或交互改版 MUST 先在 `respire-resources/prototypes/pages/` 中提供可离线浏览器预览的高保真 HTML 原型，并与 `prototypes/mock-api/` 的标准状态场景打通。

#### Scenario: 评审新设计的模型管理页面
- **GIVEN** 一项涉及前端模型页改版的 OpenSpec Change
- **WHEN** Maintainer 在本地浏览器打开 `prototypes/pages/models.html`
- **THEN** 页面 SHALL 依托 Mock 数据完整呈现下载中、SSE 进度、切换失败回滚与在线卸载四类状态，供合并前拍板

### Requirement: 独立黑盒 E2E 与 Windows 专项回归
`respire-resources/test-cases/` MUST 独立于应用源码运行黑盒验收，覆盖 Runtime、CLI、Client2、插件 HTTP/MCP 调用及 Windows 专项边界（超长 UTF-8 JSON、路径/符号链接、进程锁）。

#### Scenario: 验证 Windows 超长文本插件调用回归
- **GIVEN** Windows Runner 上运行打包后的真实 `rsrs-runtime` 与 `rsrs`
- **WHEN** `test-cases/plugin-rpc` 发起包含 100 KB 中文/Emoji JSON 的 HTTP 与 MCP 写入请求
- **THEN** 所有内容 MUST 完整写入并可被召回，且不触发命令行长度截断或编码异常

### Requirement: Client2 PR 自动截图与录屏视觉预览
任何修改 `apps/client2` 前端资产或 GUI 接口的 PR MUST 自动在隔离无写权限任务中运行 Playwright + Mock Runtime，生成英文与中文截图或 MP4 演示并回贴至 PR 描述。

#### Scenario: 仅改 Client2 界面样式的 PR 验收
- **GIVEN** Implementer 提交了修改 `apps/client2` 模型卡片样式的 PR
- **WHEN** UI Preview 工作流完成运行
- **THEN** PR 描述区 SHALL 自动更新最新的双语截图与操作视频，Maintainer 无需本地拉代码编译即可完成视觉验收
