import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const fixture = new URL("./respire-1x-synthetic.db", import.meta.url);
const pinned = "a081b149521d3dd516fdda50bc744249293fb30990e3b98d1ee392189fe02c9d";
const digest = () => createHash("sha256").update(readFileSync(fixture)).digest("hex");

test("frozen synthetic Runtime 1.x baseline has its released schema and version", () => {
  assert.equal(digest(), pinned);
  const db = new DatabaseSync(fileURLToPath(fixture), {readOnly: true});
  try {
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 0);
    assert.equal(db.prepare("SELECT count(*) AS present FROM memories").get().present, 0);
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name));
    for (const name of ["memories", "memory_chunks", "meta", "access_grants", "review_history", "query_log", "sync_outbox"]) {
      assert(tables.has(name), "Missing released table: " + name);
    }
  } finally {
    db.close();
  }
  assert.equal(digest(), pinned, "Read-only verification must not modify the golden fixture");
});