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

Run `verify-runtime-upgrade.rs` as `src/main.rs` in a disposable Rust 2021
Cargo project. Add a path dependency named `respire_storage` on the
monorepo's `apps/runtime/crates/storage`, plus `anyhow = "1"`,
`serde_json = "1"` and `rusqlite = { version = "0.32", features = ["bundled",
"functions", "backup"] }`. Configure that checkout's normal native build
dependencies. Pass the frozen database, encrypted row JSON, and a new test
directory that does not yet exist.

The probe installs Runtime's real SQLite witness functions before seeding the
row. It checks version, integrity, foreign keys and exact encrypted fields
before upgrade, after two native `LocalStore::open` calls, and after restoring
via SQLite's native backup API and reopening with `LocalStore`. This is not an
application-level backup/rollback, a black-box unlock, or a downgrade test.
