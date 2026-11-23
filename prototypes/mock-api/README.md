# prototypes/mock-api — 确定性 Mock Runtime 服务

本目录在 Change `005` 期间承接并升级 `respire-client2/.verification/ui-mock/server.mjs`，为以下两类场景提供统一数据源：

1. **HTML 原型浏览器演示**：离线模拟正常千条记忆、空库、模型下载 SSE 进度条、切换失败回滚与多账号状态；
2. **Client2 PR 自动 UI Preview**：由 CI 中的无写权限沙箱调用，驱动 Playwright 自动生成英文/中文截图与交互录屏回贴至 PR。
