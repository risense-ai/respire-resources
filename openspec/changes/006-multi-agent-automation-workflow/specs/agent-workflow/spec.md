# Delta Spec: Multi-Agent Automation & Lessons Loop (`006`)

## ADDED Requirements

### Requirement: Strict Maker-Checker Separation via Read-Only Verifier
Every implementation PR MUST be verified before merge by an independent read-only Verifier running in a fresh session/process against `test-cases/` and matching OpenSpec scenarios; Implementer self-approval is strictly forbidden.

#### Scenario: Implementer attempts self-verification
- **GIVEN** an Implementer opens a feature PR with no independent Verifier sign-off
- **WHEN** `respire-process.mjs verify-merge` runs
- **THEN** the gate MUST reject merge readiness with a non-zero exit code

### Requirement: Fail-Closed Trusted Evidence & DAG Scheduling
Downstream orchestration Issues MUST remain `BLOCKED` until all `depends_on` Issues are closed with trusted Evidence verified against `.github/agents.yml`; missing or malformed metadata MUST fail closed rather than skip silently.

#### Scenario: Upstream dependency remains open
- **GIVEN** `CARD-004` declares `depends_on: [risense-ai/respire-resources#3]` while `#3` is still open
- **WHEN** an Agent runs `node process/scripts/respire-process.mjs next`
- **THEN** `CARD-004` MUST stay `BLOCKED` and MUST NOT be returned as `READY`

### Requirement: 3-Strike Lessons Graduation into CI Guardrails
Any defect pattern recorded 3 or more times in `LESSONS.md` MUST be promoted to a `guardrail` Issue and converted into an automated CI check or permanent regression test.

#### Scenario: Third occurrence of a defect class
- **GIVEN** the `lessons-audit` workflow identifies a third occurrence of a recurring bug pattern
- **WHEN** the audit report is generated
- **THEN** the workflow MUST propose a `guardrail` task to enforce the invariant automatically in CI
