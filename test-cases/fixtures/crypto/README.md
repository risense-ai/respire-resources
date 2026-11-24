# Synthetic Vault compatibility vectors

The fixture is generated only from fixed public test strings and byte sequences.
It contains no real credential, profile, model, OS keychain export, or user data.

The wrapping definitions come from the pinned Windows release source
`risense-ai/respire-runtime@1d8a1bda4b6c43ec4df0dad8f4578908e13ba322`,
`crates/crypto/src/crypto.rs`. Generation is an independent Node crypto
implementation, not a call into the Runtime under test. Each version checks
both historically used data namespaces; v2 wrapping itself is namespace-neutral.
Vault v4 uses the A3 Secret Key as the unlock factor, not a login password.
The provided values are intentionally public and must be used only in tests.

Regenerate explicitly with Node 26 or later:
`node test-cases/fixtures/crypto/generate-vault-vectors.mjs --write`.
Verify deterministic generation by omitting `--write`. Generation does not
certify the production unlock path, legacy OS keyring lookup, or SQLite upgrade.

For an independent native check, use the included
verify-runtime-vectors.rs as src/main.rs in a disposable Cargo project.
Depend on the current Runtime crates/crypto package (path dependency) and
anyhow = "1", hex = "0.4", serde_json = "1". Run the probe with the absolute
path of vault-v1-v4.json. It calls the actual SessionKeys methods, compares
the complete synthetic plaintext and root key, and rejects a wrong factor
for each vector. This tests crypto behavior, not a real OS keyring lookup.
