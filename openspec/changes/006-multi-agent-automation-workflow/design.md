# Design: 006-multi-agent-automation-workflow

## 1. 六角色权限与上下文隔离原则

六角色详细指令集已沉淀在 `process/roles/`（`implementer`、`verifier`、`triager`、`scribe`、`release-manager` + 人类 `maintainer`）。核心防线为：
- **进程级做验分离**：Implementer 完成编码并使 `ci-gate` 变绿后，必须在新会话启动**只读权限的 Verifier Agent** 执行核验；
- **人类双闸门控盘**：人类仅拍板“批准 OpenSpec/原型（前门）”与“终审合并 PR / 指定发版号（后门）”。

## 2. 确定性流程引擎 `process/scripts/respire-process.mjs` 规格

借鉴 `ShiningRay/sebas-process`，采用纯 Node.js（零外部依赖）封装确定性 CLI 状态机，退出码契约如下：
- `0`：校验通过 / 选卡成功；
- `1`：配置错误、非法格式、结构校验失败或缺少可信凭据（Fail-Closed）；
- `2`：`blocked` 或 `needs_human`（需人类 Maintainer 介入裁决）。

### 核心子命令定义

| 子命令 | 功能与输入 | Fail-Closed 校验规则 |
| --- | --- | --- |
| `roles [name] [--one-line]` | 输出指定或全部角色的标准化冷启动指令 | 角色文件缺失立即报错退出 `1` |
| `next [--repo <name>]` | 读取当前活跃 Milestone 的 Issue、OpenSpec 状态与前置 `Evidence` | 前置依赖未关闭或缺少可信 `Evidence` 的 Issue 标记 `blocked` 跳过，返回唯一可执行任务 JSON |
| `verify-merge <pr> <issue>` | PR 合并前最终门禁核查 | 核对 CI `ci-gate` 全绿 + 非同一作者的独立 Verifier `PASS` 裁决 + 无未解决 `must_fix`；缺任一项退出 `1` |
| `evidence-register <pr>` | 由 CI Bot 调用，为已合并且全绿的 PR 登记结构化 `Evidence` 评论 | 验证 PR 已合并入 `main`、关联 Issue 已关闭、HEAD SHA 全检通过、幂等防重复；否则拒绝写入 |

## 3. 可信身份白名单与 Evidence 自动登记

- 在 `.github/agents.yml` 声明两档独立身份白名单：
  - `maintainers: [luodaoyi]`（人类裁决权）；
  - `trusted_bots: [github-actions[bot]]`（仅限受信任 CI Workflow 自动登记 Evidence）。
- `evidence-register.yml` 仅在主干合并后 CI 全绿时由 `github-actions[bot]` 触发，回查评论真实作者是否在白名单内，杜绝普通评论伪造验收记录。

## 4. `LESSONS.md` 夜间复盘与三振升格闭环（借鉴 `magpie`）

每周/每 Milestone 收官自动执行审计工作流：
1. 汇总区间内 `fix:`、`revert` 提交及被打回超过 1 轮的 PR；
2. 提炼根因并追加至 `LESSONS.md`；
3. 检查同类标签计数：凡累计出现 **≥ 3 次** 的同类缺陷，自动在 GitHub 开出带 `guardrail` 标签的 Issue，要求转化为自动化守护测试写入 `check-guardrails.mjs` 或 `test-cases/`。

## 5. Risks & Rollback

- **风险**：早期流程脚本若边界判断过严，可能把合法紧急任务误拦为 `blocked`。
- **缓解**：所有门禁均支持 Maintainer 在紧急 `hotfix/` 场景手动覆盖合并，同时自动记录 `LESSONS.md` 审计项以修正规则，不阻塞线上救火。
