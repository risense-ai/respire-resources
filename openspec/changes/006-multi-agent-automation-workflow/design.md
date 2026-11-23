# Design: 006-multi-agent-automation-workflow

## 1. 六角色协同拓扑（人类只抓“前门批准”与“后门终审”）

| 角色 | 主体 | 工具权限边界 | 核心职责与交付物 |
| --- | --- | --- | --- |
| **Maintainer** | **人类** | 仓库管理与合并最高权限 | 提出需求、批准 OpenSpec/原型、裁决取舍、看截图/证据终审合并 |
| **Triager / Spec** | AI | 读写 `respire-resources` 提案与 Issue 标签 | 分拣 Issue（查重/补全 Spec 与依赖）、起草 Change 四件套；**严禁替人批准** |
| **Implementer** | AI | 仅可在隔离 `.worktrees/<id>/` 写代码与开 PR | 按已批准 `tasks.md` 实现并跑单测，附前后行为对比与命令证据 |
| **Verifier** | AI | **严格只读**（新进程、独立上下文，禁改代码/Issue） | 独立核验 PR Diff、跑 `test-cases/` 黑盒 E2E 与一致性检查，输出结构化裁决（允许标“未实测”） |
| **Scribe** | AI | 读写文档、`LESSONS.md`、CHANGELOG | 维护 `openspec/specs/` 归档、同步 `LESSONS.md` 与记忆库 |
| **Release Manager** | AI | 机械执行打 Tag 与发版校验 | 根据 Maintainer 指定版本号检查门禁并触发组件独立 Tag 与产物核验 |

## 2. 确定性流程引擎 `respire-process`（借鉴 `sebas-process`）

用纯脚本语言（Node.js `.mjs`）实现零歧义的流程状态机，避免让 LLM 自由猜测下一步：

1. **`next`（智能选卡）**：拉取当前 Milestone 中所有 `Spec Approved` 状态且前置依赖 Issue 已有可信 `Evidence` 的任务，排除被阻塞项，输出唯一建议的下一步动作与对应 Worktree 指令。
2. **`verify-merge <pr>`（合并前硬门禁）**：Fail-Closed 校验：
   - 对应 OpenSpec Change 已获批准；
   - GitHub CI（含 `ci-gate`、架构护栏、`oasdiff`、UI Preview）全绿；
   - 存在来自独立 `Verifier` 的核验结论，且所有 `must_fix` 均已关闭；
   - PR 作者与 Verifier 身份非同一单次会话/自审。
3. **`evidence-register`（可信证据自动登记）**：PR 合并且关联 Issue 关闭、主干 CI 全绿后，由仅授予 `github-actions[bot]` 的工作流写入不可伪造的结构化 Evidence 评论，自动解锁 DAG 下游 Issue。

## 3. 夜间 `LESSONS.md` 审计与护栏升格机制（借鉴 `magpie`）

- 每周或每次 Milestone 收官自动运行审计任务，扫描 `git log` 中所有 `fix:`、`revert` 及被打回多次的 PR；
- 归类分析“为何当时 CI 和 Reviewer 没拦住”；
- 发现连续出现 **≥ 3 次** 的共性问题（如模型切换吞错、偏好白名单遗漏、跨模块重复实现），自动生成一个带 `guardrail` 标签的 OpenSpec Change 草案，直接把它变成一条永久 CI 守护测试。

## 4. Risks & Rollback

- **风险**：多 Agent 流程过繁导致小型紧急修复响应变慢。
- **缓解**：为紧急 `hotfix/` 提供快速通道（仍需独立 Verifier 快速复核核心回归与事后 24 小时补写 `LESSONS.md`）。
- **回滚**：`respire-process` 作为纯 CLI 编排层运行，任何时刻 Maintainer 均可手工覆盖标签或直接合入紧急补丁，流程脚本本身不影响业务运行时。
