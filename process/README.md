# process — Governance Templates, Roles & Orchestration Scripts

Central engineering workflow assets shared across Respire repositories:

- **[scripts/respire-process.mjs](scripts/respire-process.mjs)** — Deterministic multi-agent task scheduler & gate CLI (`status`, `next`, `claim`, `approve-milestone`, `roles`) wired to GitHub Milestones and Issue DAGs.
- **[scripts/sync-project-board.mjs](scripts/sync-project-board.mjs)** — Idempotent GitHub Project v2 board initializer & status synchronizer.
- **[scripts/validate-openspec.mjs](scripts/validate-openspec.mjs)** — Zero-dependency validator enforcing OpenSpec artifacts, `<= 400`-line doc cap, OpenAPI 3.1 syntax, and Zero-CJK outside UI i18n.
- **[roles/](roles/README.md)** — Six-role collaboration playbooks and one-line dispatch prompts.
- **[templates/coderabbit.yaml](templates/coderabbit.yaml)** — Strict English-only CodeRabbit template shared by `respire` and `respire-core`.
- **[templates/ISSUE_TEMPLATE.md](templates/ISSUE_TEMPLATE.md)** & **[templates/PULL_REQUEST_TEMPLATE.md](templates/PULL_REQUEST_TEMPLATE.md)** — Standard metadata templates.
