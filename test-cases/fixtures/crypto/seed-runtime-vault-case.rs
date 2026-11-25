use anyhow::{ensure, Result};
use respire_storage::transport::local::register_witness_functions;
use rusqlite::{params, Connection};
use serde_json::Value;
fn main() -> Result<()> {
    let path = std::env::args_os().nth(1).unwrap();
    let row: Value = serde_json::from_reader(std::io::stdin().lock())?;
    let f = |n: &str| row[n].as_str().unwrap();
    let db = Connection::open(path)?;
    register_witness_functions(&db)?;
    let at = "2026-01-01T00:00:00.000Z";
    ensure!(db.execute("INSERT INTO memories(id,user,ciphertext,nonce,embedding_enc,created_at,updated_at,dirty,deleted) VALUES(?1,?2,?3,?4,'',?5,?5,0,0)",params![f("id"),f("user"),f("ciphertext"),f("nonce"),at])?==1);
    Ok(())
}
