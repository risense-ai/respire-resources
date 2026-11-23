# process — Governance Templates, Roles & Orchestration Scripts

Central agent-agnostic engineering workflow assets shared across Respire repositories:

- **[roles/oneline.md](roles/oneline.md)** — **Agent-agnostic one-line role startup prompts** (Implementer, Bugfixer, Verifier/Reviewer, Triager, Scribe, Release Manager).
- **[scripts/respire-process.mjs](scripts/respire-process.mjs)** — Deterministic multi-agent task, review, archive & release CLI (`preflight`, `status`, `next`, `claim`, `mark-verify`, `review-next`, `post-verdict`, `verify-merge`, `evidence-register`, `archive-next`, `release-check`, `complete`, `sync`, `approve-milestone`, `roles`).
- **[scripts/sync-project-board.mjs](scripts/sync-project-board.mjs)** — Idempotent GitHub Project v2 board initializer & status synchronizer.
- **[scripts/validate-openspec.mjs](scripts/validate-openspec.mjs)** — Zero-dependency validator enforcing OpenSpec artifacts, `<= 400`-line doc cap, doc relative-link integrity, `<= 600`-line script cap, OpenAPI 3.1 syntax, and Zero-CJK outside UI i18n.
- **[scripts/respire-process.test.mjs](scripts/respire-process.test.mjs)** — `node:test` unit suite for DAG classification, allowlist trust checks, stale-SHA verdicts, and Evidence verification.
- **[CI_AND_QUALITY_GATES.md](CI_AND_QUALITY_GATES.md)** — Complete CI matrix, regression constraints, and `sebas` + `magpie` mapping.
- **[roles/](roles/README.md)** — Six-role collaboration playbooks and permissions matrix.
- **[templates/coderabbit.yaml](templates/coderabbit.yaml)** — Strict English-only CodeRabbit template shared by `respire` and `respire-core`.
- **[templates/ISSUE_TEMPLATE.md](templates/ISSUE_TEMPLATE.md)** & **[templates/PULL_REQUEST_TEMPLATE.md](templates/PULL_REQUEST_TEMPLATE.md)** — Standard metadata templates.
