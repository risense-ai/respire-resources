use anyhow::{ensure, Context, Result};
use respire_storage::transport::local::LocalStore;
use rusqlite::{params, Connection, OpenFlags};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

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
    let data = work.join("memory.db");
    let restore = work.join("restored.db");
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
    {
        let from = Connection::open_with_flags(&data, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let mut to = Connection::open(&restore)?;
        rusqlite::backup::Backup::new(&from, &mut to)?.run_to_completion(
            16,
            Duration::from_millis(5),
            None,
        )?;
    }
    drop(LocalStore::open(&restore).context("open restored backup in native Runtime Storage")?);
    ensure!(check(&restore, id)? == expected);
    println!(
        "sqlite backup/restore and native LocalStore reopen: exact encrypted witness preserved"
    );
    Ok(())
}
