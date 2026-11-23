---
name: OpenSpec Feature / Refactor Task
about: Submit a task governed by an OpenSpec Change and Milestone DAG
title: "[MX][00X] <Concise English summary>"
labels: ["spec:proposed"]
---

## Linked OpenSpec Metadata (Required)

- **OpenSpec Change ID**: `00X-...`
- **Target Milestone**: `MX: ...`
- **Spec Section / Scenario**: `openspec/changes/.../specs/.../spec.md`
- **HTML Prototype Path** (if UI): `prototypes/pages/...` or `N/A`
- **E2E Case ID**: `E2E-...`
- **Depends On**: `#...` or `None`

## Definition of Done

- [ ] Implementation written strictly in English (no CJK outside UI i18n paths)
- [ ] Meets all linked OpenSpec scenarios and E2E tests
- [ ] Passes architectural guardrails (`<= 600` lines/file, dependency boundaries)
- [ ] Verified independently by a read-only Verifier Agent
