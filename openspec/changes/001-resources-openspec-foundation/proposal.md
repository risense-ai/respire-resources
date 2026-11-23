# Proposal: 001-resources-openspec-foundation

- **Change ID**: `001-resources-openspec-foundation`
- **Status**: `proposed`
- **Owner**: Maintainer (`luodaoyi`)

## 1. Why（为什么做）

当前 Respire 四个代码仓库缺乏统一的规范事实源、变更准入制度和研发看板，导致需求往往直接跳过设计与契约进入编码阶段，最终出现“兵来将挡”式补丁堆积、跨仓逻辑重复重写（如 `respire-cli` 滞留 5.4 万行服务端代码、`respire-client2` 重写 1.1 万行状态机）以及 AI Agent 在不同仓库遵守截然不同规则的问题。

必须先建立独立的 `risense-ai/respire-resources` 仓库，确立 OpenSpec 强约束工作流、GitHub Project 里程碑体系以及统一的 AI 治理基线。

## 2. Goals（目标）

1. 建立 `risense-ai/respire-resources` 作为跨仓规范、契约、原型、E2E 用例与治理模板的**唯一事实源（SSOT）**。
2. 确立 OpenSpec 四步硬约束生命周期：`Propose -> Maintainer Approve -> Apply -> Verify -> Archive`。
3. 规定 GitHub Project 跨仓看板、Milestone 排期规则及标准化 Issue/PR 元数据必填字段。
4. 统一全局 `AGENTS.md` 宪法、`LESSONS.md` 事故复盘台账和严格版 `.coderabbit.yaml` 路径审查模板。
5. 提供零第三方依赖的自动化结构校验脚本 `process/scripts/validate-openspec.mjs` 与 CI 工作流。

## 3. Non-Goals（明确不做）

- 本阶段不修改 `respire-core`、`respire-runtime`、`respire-cli`、`respire-client2` 任何现有产品源码。
- 不在本阶段直接定义全部业务 OpenAPI 细则（由 `002` 承接）或执行 Monorepo 合并（由 `003` 承接）。

## 4. Acceptance Criteria（验收标准）

1. `risense-ai/respire-resources` 仓库已创建并包含完整骨架、`AGENTS.md`、`LESSONS.md`、`openspec/ROADMAP.md` 与模板目录。
2. `node process/scripts/validate-openspec.mjs` 在本地与 GitHub Actions CI 上均返回退出码 `0`。
3. 组织级 GitHub Project 看板与首个里程碑建立完成，后续一切研发任务均按模板关联 `change-id`。
