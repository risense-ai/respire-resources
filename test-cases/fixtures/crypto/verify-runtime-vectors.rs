use respire_crypto::SessionKeys;
use serde_json::Value;
fn f<'a>(v: &'a Value, n: &str) -> &'a str {
    v[n].as_str().unwrap_or_else(|| panic!("missing field {n}"))
}
fn unlock(v: &Value, p: &str) -> anyhow::Result<SessionKeys> {
    let (s, w, n) = (f(v, "kdf_salt"), f(v, "wrapped_urk"), f(v, "urk_nonce"));
    match v["version"].as_u64() {
        Some(1) => SessionKeys::unlock(p, f(v, "account_secret"), s, w, n),
        Some(2) => SessionKeys::unlock_super(p, s, w, n),
        Some(3) => SessionKeys::unlock_vault(p, f(v, "secret_key"), s, w, n),
        Some(4) => SessionKeys::unlock_v4(p, s, w, n),
        _ => anyhow::bail!("unknown fixture format"),
    }
}
fn main() -> anyhow::Result<()> {
    let root: Value = serde_json::from_slice(&std::fs::read(
        std::env::args_os().nth(1).expect("fixture"),
    )?)?;
    assert_eq!(root["synthetic"], true);
    let vectors = root["vectors"].as_array().unwrap();
    assert_eq!(vectors.len(), 8);
    for v in vectors {
        let key = unlock(v, f(v, "unlock_factor"))?;
        assert_eq!(hex::encode(key.urk), f(v, "expected_urk_hex"));
        let d = &v["data"];
        assert_eq!(
            key.decrypt_content(f(d, "ciphertext"), f(d, "nonce_hex"))?,
            f(d, "expected_utf8")
        );
        let wrong = if v["version"] == 4 {
            "A3-000000-000000-000000-000000-000000-000000"
        } else {
            "wrong-fixture-factor"
        };
        assert!(unlock(v, wrong).is_err());
        println!(
            "Runtime Vault v{} {} PASS (negative factor also checked)",
            v["version"],
            f(v, "domain")
        );
    }
    Ok(())
}
