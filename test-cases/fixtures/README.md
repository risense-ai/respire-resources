# Historical compatibility fixture requirements

The Resources worktree at `064f945` contains compatibility requirements in
[the Change 005 spec](../../openspec/changes/005-prototypes-and-e2e-acceptance/specs/prototypes-and-e2e/spec.md).
The checked-in [OpenAPI fixtures](../../contracts/runtime-api/fixtures/) describe
current HTTP payloads. Base library DDL, versioned migration code, Vault encoder
implementations, and release-produced fixture bytes remain unavailable in this
worktree. The workspace sandbox denied direct Git access to the sibling
repositories.

## SQLite 1.x

The coordinator exported five checked-in SQL definitions in check-only mode
from `risense-ai/respire-runtime` tag `v1.0.21-dev.17`, commit
`1d8a1bda4b6c43ec4df0dad8f4578908e13ba322`, into the local
`respire-coordinator-20261124-1428` reference directory. The hashes below
identify the exact exported bytes. The tag and commit attribution comes from
the coordinator. No release database or key material was supplied.

| Export | SHA-256 of the exported file | Scope |
| --- | --- | --- |
| `resident_schema.sql` | `6c2cce97fef4683eda15901b2f8eb695a94f2cb8eb48cdba5aef007efd3579fd` | Derived retrieval tables and triggers on `memories` and `core_artifacts` |
| `revision_schema.sql` | `f92b146fa8494f4eca1638421d509aba2faa9aa02ede4d7b2d94b153229d429e` | Revision bookkeeping using `meta` and triggers on `memories` |
| `sync_revision_schema.sql` | `72477fb576c3367979200282bba3aead88f8f3a759fa583a5e52394063d52488` | Revision triggers on `sync_remote_heads` |
| `sync_schema.sql` | `748de2173b14af9ef1105195da6a19df78bf002c74b404b1b385c419263e30c9` | Sync tables and indexes, including `sync_outbox`, plus capture and backfill from `memories` |
| `witness_schema.sql` | `231dc61427fa130e44938f51d4fa3a49dfd86488024fa771f692f550245812a9` | Witness table and triggers that depend on `memories`, `meta`, and Runtime witness functions |

Node.js 26.13.0 `node:sqlite` executed each export in a fresh in-memory
database. The revision export stopped at missing `meta`, the sync revision
export at missing `sync_remote_heads`, and the other three at missing
`memories`. Applying the sync DDL first would supply `sync_remote_heads`,
while the base library definitions would still be missing. Trigger references
show which columns they read. They leave column definitions, primary keys,
nullability, and stored encodings unresolved.

The exports also leave `memory_chunks`, review history, grants, query logs,
skill runs, audit records, and the release's `user_version` behavior
unresolved. They cannot establish the full legacy library contract or a
decryptable TEXT-ID fixture. This review produced no on-disk SQLite fixture.

Each fixture needs a checked-in schema reference pinned to a 1.x release commit,
including the DDL, trigger bodies, `user_version` behavior, and persisted value
formats. A fixture produced by a trusted local 1.x release binary can also
provide the on-disk evidence. Exercise an empty database, an encrypted TEXT-ID
memory database, and a comprehensive database with pending `sync_outbox` rows,
history, grants, audit, and sync triggers. Use synthetic data for every row.

Record the original release tag and commit, platform, producer command, artifact
and fixture SHA-256, profile-relative database path, and expected tables,
triggers, rows, and `user_version`. Against an explicitly supplied compiled
Runtime, compare the pre-migration backup to the source's logical contents,
check `PRAGMA quick_check`, and compare persisted rows and recall results after
migration. Verify pending sync rows and triggers, restart idempotence, and an
explicit higher-version rejection with unchanged source contents. Atomic
rollback requires an observable, controlled migration failure. A successful
upgrade by itself provides evidence for the success path.

## Vault v1–v4

The compatibility policy lists algorithms and domain strings. Each vector also
needs a pinned historical encoder source or trusted release-produced bytes with
the exact serialization, field encodings, key derivation parameters, account
inputs, and ciphertext/nonce layout for its version. Cover the applicable
legacy domain variants, unmarked ciphertext, and `rsrs:v1:` envelopes using
only newly generated test inputs. Record the release tag and commit, platform,
encoder entry point, generation command, format variant, expected plaintext,
and artifact and fixture SHA-256. Run unlock and recall against a controlled
Runtime and compare the decrypted bytes to the recorded synthetic plaintext.
