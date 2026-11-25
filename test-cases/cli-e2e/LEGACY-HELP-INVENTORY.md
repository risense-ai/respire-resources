# Legacy CLI help inventory (T05-05)

This is a visibility check, not semantic parity. E2E-006 still tests actual
scoped `--json status` and `inject --help`; this companion does not replace it.

The reviewed minimum is the public surface of legacy CLI
[`v1.0.21-dev.6` at `425f397db2a64347d3d27fa93db630fad6b9b520`](https://github.com/risense-ai/respire-cli/tree/425f397db2a64347d3d27fa93db630fad6b9b520).
The manifest includes all 84 visible top-level names, selected nested command
groups and compatibility-sensitive options, plus visible version/model aliases.
It does not require exact human prose, order, exclusivity or every option;
new commands are allowed. Private bootstrap flags, environment variables,
shell setup, and positional-argument semantics are not tested.

The pinned frontend installs callback definitions and parses help before
`prepare_command_runtime`; nevertheless run only separately reviewed, immutable
CLI artifacts in a fresh network-isolated disposable VM which has no real
configuration, accounts, credentials, IDE data, or Runtime. The operator's
environment assertion is not an infrastructure attestation. Passing a digest
without independent source/build verification is not sufficient. Do not invoke
this on an attached user machine or an existing profile. The runner inherits
only known system variables and points home/config/data to its private scratch.
It never starts a Runtime, passes a shell command, or sends any CLI business
flag. Every child argv ends in `--help`; no argument originates from observed
CLI help. Missing names, flags, non-zero exits, stderr, or scratch writes fail.

From the Resources root on the qualifying VM, after setting its scratch path:

~~~powershell
$env:CARD018_DISPOSABLE_CLI_HELP = '1'
node --test test-cases/cli-e2e/legacy-help-inventory.test.mjs
node test-cases/cli-e2e/legacy-help-inventory.mjs --cli-bin $VerifiedExe --sha256 $ReviewedSha256
~~~

Run independently against the exactly reviewed legacy baseline binary and the
candidate and record both digests and exits. The parser tests do not launch
either CLI. This inventory is not evidence that those binary comparisons ran.

## Representative uncovered stateful checks

- Legacy CRUD and recovery: seed two encrypted synthetic notes; prove real
  remember/list/show/forget/restore and dry-run versus committed resort (clean
  original contents, stable IDs/parent, exactly expected journal/revision).
- Strictly synthetic credentials: `keys-export --out` on fixture-only temporary
  keys, no stdout values or retained files, verified file access protections,
  and clean absent/wrong-key variants. Existing synthetic Vault decrypt vectors
  do not prove the CLI export contract. Never exercise with real keys.
- CLI `doctor --fix` and lifecycle: report vs repair using a dedicated managed
  Runtime, known synthetic Paused lock and exact owner proof. Never kill or
  clean an unrelated lock. Exercise verified runtime update/rollback with a
  pinned test archive; no installed system service or user autostart.
- Models: accepted and cancelled real staged download, switch and failed
  rollback, and inactive model uninstall with one untouched unmanaged duplicate.
  Require native CLI receipts and stable scoped serving identity; a Client2 UI
  receipt cannot stand in for CLI.
- IDE/TUI: preserve project/global config and unrelated blocks for at least one
  additional actual IDE fixture; exercise one confirmed action in a controlled
  pseudoterminal, as well as cancel/no-write. Existing Windows Codex injection
  and TUI quit checks are useful but don't establish those other paths.
- Space/auth/sync: private synthetic or loopback Mock authority for account
  switching, read-only membership, and sync conflict resolution with expected
  generation/revision. E2E-007 and Windows transport are separate evidence;
  maintain binary legacy HTTP/MCP cases rather than inferring them from help.
