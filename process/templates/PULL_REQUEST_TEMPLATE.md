## Summary

- **Linked Issue / Change**: `Fixes <owner/repo>#...` (Change: `00X-...`)
- **Milestone Attached**: `MX: ...` (PR MUST share the Issue's Milestone)
- **Affected Component(s)**: `core` / `runtime` / `cli` / `client2` / `contracts` / `resources`

## Before / After Behavior

- **Before**:
- **After**:

## Contract, Guardrail & Language Checklist

- [ ] Strictly English-only outside dedicated UI i18n files (Zero-CJK CI clean)
- [ ] If Runtime API changed: `contracts/runtime-api/openapi.yaml` and `packages/runtime-sdk-*` updated first
- [ ] If Client2 UI changed: `prototypes/` synced and PR UI Preview verified
- [ ] No forbidden dependencies, no cross-`apps/*` imports, no new file `> 600` lines

## Verification Evidence

Paste exact commands executed and observed outputs (mark unrun environments honestly as `UNTESTED`):

```text
<command & output>
```
