# Historical compatibility fixtures

These fixtures use synthetic inputs only. No user library, real account,
machine credential store, or production key is required. The governing
[Change 005 spec](../../openspec/changes/005-prototypes-and-e2e-acceptance/specs/prototypes-and-e2e/spec.md)
includes more than fixture and codec validation.

## Released SQLite 1.x

[Fixture and provenance](db/README.md) records the exact published release,
binary and database digests, observed application marker 0, and the pinned
synthetic encrypted row. Its native probe opens and reopens the legacy data,
checks integrity, performs authenticated Runtime application backup/restore,
and verifies ciphertext and decrypted content. Wrong credentials and an
incompatible live marker fail closed. Previously shipped binaries were not
retroactively protected by the current Runtime's version guard.

The populated probe separately checks pending synchronization, a review, a
grant, and a query record across native upgrade and reopen. It confirms that
portable backup excludes the grant while leaving the source unchanged. These
are selected synthetic data cases, not complete audit-history coverage or an
assertion about arbitrary libraries from earlier releases.

## Vault v1-v4

[Vectors and provenance](crypto/README.md) records the pinned historical
encoders, deterministic generation, both namespaces, and version-specific
inputs. The native codec probe checks exact plaintext and wrong-factor
rejection. The separate compiled Windows run verifies all eight unlock cases
and retrieves exact UTF-8 through legacy local RPC by ID. No vector-ranked
recall or real system keyring is asserted.
