# Tasks: 001-resources-openspec-foundation

## 阶段一：仓库与 OpenSpec 骨架初始化（已完成）

- [x] **T01-01** 初始化 `D:\sources\repos-new\gh\1memory\respire-resources` 仓库及根目录 `README.md`、`AGENTS.md`、`LESSONS.md`
- [x] **T01-02** 建立 `openspec/config.yaml`、`openspec/ROADMAP.md`、`openspec/AGENT_EXECUTION_GUIDE.md` 与 `001`–`006` 全部 Change 提案包
- [x] **T01-03** 建立 `process/roles/*`、`process/scripts/validate-openspec.mjs` 与 `.github/workflows/validate.yml`
- [x] **T01-04** 创建并推送公开仓库 `risense-ai/respire-resources` 至 GitHub

## 阶段二：GitHub 组织治理与仓库模板同步

- [ ] **T01-05** 同步组织级 GitHub Project 看板 `Respire Transformation (001-006)`：`process/scripts/sync-project-board.mjs` 已就绪，待 Maintainer 运行 `gh auth refresh -s project,read:project` 后执行 `--apply`（见 `CARD-001`）
- [x] **T01-06** 为 `risense-ai/respire-resources` 与 `risense-ai/respire` 创建统一 Milestone（`M1`–`M6` 1:1 映射 `001`–`006`）及 17 个标准流程/领域标签，并建立 20 张带 `depends_on` DAG 的编排 Issue
- [ ] **T01-07** 将 `process/templates/ISSUE_TEMPLATE.md`、`PULL_REQUEST_TEMPLATE.md` 与 `coderabbit.yaml` 同步至 `risense-ai/respire-core`（确认 `risense-ai/respire` 已在初始化时同步，见 `CARD-002`）
- [x] **T01-08** 在 `risense-ai/respire-resources` 开启 `main` 分支保护（必需检查：`validate-openspec`）；在 `risense-ai/respire` 开启 `main` 分支保护（必需检查：`ci-gate`）
- [ ] **T01-09** 验收归档：全部阶段二卡片关闭后运行 `node process/scripts/validate-openspec.mjs`，并将 `specs/governance/spec.md` 合并至 `openspec/specs/governance/spec.md`

## 验收命令

```sh
node process/scripts/validate-openspec.mjs
node process/scripts/respire-process.mjs status
gh api repos/risense-ai/respire-resources/branches/main/protection --jq '.required_status_checks.contexts'
gh api repos/risense-ai/respire/branches/main/protection --jq '.required_status_checks.contexts'
```
