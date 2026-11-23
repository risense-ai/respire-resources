# AGENTS.md — Respire 全局 AI Agent 开发宪法

> 本文件是 Respire 所有仓库（`respire-resources`、`respire-core`、以及未来的 `respire` Monorepo）的**最高工程总纲**。各代码仓的 `AGENTS.md` 仅可补充本仓特有的构建命令或细节，**不得削弱或违背本文件的任何红线**。

---

## 1. Spec-First 硬规则（先定规范，再写代码）

1. **禁止无单开工**：任何新功能、跨模块重构、协议调整或 UI 改版，必须先在 `respire-resources/openspec/changes/<change-id>/` 建立完整的 OpenSpec Change 包（`proposal.md`、`design.md`、`tasks.md`、`specs/<domain>/spec.md`）。
2. **批准闸门**：在 Maintainer（人类负责人）明确批准对应的 OpenSpec Change（以及关联的 OpenAPI Diff / HTML 原型）之前，禁止 Implementer Agent 创建代码分支或修改产品源码。
3. **契约单源**：Runtime 对外接口的唯一事实源是 `contracts/runtime-api/openapi.yaml`；Core FFI 边界的唯一事实源是 `contracts/core-abi/`。禁止先改实现再补契约，禁止客户端手写重复 DTO。

---

## 2. 四层架构边界铁律（零容忍）

| 层级 / 组件 | 唯一合法职责 | 绝对禁区（触发即阻断 PR） |
| --- | --- | --- |
| **`respire-core`** | 纯内存核心算法与推理引擎（向量化、ONNX/MLX 会话、混合检索排序、`deepen_plan`、分类、C ABI） | 禁止本地文件/目录/SQLite 读写、网络请求、密钥解密、默认路径发现或宿主 Catalog 适配 |
| **`apps/runtime`** | 全系统唯一权威控制面与数据面（SQLite 持久化、模型目录与托管下载/热切换、OpenAPI 3.1 + SSE 服务、旧 RPC 薄兼容层、账户/空间事务） | 禁止引入 Clap 二次语法树、TTY 交互提示（`prompt`）、IDE 注入（`inject`）或客户端逻辑 |
| **`apps/cli`** | 超薄 CLI / TUI / `rsrs mcp` stdio 桥 / Runtime 二进制启停安装与 OS 自启 | 禁止包含服务端 crate（`storage` / `core-sdk` / `app` / `axum`）、禁止直连业务 SQLite、禁止为下载或改配置停服写 `Paused` |
| **`apps/client2`** | Wails 桌面壳、托盘、OS 系统代理与密钥库桥接、HTTP API / SSE 消费、轻量本地页面 | 禁止引入任何 SQLite 驱动（如 `go-sqlite3` WASM）、禁止重写账户/空间/模型状态机、禁止向 Runtime 拼接 `cli.exec` 参数表 |

---

## 3. 做—验分离（Maker-Checker Separation）

1. **独立上下文原则**：写代码的 `Implementer Agent` 绝不允许给自己出具最终验收结论。验收必须由**新进程、独立上下文、只读权限的 `Verifier Agent`** 执行。
2. **实证主义**：每一条验收结论必须锚定可复现的命令输出、HTTP 响应、测试日志或截图/录屏路径；严禁使用“应该没问题”“逻辑上正确”等推测词。
3. **诚实标注未实测**：受限于环境无法运行的平台或用例，必须如实标注 `未实测` 及原因，**绝对禁止伪造、跳过或放宽断言凑绿**。

---

## 4. 协议演进与能力协商

1. **能力位驱动，永不绑定版本号**：客户端（CLI / Client2 / 插件）与 Runtime 协作时，只能检查 `GET /v1/health`（或旧 `/health`）返回的 `capabilities` 字段决定走新契约还是降级，**禁止通过字符串比较 Runtime 版本号做分支**。
2. **Windows 命令行禁令**：插件与外部工具一律通过 Runtime 本地 HTTP（OpenAPI 3.1）或 `rsrs mcp` stdio 通信，禁止通过拼接长命令行参数调用业务功能。

---

## 5. 工作树隔离、体量红线与提交规范

1. **Worktree 隔离**：禁止直接在干净主分支工作副本中修改、构建或切换分支；所有改动必须在 `.worktrees/<change-id>/<repo>` 独立分支进行。
2. **单文件规模红线**：
   - 规范与设计 Markdown 文档（除历史归档外）单文件 **≤ 400 行**；
   - 新增或重构后的业务源码（Rust / Go / JS）单文件 **≤ 600 行**，超出必须拆模块。
3. **文档引用禁令**：文档引用代码或规范时使用 `§节号`、文件路径或具名符号，禁止硬编码易过期的源码行号锚点。
4. **Rust 安全红线**：产品代码禁止新增 `.unwrap()` 或 `.expect()`。
5. **Commit 与 PR 记录**：使用 Conventional Commits（`feat(runtime): ...`），PR 描述必须写明关联 `change-id` / `issue`、行为前后变化与实际执行过的验证命令。
