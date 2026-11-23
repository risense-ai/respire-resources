# Respire 多 Agent 冷启动执行手册（Agent Execution Guide）

> **目标**：任何刚打开会话的外部 AI Agent（Codex / Claude Code / Antigravity / Cursor），只需读完本文件与 `process/scripts/respire-process.mjs`，即可**自动按 GitHub Milestones、Issue DAG 与 OpenSpec 规范推进开发或验收**。

---

## 1. 本地与 GitHub 仓库地图

所有仓库统一位于本地 `D:\sources\repos-new\gh\1memory\`：

| 目录 / 仓库 | GitHub 地址 | 角色与操作边界 |
| --- | --- | --- |
| **`respire-resources/`** | `risense-ai/respire-resources` | **SSOT 中枢仓**（OpenSpec、OpenAPI 3.1、HTML 原型、E2E 用例、编排脚本） |
| **`respire/`** | `risense-ai/respire` | **开源 Monorepo**（`apps/runtime`、`apps/cli`、`apps/client2`、`packages/runtime-sdk-*`） |
| **`respire-core/`** | `risense-ai/respire-core`（私有） | 纯内存推理与检索内核（C ABI）；只在 `.worktrees/<id>/respire-core` 施工 |
| **`respire-runtime/`** | `risense-ai/respire-runtime` | **迁移源仓**（`003` 合入 `respire/` 后代码冻结，仅接收 Release 镜像） |
| **`respire-cli/`** | `risense-ai/respire-cli` | **迁移源仓**（`003` 合入 `respire/` 后代码冻结，仅接收 Release/NPM 镜像） |
| **`respire-client2/`** | `risense-ai/respire-client2` | **迁移源仓**（`003` 合入 `respire/` 后代码冻结，仅接收 Release 镜像） |

---

## 2. 任何 Implementer Agent 开工必执行的 6 步协议

1. **先用 `respire-process` 自动选卡（严禁自己乱挑任务）**：
   ```sh
   cd respire-resources
   node process/scripts/respire-process.mjs status   # 查全部 M1-M6 进度与阻塞关系
   node process/scripts/respire-process.mjs next     # 自动输出唯一可执行任务（Fail-Closed）
   ```
   - 若 `next` 返回退出码 `2`（提示待 Maintainer 批准或 `needs:human`），**必须立刻停下并汇报 Maintainer**，严禁跳过审批或私自开工。
2. **认领锁定卡片**：
   ```sh
   node process/scripts/respire-process.mjs claim <CARD-XXX>
   ```
   - 自动给对应 GitHub Issue 打上 `agent:in-progress` 并移除 `agent:ready`。
3. **读齐规范与契约**：依次阅读 `respire-resources/AGENTS.md`、`LESSONS.md` 与该卡片指向的 `openspec/changes/<change-id>/{proposal,design,tasks,specs/*/spec}.md`。
4. **建立独立 Worktree（严禁直接改干净主副本）**：
   - 按 `next` 输出的命令建立隔离工作树（例如 `git -C respire worktree add ../.worktrees/<card-id>/respire -b feat/<card-id>`）。
   - **严禁在 `respire-runtime`、`respire-cli`、`respire-client2` 主目录写新功能**。
5. **按 `tasks.md` 原子施工并运行本地门禁**：
   - 保持新改业务代码文件 **≤ 600 行**，OpenSpec Markdown **≤ 400 行**，Rust 产品代码零新增 `.unwrap()` / `.expect()`。
   - 改 `respire-resources` 必跑 `node process/scripts/validate-openspec.mjs`；改 `respire` 必跑 `node scripts/check-guardrails.mjs` 及对应端单测。
6. **提 PR 绑定 Milestone 并移交独立只读 Verifier**：
   - PR **必须设置对应的 GitHub Milestone**（与卡片一致），且正文必须包含 **`Fixes <owner/repo>#<issue号>`** 及真实验证命令输出；
   - 完成后由**新会话只读 Verifier** 对照 `specs/` 与 `test-cases/` 核验，Implementer 禁止自写自验。

---

## 3. 停下上报条件（STOP & Escalate）

遇到以下任一情况，Agent **必须立刻停工并向人类 Maintainer 报告**：

- `respire-process.mjs next` 返回退出码 `2`（待 `spec:approved` 或 `needs:human`）；
- 需要对 `contracts/runtime-api/openapi.yaml` 或 `core-abi` 做破坏性变更（`oasdiff` 报错）；
- 现有测试或 CI 护栏连续失败 2 次且无法在当前卡片边界内修复；
- 发现需要突破四层架构边界（例如让 CLI 直接打开 SQLite 或引入 `go-sqlite3`）。

---

## 4. 一句话派单提示词（直接复制给其他 Agent）

- **全自动选卡开工（Implementer）**：
  > 你是 Respire 的 Implementer。先阅读 `respire-resources/AGENTS.md` 与 `respire-resources/openspec/AGENT_EXECUTION_GUIDE.md`，在 `respire-resources` 目录下执行 `node process/scripts/respire-process.mjs next`：若退出码为 2 则立刻停止向我汇报；若拿到 `READY` 卡片，执行 `claim` 后在独立 `.worktrees/` 按对应 OpenSpec `tasks.md` 实现，PR 必须关联同一 Milestone 并写 `Fixes <repo>#<num>`，禁止自写自验。
- **独立只读验收（Verifier，新会话启动）**：
  > 你是 Respire 的只读 Verifier（严禁改任何源码或 Issue）。阅读 `respire-resources/process/roles/verifier.md`，核对目标 PR 的 Diff、CI 护栏、`ci-gate`、关联 OpenSpec 场景与 `test-cases/` 实跑结果，按 `PASS / CONDITIONAL / REJECT` 出具实证结论（跑不了如实写未实测）。
- **其他角色速查**：执行 `node process/scripts/respire-process.mjs roles --one-line` 或查看 [process/roles/README.md](../process/roles/README.md)。
