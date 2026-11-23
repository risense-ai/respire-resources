# process — 研发流程模板与自动化校验脚本

本目录集中维护 Respire 多仓库共享的工程治理模板与校验工具：

- **[roles/](roles/README.md)**：六角色分工、权限边界与一句话冷启动提示词（Implementer / Verifier / Triager / Scribe / Release Manager）。
- **[templates/coderabbit.yaml](templates/coderabbit.yaml)**：面向 `respire` Monorepo 与 `respire-core` 的统一严格版 CodeRabbit 配置模板（取代旧仓过时的 `chill` 配置）。
- **[templates/ISSUE_TEMPLATE.md](templates/ISSUE_TEMPLATE.md)**：强制包含 `Change ID`、Spec `§`、依赖 Issue 与 E2E 用例 ID 的标准 Issue 模板。
- **[templates/PULL_REQUEST_TEMPLATE.md](templates/PULL_REQUEST_TEMPLATE.md)**：要求填写行为前后对比、OpenAPI/原型同步说明与真实验证命令的 PR 模板。
- **[scripts/validate-openspec.mjs](scripts/validate-openspec.mjs)**：零外部依赖的 OpenSpec 与 OpenAPI 结构及行数红线校验脚本。
