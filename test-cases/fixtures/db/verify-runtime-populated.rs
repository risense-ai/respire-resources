use anyhow::{ensure, Context, Result};
use respire_app_domain::{snapshot, SessionKeys, StoredMemory};
use respire_storage::transport::local::{register_witness_functions, LocalStore, ReviewHistoryRow};
use rusqlite::{params, Connection, OpenFlags};
use std::path::{Path, PathBuf};

const LEGACY: &str = "00000000-0000-4000-8000-000000000001";
const REVIEWED: &str = "00000000-0000-4000-8000-000000000002";
type Rows = Vec<(String, Vec<String>)>;
fn witnesses(path: &Path) -> Result<Rows> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    ensure!(db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? == 0);
    ensure!(db.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))? == "ok");
    ensure!(db
        .prepare("PRAGMA foreign_key_check")?
        .query([])?
        .next()?
        .is_none());
    let mut output = Vec::new();
    for (name,sql) in [
      ("memories","SELECT json_array(id,user,ciphertext,nonce,embedding_enc,created_at,updated_at,deleted,dirty,memory_contract,review_at) FROM memories ORDER BY id"),
      ("sync_outbox","SELECT json_array(seq,op_id,id,base_rev,parent_op_id,user,ciphertext,nonce,embedding_enc,updated_at,deleted,state) FROM sync_outbox ORDER BY seq"),
      ("review_history","SELECT json_array(seq,entry_id,record_revision,action,actor,happened_at,previous_verification,next_verification,previous_review_at,next_review_at,reason) FROM review_history ORDER BY seq"),
      ("access_grants","SELECT json_array(id,label,root_id,token_hash,created_at,revoked) FROM access_grants ORDER BY id"),
      ("query_log","SELECT json_array(id,ts_unix,ts,query,project,scope,candidates,candidate_scores,adopted,good_ids,bad_ids,request_id) FROM query_log ORDER BY id")
    ]{
        let mut q=db.prepare(sql)?;
        let rows=q.query_map([],|r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        output.push((name.to_owned(),rows));
    }
    Ok(output)
}
fn main() -> Result<()> {
    let mut argv = std::env::args_os().skip(1);
    let original = PathBuf::from(argv.next().context("golden file")?);
    let fixture = PathBuf::from(argv.next().context("encrypted witness json")?);
    let root = PathBuf::from(argv.next().context("isolated nonexisting root")?);
    std::fs::create_dir(&root)?;
    let live = root.join("rsrs.db");
    std::fs::copy(&original, &live)?;
    let mut row: StoredMemory = serde_json::from_slice(&std::fs::read(&fixture)?)?;
    ensure!(row.id == LEGACY && row.user == "fixture");
    let key = SessionKeys::from_urk([42; 32])?;
    ensure!(key
        .decrypt_content(&row.ciphertext, &row.nonce)?
        .contains("Frozen synthetic historical format sample."));
    // Register Runtime's witness UDFs and seed onto exact published schema *before* running migration.
    {
        let db = Connection::open(&live)?;
        register_witness_functions(&db)?;
        db.execute("INSERT INTO memories(id,user,ciphertext,nonce,embedding_enc,created_at,updated_at,dirty,deleted) VALUES(?1,?2,?3,?4,?5,?6,?6,1,0)",params![row.id,row.user,row.ciphertext,row.nonce,row.embedding_enc,row.updated_at])?;
        // A separate row is review-edited so the published encrypted sample stays unchanged.
        db.execute("INSERT INTO memories(id,user,ciphertext,nonce,embedding_enc,created_at,updated_at,dirty,deleted) VALUES(?1,?2,?3,?4,?5,?6,?6,0,0)",params![REVIEWED,row.user,row.ciphertext,row.nonce,row.embedding_enc,row.updated_at])?;
        db.execute("INSERT INTO meta(key,value) VALUES('memory_metadata_v1_enabled','1') ON CONFLICT(key) DO UPDATE SET value='1'",[])?;
    }
    {
        let store = LocalStore::open_existing(&live)?;
        let (nonce, ciphertext) =
            key.encrypt_content(&key.decrypt_content(&row.ciphertext, &row.nonce)?)?;
        row.id = REVIEWED.to_owned();
        row.ciphertext = ciphertext;
        row.nonce = nonce;
        row.updated_at = "2026-01-02T00:00:00.000Z".to_owned();
        row.local_created_at = "2026-01-01T00:00:00.000Z".to_owned();
        row.local_meta.memory_contract = 1;
        row.local_meta.review_at = Some("2026-12-01T00:00:00.000Z".to_owned());
        let review = ReviewHistoryRow {
            seq: None,
            entry_id: row.id.clone(),
            record_revision: format!("sha256:{}", "a".repeat(64)),
            action: "reschedule".to_owned(),
            actor: r#"{"kind":"owner_client","id":"fixture"}"#.to_owned(),
            happened_at: row.updated_at.clone(),
            previous_verification: None,
            next_verification: None,
            previous_review_at: None,
            next_review_at: row.local_meta.review_at.clone(),
            reason: None,
        };
        store.commit_review(&store.memory_revision()?, &row, &review)?;
        let (grant, _one_time_token) =
            store.create_grant(LEGACY, "synthetic compatibility grant")?;
        ensure!(store.list_grants()?.len() == 1 && grant.root_id == LEGACY);
        store.log_query(
            "synthetic legacy query",
            "compatibility",
            "fixture",
            &[LEGACY.to_owned()],
            &[0.75],
        )?;
        ensure!(
            store.outgoing()?.len() == 2
                && store.review_history(REVIEWED, 20)?.len() == 1
                && store.query_log_rows(10)?.len() == 1
        );
    }
    let before = witnesses(&live)?;
    ensure!(before.iter().map(|(_, r)| r.len()).collect::<Vec<_>>() == [2, 2, 1, 1, 1]);
    ensure!(before[1]
        .1
        .iter()
        .all(|r| serde_json::from_str::<serde_json::Value>(r).is_ok_and(|v| v[11] == "pending")));
    for phase in ["upgrade", "reopen"] {
        drop(LocalStore::open(&live)?);
        ensure!(
            witnesses(&live)? == before,
            "{phase}: compatibility witnesses changed"
        );
        println!("{phase},2,2,1,1,1,exact");
    }
    let manifest = snapshot::create(&root, "fixture", "golden populated", &key)?;
    ensure!(manifest.entries == 2);
    let portable = root.join("snapshots").join(format!("{}.db", manifest.id));
    let copy = Connection::open_with_flags(portable, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    ensure!(
        copy.query_row("SELECT COUNT(*) FROM access_grants", [], |r| r
            .get::<_, i64>(0))?
            == 0,
        "portable grant exclusion missing"
    );
    ensure!(witnesses(&live)? == before, "snapshot altered source");
    println!("portable_snapshot,2,not-asserted,not-asserted,0,not-asserted,source-exact");
    Ok(())
}
