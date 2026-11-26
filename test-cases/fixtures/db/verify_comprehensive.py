"""Verify the committed synthetic Golden offline with Python's SQLite reader."""
from contextlib import closing
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory

from seed_comprehensive import generate

ROOT = Path(__file__).resolve().parent
BASE = ROOT / 'respire-1x-synthetic.db'
ROW = ROOT / 'legacy-encrypted-row.json'
FIXTURE = ROOT / 'comprehensive-synthetic.db'
PIN = '33f83225b1441f6d813792add07ea3d5ab0d0748b2ae4f14363b1725f17e2e30'
TABLES = ('memories', 'sync_outbox', 'review_history', 'access_grants',
          'query_log', 'skill_runs', 'entry_audit')


def read(path):
    return sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)


def schema(db):
    return db.execute('select type,name,tbl_name,sql from sqlite_schema order by type,name').fetchall()


def verify():
    if sha256(FIXTURE.read_bytes()).hexdigest() != PIN:
        raise ValueError('fixture digest mismatch')
    with TemporaryDirectory() as tmp:
        rebuilt = Path(tmp) / 'rebuilt.db'
        generate(BASE, ROW, rebuilt)
        with closing(read(BASE)) as base, closing(read(FIXTURE)) as db, closing(read(rebuilt)) as other:
            assert schema(base) == schema(db) == schema(other)
            assert sum(kind == 'trigger' for kind, *_ in schema(db)) == 29
            assert db.execute('pragma quick_check').fetchall() == [('ok',)]
            assert not db.execute('pragma foreign_key_check').fetchall()
            assert db.execute('pragma user_version').fetchone() == (0,)
            for table in TABLES:
                query = f'select * from {table} order by rowid'
                rows = db.execute(query).fetchall()
                assert len(rows) == 1 and rows == other.execute(query).fetchall(), table
            row = json.loads(ROW.read_bytes())
            assert db.execute('select typeof(id),id,ciphertext,nonce,embedding_enc from memories').fetchone() == (
                'text', row['id'], row['ciphertext'], row['nonce'], row['embedding_enc'])
            assert db.execute('select id,state from sync_outbox').fetchone() == (row['id'], 'pending')
            assert db.execute('select entry_id,action from entry_audit').fetchone() == (row['id'], 'create')
        if sqlite3.sqlite_version == '3.53.1' and rebuilt.read_bytes() != FIXTURE.read_bytes():
            raise ValueError('pinned SQLite regeneration differs')
    print(f'SQLite {sqlite3.sqlite_version}; 7 populated tables; 29 original triggers; marker 0; {PIN}')


if __name__ == '__main__':
    if not __debug__:
        raise RuntimeError('reader assertions require normal Python mode')
    verify()
