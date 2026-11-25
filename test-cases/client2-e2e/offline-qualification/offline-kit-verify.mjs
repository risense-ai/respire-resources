import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const MAX_FILES = 5000;
const MAX_BYTES = 2 * 1024 ** 3;
const MANIFEST_NAME = 'offline-kit.json';
const required = ['rsrs-runtime.exe','client2-proof.test.exe','browser/chrome-win/chrome.exe','playwright/index.js'];
export const frozenBrowserSHA256 = '153106834fb06976c587c39aaef0e8c0d1b1339a575e8d7b87f187058663a094';
const isHex = (s, re) => typeof s === 'string' && re.test(s);

function checkedSegment(s) {
  // ASCII staging names prevent Windows aliases and Unicode/case collisions.
  if (!/^[a-z0-9_.+ -]+$/i.test(s) || s === '.' || s === '..' || s.trim() !== s || s.endsWith('.') ||
      /^(con|nul|prn|aux|com[1-9]|lpt[1-9])(\.|$)/i.test(s)) throw new Error('Unsafe kit path segment');
}

function checkedPath(name) {
  if (typeof name !== 'string' || !name || name.length > 235) throw new Error('Invalid kit path length');
  name.split('/').forEach(checkedSegment);
}

async function shaFile(file) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

async function walk(dir, rel, visit) {
  for (const entry of await readdir(dir)) {
    checkedSegment(entry);
    const next = join(dir,entry);
    const name = rel ? rel + '/' + entry : entry;
    checkedPath(name);
    const st = await lstat(next);
    if (st.isSymbolicLink()) throw new Error('Link or junction in staged kit');
    if (st.isDirectory()) await walk(next,name,visit);
    else if (st.isFile() && st.nlink === 1) await visit(name,next,st.size);
    else throw new Error('Special or multiply-linked kit file');
  }
}

export async function verifyOfflineKit(root,pins) {
  if (!isHex(pins?.fixture,COMMIT) || !isHex(pins?.product,COMMIT) ||
      !isHex(pins?.manifestDigest,SHA) || !isHex(pins?.browserDigest,SHA) ||
      (typeof pins?.buildRun !== 'string' || !/^[1-9][0-9]*$/.test(pins.buildRun))) {
    throw new Error('Missing independent frozen build pins');
  }
  root = resolve(root);
  const dir = await lstat(root);
  if (dir.isSymbolicLink() || !dir.isDirectory()) throw new Error('Kit root must be an owned physical directory');
  const path = join(root,MANIFEST_NAME);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 ** 2)
    throw new Error('Invalid manifest image');
  const bytes = await readFile(path);
  if (createHash('sha256').update(bytes).digest('hex') !== pins.manifestDigest) throw new Error('Manifest hash mismatch');
  const m = JSON.parse(bytes);
  if (m.schema !== 1 || m.target !== 'x86_64-pc-windows-msvc' ||
      m.fixture !== pins.fixture || m.product !== pins.product || m.buildRun !== pins.buildRun ||
      m.browserDigest !== pins.browserDigest || !Array.isArray(m.files) || m.files.length > MAX_FILES)
    throw new Error('Staging metadata does not match pinned build');
  const expected = new Map();
  const aliases = new Set();
  let total = 0;
  for (const f of m.files) {
    checkedPath(f.path);
    const alias = f.path.toLowerCase();
    if (alias === MANIFEST_NAME || aliases.has(alias) ||
        !isHex(f.sha256,SHA) || !Number.isSafeInteger(f.bytes) || f.bytes < 0)
      throw new Error('Invalid or duplicate kit manifest item');
    aliases.add(alias);
    expected.set(f.path, f);
    total += f.bytes;
    if (total > MAX_BYTES) throw new Error('Kit is too large');
  }
  if (required.some(k => !expected.has(k)) || expected.get(required[2]).sha256 !== pins.browserDigest)
    throw new Error('Kit missing pinned product, browser or runner files');
  await walk(root,'',async (name,file,bytes) => {
    if (name === MANIFEST_NAME) return;
    const f = expected.get(name);
    if (!f || f.bytes !== bytes || f.sha256 !== await shaFile(file)) throw new Error('Unexpected or modified staged kit file');
    expected.delete(name);
  });
  if (expected.size) throw new Error('Incomplete kit');
  return {product:m.product,fixture:m.fixture,buildRun:m.buildRun,browserDigest:m.browserDigest,files:m.files.length};
}
