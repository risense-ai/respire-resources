# Frozen SQLite 1.x schema witness

`respire-1x-synthetic.db` is a SQLite online backup of the empty library
initialized by the published Windows Runtime `v1.0.21-dev.17` in a disposable,
empty profile. No real installation, account, or user data was read.
The exact Runtime release source is
`risense-ai/respire-runtime@1d8a1bda4b6c43ec4df0dad8f4578908e13ba322`.
The Windows executable SHA-256 was
`ce42f64781e736759bcb23860979a3e8bcec997514c24e2907d3ddc206f13c8a`.

The published binary created this schema with `PRAGMA user_version = 0`.
This is an observed application 1.x database, not a claim that the obsolete
SQLite engine itself was version 1.x. No artificial version was written into
the golden database. The baseline database contains no memories.

`node --test test-cases/fixtures/db/schema-fixture.test.mjs` checks its
pinned bytes, integrity, schema, and historical version without modifying it.
A full migration, backup and downgrade run must exercise Runtime on fresh
copies; a changed PRAGMA value alone is not proof of downgrade protection.
## Native storage upgrade and restore probe

`legacy-encrypted-row.json` is a byte-for-byte copy of
`apps/runtime/crates/app/src/fixtures/legacy-memory-v1/legacy_stored_memory.json`
from `risense-ai/respire@c276f31a2050e19a4a0e8d8e0d986498137f63ab`.
Its SHA-256 is
`9ff3d60ba6b9ce2649364cc0d87e83ab1bea504b25cb233da1f1df27667ca5c9`.
It uses a known synthetic key from an existing compatibility test.
It contains no user data. The row goes into a disposable copy of the golden.

Run `verify-runtime-upgrade.rs` as `src/main.rs` in an isolated Rust 2021
Cargo project. Add path dependencies named `respire_storage` and
`respire_app_domain` on the monorepo's `apps/runtime/crates/storage` and
`apps/runtime/crates/app-domain`, respectively. Also add `anyhow = "1"`,
`serde_json = "1"` and `rusqlite = { version = "0.32", features = ["bundled",
"functions", "backup"] }`. Configure that checkout's normal native build
dependencies. Pass the frozen database, encrypted row JSON and a new test
directory that does not exist yet.

The probe enables Runtime's real SQLite witness functions, plants the synthetic
row in a disposable copy, and verifies the original encrypted data and SQLite
integrity through native upgrade and reopen. It then creates and verifies a
real Runtime application snapshot, rejects a wrong account/key, and performs
authenticated restore and completion. The probe checks sync isolation and exact
data and decrypted text after reopen. It also briefly sets an incompatible
synthetic live SQLite marker on the copy: application restore must refuse and
leave the live database bytes and snapshot inventory unchanged. That is the
application restore guard, not proof that a historical binary refuses launch.

## Populated synthetic upgrade probe

Run `verify-runtime-populated.rs` using the same dependencies and three
arguments as above. It seeds a separate copy of the exact published schema,
before invoking the migrator. The two memory rows are synthetic; the pending
outbox is created by the actual SQLite triggers, and the review, grant, and
query are added by the Runtime storage APIs. The added rows were not produced
by the previously published executable.

The Windows compatibility run recorded two memories, two pending operations,
one review, one grant, and one query. The selected persisted fields matched
exactly through upgrade and a second open. The portable snapshot contains both
memories but excludes the share grant by design and leaves the source intact.
The portable snapshot probe does not assert portable sync, review, or query
state. The snapshot copies and newly generated credential data stay disposable.
