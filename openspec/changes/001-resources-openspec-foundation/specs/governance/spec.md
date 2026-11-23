# Delta Spec: Governance & OpenSpec Workflow (`001`)

## ADDED Requirements

### Requirement: 变更准入强约束（Spec-First Gate）
所有新增功能、接口变更、架构重构与 UI 改版 MUST 先在 `respire-resources/openspec/changes/<change-id>/` 建立完整的 OpenSpec Change 包，并获得 Maintainer 批准后方可创建业务代码修改分支。

#### Scenario: 未经批准的需求直接尝试开 PR
- **GIVEN** 一项新功能尚未在 `openspec/changes/` 中存在对应的已批准 Change 包
- **WHEN** 任何 Agent 或开发者准备开始编写业务代码
- **THEN** Implementer MUST 拒绝开工，并要求先进入 Propose 阶段补齐 `proposal.md`、`design.md`、`tasks.md` 与增量 `spec.md`

### Requirement: Change 资产结构与文档体量上限
每一个活跃 Change 目录 SHALL 包含 `proposal.md`、`design.md`、`tasks.md` 与至少一份 `specs/<domain>/spec.md`；`openspec/` 目录下任意非历史归档 Markdown 文件 MUST 不超过 400 行，且每个规范需求 MUST 包含 `MUST` 或 `SHALL` 关键字以及至少一个 `#### Scenario:` 块。

#### Scenario: 提交超长或缺少场景的规范文件
- **GIVEN** 开发者提交了一个缺少 `tasks.md` 或单个 `.md` 文件超过 400 行的 Change PR
- **WHEN** CI 执行 `node process/scripts/validate-openspec.mjs`
- **THEN** 脚本 MUST 以非零退出码失败并精确指出缺失文件或超限文件名

### Requirement: 统一 Issue/PR 可追溯元数据
所有排入 Milestone 的开发 Issue MUST 声明关联的 `Change ID`、目标 `Spec 节号`、前置依赖 Issue 及对应验收用例 ID；PR 描述 MUST 注明解决的 Issue/Change 与实测命令输出。

#### Scenario: 缺少规范链接的 Issue 进入队列
- **GIVEN** 一个新建的功能 Issue 未填写关联 `Change ID` 与验收场景
- **WHEN** Triager Agent 进行分拣检查
- **THEN** Triager MUST 标记需要补充规格信息且不得将其排入可执行队列
