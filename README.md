# respire-resources

**Respire 项目的单一事实源（SSOT）**：集中托管跨仓的 OpenSpec 规范、接口契约（OpenAPI 3.1 + Core ABI）、高保真 HTML 原型、语言无关的 E2E 验收用例，以及面向人类与 AI Agent 的研发治理体系。

---

## 三仓协同拓扑

| 仓库 | 可见性 | 核心职责 | 边界红线 |
| --- | --- | --- | --- |
| **`risense-ai/respire-resources`**（本仓） | 公开（Public） | OpenSpec 规范、OpenAPI 3.1 / Core ABI 契约、HTML 原型、E2E 测试集、流程模板与校验脚本 | 不包含产品业务代码 |
| **`risense-ai/respire-core`** | 闭源（Private） | 纯内存核心算法与推理引擎（向量化、ONNX/MLX 会话、检索排序、`deepen_plan`、C ABI） | 禁止文件/数据库/网络 I/O 与宿主逻辑 |
| **`risense-ai/respire`**（规划合仓，见 `003`） | 开源（Public Monorepo） | 统一承载 `apps/runtime`、`apps/cli`、`apps/client2` 及自动生成 SDK（`packages/runtime-sdk-*`） | `apps/*` 物理独立构建，禁止跨应用内部依赖 |

> 说明：现有 `respire-runtime`、`respire-cli`、`respire-client2` 在完成 `003` 合仓后冻结代码写入，仅作为旧版本升级渠道的 **自动 Release 分发镜像**。

---

## 目录导航

- **[openspec/ROADMAP.md](openspec/ROADMAP.md)** — 六阶段体系化改造总路线图与依赖 DAG
- **[openspec/config.yaml](openspec/config.yaml)** — OpenSpec 规范与校验配置
- **[openspec/specs/](openspec/specs/README.md)** — 已验收归档的系统权威规范正文
- **[openspec/changes/](openspec/ROADMAP.md)** — 六份改造提案与执行包（`001`–`006`）：
  1. [001-resources-openspec-foundation](openspec/changes/001-resources-openspec-foundation/proposal.md) — OpenSpec 规范体系、GitHub 看板与仓库基础建设
  2. [002-runtime-openapi-v1-migration](openspec/changes/002-runtime-openapi-v1-migration/proposal.md) — Runtime OpenAPI 3.1（REST + SSE）契约与旧协议平滑过渡
  3. [003-monorepo-merge-and-release-bridge](openspec/changes/003-monorepo-merge-and-release-bridge/proposal.md) — Monorepo 合仓、路径隔离 CI 与老仓/NPM Release 镜像分发
  4. [004-ci-guardrails-and-code-slimming](openspec/changes/004-ci-guardrails-and-code-slimming/proposal.md) — CI 防退化架构护栏与四端深度瘦身落地
  5. [005-prototypes-and-e2e-acceptance](openspec/changes/005-prototypes-and-e2e-acceptance/proposal.md) — 高保真 HTML 原型、跨端 E2E 裁判库与 Client2 PR UI 自动预览
  6. [006-multi-agent-automation-workflow](openspec/changes/006-multi-agent-automation-workflow/proposal.md) — 多 Agent 写验分离闭环、`respire-process` 与 `LESSONS.md` 夜间复盘
- **[contracts/](contracts/README.md)** — 唯一接口契约目录（[OpenAPI 3.1](contracts/runtime-api/openapi.yaml)、[Core ABI](contracts/core-abi/README.md)）
- **[prototypes/](prototypes/README.md)** — 高保真 HTML 原型、共享 Design Tokens 与 Mock Runtime 数据规范
- **[test-cases/](test-cases/README.md)** — 黑盒 E2E 验收场景与 Windows 专项回归用例
- **[process/](process/README.md)** — 统一模板（`.coderabbit.yaml`、Issue/PR 模板）与自动化校验脚本
- **[AGENTS.md](AGENTS.md)** — 全局 AI Agent 开发宪法
- **[LESSONS.md](LESSONS.md)** — 事故复盘与 CI 护栏升格台账

---

## 本地校验

每次修改 `openspec/` 或 `contracts/` 后运行：

```sh
node process/scripts/validate-openspec.mjs
```
