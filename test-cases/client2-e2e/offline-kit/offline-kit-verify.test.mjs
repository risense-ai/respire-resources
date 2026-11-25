import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { verifyOfflineKit } from './offline-kit-verify.mjs';
const hash = s => createHash('sha256').update(s).digest('hex');
const browser = 'browser/chrome-win/chrome.exe';
async function fixture(t, edit = () => {}) {
  const root = await mkdtemp(join(tmpdir(),'card018-kit-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const files = ['rsrs-runtime.exe','client2-proof.test.exe',browser,'playwright/index.js'];
  for (const path of files) {
    await mkdir(dirname(join(root,path)),{recursive:true});
    await writeFile(join(root,path),path);
  }
  const m = {schema:1,target:'x86_64-pc-windows-msvc',buildRun:'12',
    fixture:'1'.repeat(40),product:'2'.repeat(40),browserDigest:hash(browser),
    files:files.map(path => ({path,bytes:path.length,sha256:hash(path)}))};
  const pins = {buildRun:m.buildRun,product:m.product,fixture:m.fixture,browserDigest:m.browserDigest};
  edit(m);
  const data = JSON.stringify(m);
  await writeFile(join(root,'offline-kit.json'),data);
  return {root,pins:{...pins,manifestDigest:hash(data)}};
}
test('staging verifies exact supplied manifest, build and complete extracted file inventory',async t=>{
  const {root,pins}=await fixture(t);
  a.equal((await verifyOfflineKit(root,pins)).files,4);
  for(const [field,value] of [['buildRun','16'],['browserDigest','9'.repeat(64)],['manifestDigest','9'.repeat(64)]])
    await a.rejects(verifyOfflineKit(root,{...pins,[field]:value}),/mismatch|does not match/);
});
test('unexpected helper and changed bytes are not accepted',async t=>{
  const {root,pins}=await fixture(t);
  await writeFile(join(root,'inject.exe'),'unexpected');
  await a.rejects(verifyOfflineKit(root,pins),/Unexpected/);
  await rm(join(root,'inject.exe'));
  await writeFile(join(root,'rsrs-runtime.exe'),'modified');
  await a.rejects(verifyOfflineKit(root,pins),/modified/);
});
test('archive paths with Windows aliases or collisions are refused',async t=>{
  for(const path of ['playwright/../tool.exe','playwright/aux.exe','playwright/INDEX.js','playwright/index.js.','playwright/index.js:other']){
    const {root,pins}=await fixture(t,m=>m.files.push({...m.files.at(-1),path}));
    await a.rejects(verifyOfflineKit(root,pins),/Unsafe|duplicate/);
  }
});
test('linked helper files are refused before content is used', async t=>{
  const {root,pins}=await fixture(t);
  await symlink(join(root,'rsrs-runtime.exe'),join(root,'helper.exe'));
  await a.rejects(verifyOfflineKit(root,pins),/Link/);
});
