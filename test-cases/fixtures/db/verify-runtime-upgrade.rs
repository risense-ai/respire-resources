use anyhow::{ensure, Context, Result};
use respire_storage::transport::local::LocalStore;
use rusqlite::{params, Connection, OpenFlags};
use std::path::{Path, PathBuf};

type Witness = (String, String, String, String, String, String, String, bool);

fn check(path: &Path, id: &str) -> Result<Witness> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let result: String = db.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    ensure!(result == "ok");
    let version: i64 = db.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    ensure!(version == 0, "unexpected format marker {version}");
    let mut foreign = db.prepare("PRAGMA foreign_key_check")?;
    ensure!(foreign.query([])?.next()?.is_none());
    Ok(db.query_row(
        "SELECT id,user,ciphertext,nonce,embedding_enc,updated_at,created_at,deleted FROM memories WHERE id=?",
        [id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?)),
    )?)
}

fn main() -> Result<()> {
    let mut args = std::env::args_os().skip(1);
    let baseline = PathBuf::from(args.next().context("golden db")?);
    let row_path = PathBuf::from(args.next().context("synthetic row")?);
    let work = PathBuf::from(args.next().context("isolated work dir")?);
    std::fs::create_dir(&work)?;
    let data = work.join("rsrs.db");

    std::fs::copy(&baseline, &data)?;
    let row: serde_json::Value = serde_json::from_slice(&std::fs::read(row_path)?)?;
    let field = |key: &str| row[key].as_str().with_context(|| format!("missing {key}"));
    let id = field("id")?;
    let timestamp = field("updated_at")?;
    let expected = (
        id.to_owned(),
        field("user")?.to_owned(),
        field("ciphertext")?.to_owned(),
        field("nonce")?.to_owned(),
        field("embedding_enc")?.to_owned(),
        timestamp.to_owned(),
        timestamp.to_owned(),
        row["deleted"].as_bool().context("missing deleted flag")?,
    );
    {
        let db = Connection::open(&data)?;
        respire_storage::transport::local::register_witness_functions(&db)?;
        db.execute(
            "INSERT INTO memories(id,user,ciphertext,nonce,embedding_enc,updated_at,created_at,deleted) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![expected.0,expected.1,expected.2,expected.3,expected.4,expected.5,expected.6,expected.7],
        )?;
    }
    ensure!(
        check(&data, id)? == expected,
        "synthetic source row mismatch"
    );
    for phase in ["upgrade", "reopen"] {
        drop(LocalStore::open(&data).with_context(|| format!("Runtime {phase}"))?);
        ensure!(
            check(&data, id)? == expected,
            "{phase} changed legacy identity or cryptographic data"
        );
        println!("{phase}: native LocalStore and SQLite integrity verified");
    }

    use respire_app_domain::{lock::LibraryLock, snapshot, SessionKeys};
    let key = SessionKeys::from_urk([42; 32])?;
    let text = key.decrypt_content(&expected.2, &expected.3)?;
    ensure!(text.contains("Frozen synthetic historical format sample."));
    let backup = snapshot::create(&work, &expected.1, "card018-golden", &key)?;
    ensure!(backup.entries == 1);
    {
        let db = Connection::open(&data)?;
        respire_storage::transport::local::register_witness_functions(&db)?;
        ensure!(db.execute("DELETE FROM memories WHERE id=?", [id])? == 1);
    }
    ensure!(
        check(&data, id).is_err(),
        "witness still exists before restore"
    );
    let lock = LibraryLock::acquire(&work, std::time::Duration::from_secs(2))?;
    let bad_key = SessionKeys::from_urk([43; 32])?;
    ensure!(snapshot::restore_locked(&work, &expected.1, &bad_key, &backup.id, &lock).is_err());
    ensure!(
        snapshot::restore_locked(&work, "wrong-fixture-account", &key, &backup.id, &lock).is_err()
    );
    ensure!(check(&data, id).is_err(), "negative attempts wrote the row");
    // Synthetic incompatible live version for a restore schema guard test only.
    const FUTURE_VERSION: i64 = 999_001;
    {
        let db = Connection::open(&data)?;
        db.pragma_update(None, "user_version", FUTURE_VERSION)?;
        db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    }
    let before_db = std::fs::read(&data)?;
    let inventory_before = snapshot::list(&work)?.len();
    let rejected = snapshot::restore_locked(&work, &expected.1, &key, &backup.id, &lock)
        .err()
        .context("restore accepted incompatible synthetic live version")?;
    ensure!(
        rejected.to_string().contains("snapshot schema differs"),
        "unexpected restore error: {rejected:#}"
    );
    ensure!(
        std::fs::read(&data)? == before_db,
        "rejected restore changed live database bytes"
    );
    ensure!(
        snapshot::list(&work)?.len() == inventory_before,
        "rejected restore created another snapshot"
    );
    {
        let db = Connection::open_with_flags(&data, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        let sentinel_count: usize =
            db.query_row("SELECT count(*) FROM memories WHERE id=?", [id], |r| {
                r.get(0)
            })?;
        ensure!(
            version == FUTURE_VERSION && sentinel_count == 0,
            "rejected restore changed live state"
        );
    }
    println!("incompatible synthetic live SQLite version rejected by app restore; exact live bytes unchanged (not a binary downgrade guard)");
    {
        let db = Connection::open(&data)?;
        db.pragma_update(None, "user_version", 0_i64)?;
    }
    let receipt = snapshot::restore_locked(&work, &expected.1, &key, &backup.id, &lock)?;
    ensure!(receipt.sync_quarantined);
    ensure!(snapshot::ensure_sync_allowed(&work).is_err());
    snapshot::complete_restore(&work, &receipt)?;
    drop(lock);
    drop(LocalStore::open(&data)?);
    let actual = check(&data, id)?;
    ensure!(actual == expected, "restore changed encrypted row");
    ensure!(key.decrypt_content(&actual.2, &actual.3)? == text);
    println!("application snapshot create, wrong account/key rejection, authenticated restore, complete_restore, native LocalStore reopen and exact encrypted witness verified");
    Ok(())
}
