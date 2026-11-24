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