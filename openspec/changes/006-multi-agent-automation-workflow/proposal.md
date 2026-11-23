# Proposal: 006-multi-agent-automation-workflow

- **Change ID**: `006-multi-agent-automation-workflow`
- **Status**: `proposed`
- **Depends On**: `004-ci-guardrails-and-code-slimming`, `005-prototypes-and-e2e-acceptance`

## 1. Why（为什么做）

即使建好了 OpenSpec 文档、OpenAPI 契约和 E2E 用例，如果日常开发仍然靠人手工把提示词喂给单个 AI 会话、让它自己改代码又自己宣布“测试全通过”，依然会重演以下三类失控问题：

1. **自写自验偏差**：同一个上下文既写实现又做验收，容易为凑绿而放宽断言或漏测边界场景；
2. **选卡与协同混乱**：多个 Agent 并行开发时不知道哪些 Issue 依赖已满足、哪些还在等下游，甚至互相踩脏工作区；
3. **同类缺陷反复回归**：今天修复的 Bug 明天又在新模块犯一遍，经验没有沉淀为机器防线。

本 Change 结合 `ShiningRay/sebas` 的**六角色写验分离与确定性状态机**和 `yetone/magpie` 的**夜间复盘进化机制**，打造适合 Respire 的全自动 AI 研发流水线。

## 2. Goals（目标）

1. 确立六角色职责与权限硬边界：人类 Maintainer（拍板/终审/合并）+ AI（Spec/Triager、Implementer、独立只读 Verifier、Scribe、Release Manager）。
2. 在 `respire-resources/process/` 落盘确定性流程 CLI 工具 `respire-process`（校验 OpenSpec DAG 就绪度、自动选卡、合并前门禁检查与可信 Evidence 校验）。
3. 落地自动可信 Evidence 登记流水线：PR 合并且全绿后由受信任 Bot 自动登记验收证据以解锁下游任务。
4. 建立夜间/定期 `LESSONS.md` 审计闭环：自动汇总近期 `fix:` 与回滚记录，同类问题出现 ≥ 3 次强制转写为 CI 守护测试。

## 3. Non-Goals（明确不做）

- 绝不将产品方向、OpenSpec 批准、破坏性契约变更决策或最终合并拍板交给 AI 自动越权完成。
- 不依赖不可复现的“LLM 语义打分”替代确定性的测试与契约校验（同 `sebas` 原则）。

## 4. Acceptance Criteria（验收标准）

1. Implementer 与独立只读 Verifier 可通过 `respire-process` 在新进程/隔离 Worktree 中按标准指令流转协作，全程禁止自写自验。
2. 合并 PR 前执行 `respire-process verify-merge` 检查（需全部 CI 绿灯 + 只读 Verifier 核验通过 + E2E 证据齐全）。
3. 定期复盘流能够自动读取近期修复提交并提议新的 `LESSONS.md` 条目与 CI 护栏 Issue。
