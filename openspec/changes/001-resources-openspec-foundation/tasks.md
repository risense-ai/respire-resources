# Tasks: 001-resources-openspec-foundation

## 阶段一：仓库与 OpenSpec 骨架初始化（已完成）

- [x] **T01-01** 初始化 `D:\sources\repos-new\gh\1memory\respire-resources` 仓库及根目录 `README.md`、`AGENTS.md`、`LESSONS.md`
- [x] **T01-02** 建立 `openspec/config.yaml`、`openspec/ROADMAP.md`、`openspec/AGENT_EXECUTION_GUIDE.md` 与 `001`–`006` 全部 Change 提案包
- [x] **T01-03** 建立 `process/roles/*`、`process/scripts/validate-openspec.mjs` 与 `.github/workflows/validate.yml`
- [x] **T01-04** 创建并推送公开仓库 `risense-ai/respire-resources` 至 GitHub

## 阶段二：GitHub 组织治理与仓库模板同步（待 Maintainer 批准 `001` 后执行）

- [ ] **T01-05** 确认 `gh` Token 具备 `project` scope（如缺少则提示 Maintainer 授权 `gh auth refresh -s project`），创建组织看板 `Respire Engineering` 并配置状态列（`Backlog / Triage`、`Spec Approved`、`In Progress`、`In Review / Verify`、`Done`）
- [ ] **T01-06** 为 `risense-ai/respire-resources` 与 `risense-ai/respire` 创建统一 Milestone（`M1-OpenAPI-Migration` 至 `M4-E2E-And-Automation`）及标准标签（`proposed`、`approved`、`guardrail`、`needs-info`、`ui-preview`）
- [ ] **T01-07** 将 `process/templates/ISSUE_TEMPLATE.md`、`PULL_REQUEST_TEMPLATE.md` 与 `coderabbit.yaml` 同步至 `risense-ai/respire-core`（确认 `risense-ai/respire` 已在初始化时同步）
- [ ] **T01-08** 在 `risense-ai/respire-resources` 开启 `main` 分支保护（必需检查：`validate-openspec`）；在 `risense-ai/respire` 开启 `main` 分支保护（必需检查：`ci-gate`）
- [ ] **T01-09** 验收归档：运行 `node process/scripts/validate-openspec.mjs` 并核对分支保护生效后，由 Scribe 将 `specs/governance/spec.md` 合并至 `openspec/specs/governance/spec.md`

## 验收命令

```sh
node process/scripts/validate-openspec.mjs
gh api repos/risense-ai/respire-resources/branches/main/protection --jq '.required_status_checks.contexts'
gh api repos/risense-ai/respire/branches/main/protection --jq '.required_status_checks.contexts'
```
