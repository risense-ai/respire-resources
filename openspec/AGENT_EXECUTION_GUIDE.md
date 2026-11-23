# Respire 多 Agent 冷启动执行手册（Agent Execution Guide）

> **目标**：任何刚打开会话的外部 AI Agent（Codex / Claude Code / Antigravity / Cursor），只需读完本文件与目标 Change 目录，即可**零上下文直接按文档推进开发或验收**，无需人工反复解释背景。

---

## 1. 本地与 GitHub 仓库地图

所有仓库统一位于本地 `D:\sources\repos-new\gh\1memory\`：

| 目录 / 仓库 | GitHub 地址 | 角色与操作边界 |
| --- | --- | --- |
| **`respire-resources/`** | `risense-ai/respire-resources` | **SSOT 中枢仓**（OpenSpec、OpenAPI 3.1、HTML 原型、E2E 用例、角色指南） |
| **`respire/`** | `risense-ai/respire` | **开源 Monorepo**（`apps/runtime`、`apps/cli`、`apps/client2`、`packages/runtime-sdk-*`） |
| **`respire-core/`** | `risense-ai/respire-core`（私有） | 纯内存推理与检索内核（C ABI）；只在 `.worktrees/<id>/respire-core` 施工 |
| **`respire-runtime/`** | `risense-ai/respire-runtime` | **迁移源仓**（`003` 合入 `respire/` 后代码冻结，仅接收 Release 镜像） |
| **`respire-cli/`** | `risense-ai/respire-cli` | **迁移源仓**（`003` 合入 `respire/` 后代码冻结，仅接收 Release/NPM 镜像） |
| **`respire-client2/`** | `risense-ai/respire-client2` | **迁移源仓**（`003` 合入 `respire/` 后代码冻结，仅接收 Release 镜像） |

---

## 2. 任何 Agent 开工前必执行的 6 步协议

1. **读宪法与路线图**：依次阅读 `respire-resources/AGENTS.md`、`respire-resources/LESSONS.md`、`openspec/ROADMAP.md`。
2. **确认 Change 状态**：打开目标 `openspec/changes/<change-id>/` 的 `proposal.md`、`design.md`、`tasks.md` 与 `specs/*/spec.md`。
   - **硬闸门**：若任务涉及修改业务代码（`respire` / `respire-core`），必须确认该 Change 的前置依赖已完成且 Change 已获 Maintainer 批准；未获批时立即停下请人类 Maintainer 批准。
3. **建立独立 Worktree（严禁直接改干净主副本）**：
   - 在工作区根目录创建隔离工作树，例如：
     `git -C respire worktree add ../.worktrees/<change-id>/respire -b feat/<change-id>`
   - **严禁在 `respire-runtime`、`respire-cli`、`respire-client2` 主目录写新功能**（`003` 完成后它们仅作 Release 分发镜像）。
4. **按 `tasks.md` 原子施工（1 PR = 1 目标）**：
   - 严格勾选当前推进的任务项，严禁擅自扩 scope、改写其他端或越过 `contracts/runtime-api/openapi.yaml` 手写 DTO。
   - 保持新改业务代码文件 **≤ 600 行**，OpenSpec Markdown **≤ 400 行**。
5. **运行确定性本地校验**：
   - 改 `respire-resources` 必跑：`node process/scripts/validate-openspec.mjs`
   - 改 `respire` 必跑：`node scripts/check-guardrails.mjs` 及对应端单测（仅改 `apps/client2` 只跑 Go/前端检查）。
6. **移交独立只读 Verifier 验收**：
   - Implementer 不得宣布“最终验收通过”；完成 PR 后在**新会话**启动只读 `Verifier` 对照 `specs/*/spec.md` 与 `test-cases/` 出具实证结论。

---

## 3. 停下上报条件（STOP & Escalate）

遇到以下任一情况，Agent **必须立刻停工并向人类 Maintainer 报告**，严禁自行猜测绕过：

- 目标 Change 或依赖的前置 Change 仍为 `proposed` 且未获 Maintainer 明确口头/Issue 批准；
- 需要对 `contracts/runtime-api/openapi.yaml` 或 `core-abi` 做破坏性变更（`oasdiff` 报错）；
- 现有测试或 CI 护栏连续失败 2 次且无法在当前 Change 边界内修复；
- 发现需要修改四层架构边界（例如让 CLI 直接打开业务 SQLite 或引入 `go-sqlite3`）。

---

## 4. 可直接复制的一句话派单提示词（按阶段与角色）

### 按阶段推进（001 → 006）

- **推进 001（基建与看板）**：
  > 请阅读 `respire-resources/openspec/changes/001-resources-openspec-foundation/` 全部文档，作为 Implementer 在已获我批准的前提下，按 `tasks.md` 阶段二依次配置 GitHub Project、Milestones 与分支保护，并在完成后输出每条命令的真实结果。
- **推进 002（OpenAPI 3.1 与 SDK）**：
  > 请阅读 `respire-resources/openspec/changes/002-runtime-openapi-v1-migration/` 与 `contracts/runtime-api/openapi.yaml`，按 `tasks.md` 阶段一在独立 Worktree 补齐 OpenAPI 校验、黄金夹具与 `packages/runtime-sdk-{rs,go,ts}` 生成链，禁止手改生成代码。
- **推进 003（三仓历史合入与独立 CI/Release）**：
  > 请严格按照 `respire-resources/openspec/changes/003-monorepo-merge-and-release-bridge/design.md` 与 `tasks.md`，在隔离临时目录将 `respire-runtime`、`respire-cli`（过滤 5.4 万行遗留服务端与废旧 workflow）、`respire-client2` 带历史导入 `respire/` Monorepo，配置路径路由 `ci-gate` 与 Release Fan-Out。
- **推进 004（CI 护栏与深度瘦身）**：
  > 请先按 `respire-resources/openspec/changes/004-ci-guardrails-and-code-slimming/` 在 `respire` 与 `respire-core` 落盘全部防退化 CI 护栏脚本，再按 `tasks.md` 逐个原子 PR 推进四端瘦身，严禁删减既有业务功能。
- **推进 005（原型、E2E 与 PR UI Preview）**：
  > 请按 `respire-resources/openspec/changes/005-prototypes-and-e2e-acceptance/` 将 `ui-mock` 迁移至 `respire-resources/prototypes/mock-api/`，补齐 HTML 原型、Windows 专项 E2E 用例以及 `apps/client2` 的 PR 自动录屏预览流水线。
- **推进 006（多 Agent 自动流转）**：
  > 请按 `respire-resources/openspec/changes/006-multi-agent-automation-workflow/` 实现 `process/scripts/respire-process.mjs`、单测与 `evidence-register.yml`、`LESSONS.md` 夜间审计工作流。

### 按独立角色派单

- **Implementer**：见 [process/roles/implementer.md](../process/roles/implementer.md)
- **Verifier（新会话只读验收）**：见 [process/roles/verifier.md](../process/roles/verifier.md)
- **Triager / Scribe / Release Manager**：见 [process/roles/README.md](../process/roles/README.md)
