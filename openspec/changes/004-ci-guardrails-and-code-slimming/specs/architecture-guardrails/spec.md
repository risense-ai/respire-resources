# Delta Spec: Architecture Guardrails & Code Slimming (`004`)

## ADDED Requirements

### Requirement: 禁用依赖与跨层隔离 CI 护栏
CI MUST 在每次 PR 中校验各组件依赖清单：禁止 `apps/cli` 依赖任何存储/服务端 crate，禁止 `apps/client2` 引入任何 SQLite 驱动，禁止 `respire-core` 引入文件或网络 I/O crate。

#### Scenario: 在 Client2 重新引入 SQLite 驱动
- **GIVEN** 某 PR 在 `apps/client2/go.mod` 中新增了 `github.com/ncruces/go-sqlite3` 或其他 SQLite 包
- **WHEN** CI 运行依赖红线校验脚本
- **THEN** 校验 MUST 失败并阻断合入

### Requirement: 单文件体量上限与单调递减棘轮
任何新增或已完成拆分的代码文件 MUST 不超过 600 行；尚未拆分的存量巨型文件在白名单棘轮约束下行数 MUST 只减不增。

#### Scenario: 提交超过 600 行的新业务文件
- **GIVEN** 某 PR 在 `apps/runtime` 中新建了一个 750 行的 Rust 模块
- **WHEN** CI 运行体量门禁
- **THEN** CI MUST 失败并提示按业务域拆分

### Requirement: 模型下载与冷加载单次流式校验
Runtime 与客户端在整个模型下载与冷加载事务内 MUST 仅执行 1 次全文件字节级 SHA-256 校验，禁止 CPU-owned 模式强求冗余 `.onnx` 文件，且禁止为下载、非活跃模型卸载或改配置而停止 Runtime 或写 `Paused`。

#### Scenario: 在线卸载非活跃模型
- **GIVEN** Runtime 正在运行且当前活跃模型为 `m3`
- **WHEN** 用户在 CLI 或 Client2 触发卸载非活跃模型 `bge-small`
- **THEN** 客户端 SHALL 通过 `/v1/models/active-assets` 确认安全后直接在线删除目录，期间 Runtime MUST 保持服务不断联且不写入 `Paused`
