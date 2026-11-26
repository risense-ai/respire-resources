"""Generate a synthetic populated copy. Use Python SQLite 3.53.1 for the pinned file bytes."""
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

GOLDEN = "a081b149521d3dd516fdda50bc744249293fb30990e3b98d1ee392189fe02c9d"
ROW = "9ff3d60ba6b9ce2649364cc0d87e83ab1bea504b25cb233da1f1df27667ca5c9"
STAMP = "2026-01-01T00:00:00.000Z"


def hashed(domain, args):
    payload = json.dumps(args, ensure_ascii=False, separators=(',', ':')).encode()
    return hashlib.sha256(b'rsrs:witness:' + domain + b':v1\0' + payload).hexdigest()


def generate(base, row, output):
    original, encoded = base.read_bytes(), row.read_bytes()
    if hashlib.sha256(original).hexdigest() != GOLDEN or hashlib.sha256(encoded).hexdigest() != ROW:
        raise ValueError('unexpected input digest')
    memory = json.loads(encoded)
    with output.open('xb') as dst:
        dst.write(original)
    db = sqlite3.connect(output)
    try:
        # Fixed entropy and time apply only to this fixture-construction connection.
        from itertools import count
        ids = count()
        def fixture_random(size):
            return hashlib.shake_256(f'card018-fixture-{next(ids)}'.encode()).digest(size)
        db.create_function('randomblob', 1, fixture_random)
        def fixture_time(fmt, when):
            if (fmt, when) != ('%Y-%m-%dT%H:%M:%fZ','now'):
                raise ValueError('unexpected fixture timestamp expression')
            return STAMP
        db.create_function('strftime', 2, fixture_time)
        db.create_function('rsrs_witness_source_v1', 18, lambda *args: hashed(b'source', args))
        db.create_function('rsrs_witness_event_v1', 9, lambda *args: hashed(b'event', [1, *args]))
        with db:
            db.execute('pragma foreign_keys=on')
            db.execute("""insert into memories(id,user,ciphertext,nonce,embedding_enc,created_at,updated_at,dirty)
                          values(:id,:user,:ciphertext,:nonce,:embedding_enc,:updated_at,:updated_at,1)""", memory)
            mid = memory['id']
            db.execute("""insert into review_history(entry_id,record_revision,action,actor,happened_at,next_review_at,reason)
                          values(?,?,'reschedule',?,?,?,'synthetic review')""",
                       (mid,'sha256:'+('a'*64),'{"kind":"owner_client","id":"fixture"}',STAMP,'2026-12-01T00:00:00.000Z'))
            db.execute('insert into access_grants(id,label,root_id,token_hash,created_at) values(?,?,?,?,?)',
                       ('synthetic-grant','fixture',mid,hashlib.sha256(b'public-test-only').hexdigest(),STAMP))
            db.execute('insert into query_log(ts_unix,ts,query,project,scope,candidates,candidate_scores,request_id) values(?,?,?,?,?,?,?,?)',
                       (1767225600,STAMP,'fixture query','fixture','fixture',json.dumps([mid]),'[0.75]','fixture-request'))
            db.execute('insert into skill_runs(skill_id,status,note,ts_unix) values(?,?,?,?)',
                       ('fixture-skill','success','synthetic execution record',1767225600))
        if db.execute("select count(*) from sync_outbox where state='pending' and id=?", (mid,)).fetchone() != (1,):
            raise ValueError('missing trigger-generated pending operation')
        if db.execute("select count(*) from entry_audit where action='create' and entry_id=?", (mid,)).fetchone() != (1,):
            raise ValueError('missing trigger-generated creation audit')
    finally:
        db.close()


if __name__ == '__main__':
    generate(*map(Path, sys.argv[1:]))
