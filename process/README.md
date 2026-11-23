# process — 研发流程模板、角色规范与自动化编排工具

本目录集中维护 Respire 多仓库共享的工程治理工具与标准化模板：

- **[scripts/respire-process.mjs](scripts/respire-process.mjs)**：确定性多 Agent 调度与门禁 CLI（支持 `status`、`next`、`claim`、`approve-milestone`、`roles`），严格依据 GitHub Milestones、Issue `depends_on` DAG 与标签状态 Fail-Closed 选卡。
- **[scripts/sync-project-board.mjs](scripts/sync-project-board.mjs)**：幂等初始化并同步 `risense-ai` 组织级 GitHub Project v2 看板。
- **[scripts/validate-openspec.mjs](scripts/validate-openspec.mjs)**：零外部依赖的 OpenSpec 与 OpenAPI 结构及 400 行红线校验脚本。
- **[roles/](roles/README.md)**：六角色分工、权限边界与一句话冷启动提示词（Implementer / Verifier / Triager / Scribe / Release Manager）。
- **[templates/coderabbit.yaml](templates/coderabbit.yaml)**：面向 `respire` Monorepo 与 `respire-core` 的统一严格版 CodeRabbit 配置模板。
- **[templates/ISSUE_TEMPLATE.md](templates/ISSUE_TEMPLATE.md)** & **[templates/PULL_REQUEST_TEMPLATE.md](templates/PULL_REQUEST_TEMPLATE.md)**：强制包含 `Change ID`、Spec `§`、Milestone 与实证输出的标准模板。
