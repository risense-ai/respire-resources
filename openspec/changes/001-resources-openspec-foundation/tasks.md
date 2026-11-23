# Tasks: 001-resources-openspec-foundation

## 阶段一：仓库与 OpenSpec 骨架初始化（本仓已就绪待审）

- [x] **T01-01** 初始化 `D:\sources\repos-new\gh\1memory\respire-resources` 仓库及根目录 `README.md`、`AGENTS.md`、`LESSONS.md`
- [x] **T01-02** 建立 `openspec/config.yaml`、`openspec/ROADMAP.md` 与 `001`–`006` 全部 Change 提案包
- [x] **T01-03** 建立 `process/scripts/validate-openspec.mjs` 与 `.github/workflows/validate.yml`
- [x] **T01-04** 创建并推送公开仓库 `risense-ai/respire-resources` 至 GitHub

## 阶段二：GitHub 组织治理与既有仓库同步配置（待 Maintainer 批准 `001` 后执行）

- [ ] **T01-05** 在 `risense-ai` 组织下创建跨仓统一的 GitHub Project 看板（列：`Backlog / Triage`、`Spec Approved`、`In Progress`、`In Review / Verify`、`Done`）
- [ ] **T01-06** 建立首批里程碑：`M1-OpenAPI-Migration`、`M2-Monorepo-Merge`、`M3-Guardrails-Slimming`、`M4-E2E-And-Automation`
- [ ] **T01-07** 将 `process/templates/ISSUE_TEMPLATE.md`、`PULL_REQUEST_TEMPLATE.md` 与 `coderabbit.yaml` 分别应用到 `respire-resources` 与 `respire-core`（及未来的 `respire` Monorepo）
- [ ] **T01-08** 在 `respire-resources` 开启分支保护（要求 `validate-openspec` 状态检查通过方可合并至 `main`）
- [ ] **T01-09** 验收归档：全部任务完成后运行 `node process/scripts/validate-openspec.mjs`，并将 `specs/governance/spec.md` 合并至 `openspec/specs/governance/spec.md`

## 验收命令

```sh
node process/scripts/validate-openspec.mjs
gh repo view risense-ai/respire-resources --json visibility,defaultBranchRef
```
