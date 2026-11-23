# respire-resources

**Respire 项目的单一事实源（SSOT）**：集中托管跨仓的 OpenSpec 规范、接口契约（OpenAPI 3.1 + Core ABI）、高保真 HTML 原型、语言无关的 E2E 验收用例，以及面向多 AI Agent 协同的研发治理体系。

> **其他 AI Agent 刚进仓库？** 请直接从 **[openspec/AGENT_EXECUTION_GUIDE.md](openspec/AGENT_EXECUTION_GUIDE.md)** 与 **[process/roles/README.md](process/roles/README.md)** 开始阅读，内置冷启动 6 步协议与可直接复制的各阶段派单提示词。

---

## 三仓协同拓扑（已就绪）

| 仓库 | GitHub 地址 | 可见性 | 核心职责与边界 |
| --- | --- | --- | --- |
| **`respire-resources`**（本仓） | `risense-ai/respire-resources` | Public | OpenSpec 规范、OpenAPI 3.1 / Core ABI 契约、HTML 原型、E2E 测试集、流程与角色指南 |
| **`respire`**（新开源 Monorepo） | `risense-ai/respire` | Public | 承载 `apps/runtime`、`apps/cli`、`apps/client2` 与生成 SDK（物理隔离构建 + 路径路由 CI） |
| **`respire-core`** | `risense-ai/respire-core` | Private | 纯内存核心算法与推理引擎（C ABI）；禁止文件/数据库/网络 I/O |

> 历史过渡：`risense-ai/respire-back` 为早先归档的历史快照；`respire-runtime`、`respire-cli`、`respire-client2` 在执行 `003` 导入后冻结代码开发，仅作为老版本更新与 NPM 分发的自动镜像目标。

---

## 目录导航

- **[openspec/AGENT_EXECUTION_GUIDE.md](openspec/AGENT_EXECUTION_GUIDE.md)** — 多 Agent 冷启动执行协议与阶段提示词
- **[openspec/ROADMAP.md](openspec/ROADMAP.md)** — 六阶段改造总路线图与依赖 DAG
- **[openspec/config.yaml](openspec/config.yaml)** — OpenSpec 规范与校验配置
- **[openspec/specs/](openspec/specs/README.md)** — 已验收归档的系统权威规范正文
- **六份 OpenSpec Change 规范包（`001`–`006`）**：
  1. [001-resources-openspec-foundation](openspec/changes/001-resources-openspec-foundation/proposal.md) — OpenSpec 准入体系、GitHub Project 看板与仓库模板基建
  2. [002-runtime-openapi-v1-migration](openspec/changes/002-runtime-openapi-v1-migration/proposal.md) — Runtime OpenAPI 3.1（REST + SSE）全量契约与旧 RPC 平滑过渡
  3. [003-monorepo-merge-and-release-bridge](openspec/changes/003-monorepo-merge-and-release-bridge/proposal.md) — 三仓过滤合入、路径路由 `ci-gate`、独立 Tag 发版与老仓/NPM 自动镜像
  4. [004-ci-guardrails-and-code-slimming](openspec/changes/004-ci-guardrails-and-code-slimming/proposal.md) — CI 防退化架构护栏与四端代码深度瘦身清单
  5. [005-prototypes-and-e2e-acceptance](openspec/changes/005-prototypes-and-e2e-acceptance/proposal.md) — 16 页高保真 HTML 原型、黑盒 E2E（含 Windows 专项）与 Client2 PR 自动录屏预览
  6. [006-multi-agent-automation-workflow](openspec/changes/006-multi-agent-automation-workflow/proposal.md) — 六角色写验分离、`respire-process` 确定性状态机与 `LESSONS.md` 夜间审计
- **[contracts/](contracts/README.md)** — 唯一接口契约目录（[OpenAPI 3.1](contracts/runtime-api/openapi.yaml)、[Core ABI](contracts/core-abi/README.md)）
- **[prototypes/](prototypes/README.md)** — 高保真 HTML 原型、共享 Design Tokens 与 Mock Runtime 数据规范
- **[test-cases/](test-cases/README.md)** — 黑盒 E2E 验收场景与 Windows 专项回归用例
- **[process/](process/README.md)** — [六角色指南](process/roles/README.md)、统一模板与校验脚本
- **[AGENTS.md](AGENTS.md)** & **[LESSONS.md](LESSONS.md)** — 全局开发宪法与事故护栏台账

---

## 本地校验

```sh
node process/scripts/validate-openspec.mjs
```
