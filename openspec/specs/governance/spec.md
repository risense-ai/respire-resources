# Governance, OpenSpec Workflow & Language Policy

## Requirements

### Requirement: Spec-First Change Gate
Every new feature, interface modification, architectural refactor, or UI redesign MUST be proposed as a complete OpenSpec Change package under `respire-resources/openspec/changes/<change-id>/` and receive Maintainer approval (`spec:approved`) before any implementation branch is opened.

#### Scenario: Implementation attempted without an approved Change
- **GIVEN** a proposed feature has no approved Change package in `openspec/changes/`
- **WHEN** an Implementer Agent runs `node process/scripts/respire-process.mjs next` or prepares to branch
- **THEN** the workflow MUST block execution (exit code `2`) and instruct the Agent to request Maintainer approval first

### Requirement: English-Only Repository Policy (Zero Non-i18n CJK)
All documentation, OpenSpec specs, source code, inline comments, scripts, CI workflows, commit messages, PR bodies, and GitHub Issues in `respire-resources` and `respire` MUST be written strictly in English; non-English UI translations SHALL exist ONLY inside dedicated UI i18n paths and i18n test fixtures.

#### Scenario: Non-i18n CJK text committed to docs or code
- **GIVEN** a PR adds Chinese characters inside a specification, Go/Rust source file, comment, or workflow outside exempted i18n paths
- **WHEN** CI runs `validate-openspec.mjs` or `check-guardrails.mjs`
- **THEN** the check MUST fail with a non-zero exit code and report the exact `file:line` location

### Requirement: Change Artifact Completeness & Line Limits
Each non-archive Change directory MUST contain `proposal.md`, `design.md`, `tasks.md`, and at least one `specs/<domain>/spec.md` containing `MUST`/`SHALL` requirements and `#### Scenario:` (`GIVEN`/`WHEN`/`THEN`) blocks; non-archive `.md` files under `openspec/` MUST NOT exceed 400 lines.

#### Scenario: Oversized or incomplete Change submitted
- **GIVEN** a PR adds an OpenSpec file exceeding 400 lines or omits `tasks.md`
- **WHEN** CI runs `node process/scripts/validate-openspec.mjs`
- **THEN** validation MUST fail and name every violating file

### Requirement: Traceable Issue & Milestone Metadata
Every scheduled orchestration Issue MUST carry a valid `<!-- respire-card ... -->` metadata block linking `id`, `change`, `milestone`, `target_repo`, and `depends_on`; every implementation PR MUST attach the matching Milestone and include `Fixes <owner/repo>#<issue>`.

#### Scenario: Issue missing mandatory OpenSpec metadata
- **GIVEN** a newly opened feature Issue omits its Change ID or E2E verification reference
- **WHEN** Triager inspects the Issue
- **THEN** Triager MUST apply `metadata:invalid` or `needs-info` and withhold scheduling until completed
