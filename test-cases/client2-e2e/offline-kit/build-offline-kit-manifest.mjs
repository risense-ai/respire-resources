import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { frozenBrowserSHA256, verifyOfflineKit } from './offline-kit-verify.mjs';
const [, , stage, fixture, product, buildRun] = process.argv;
const root = resolve(stage);
const files = [];
async function collect(directory, prefix) {
  for (const f of (await readdir(directory)).sort()) {
    const path = prefix ? prefix + '/' + f : f;
    const full = join(directory, f);
    const info = await lstat(full);
    if (info.isDirectory() && !info.isSymbolicLink()) await collect(full, path);
    else if (info.isFile() && !info.isSymbolicLink() && info.nlink === 1) {
      const h = createHash('sha256');
      for await (const chunk of createReadStream(full)) h.update(chunk);
      files.push({path,bytes:info.size,sha256:h.digest('hex')});
    } else throw new Error('Refuse non-regular kit file');
  }
}
await collect(root,'');
const browserDigest = frozenBrowserSHA256;
const json = JSON.stringify({schema:1,target:'x86_64-pc-windows-msvc',fixture,product,buildRun,browserDigest,files})+'\n';
const manifestDigest = createHash('sha256').update(json).digest('hex');
await writeFile(join(root,'offline-kit.json'),json,{flag:'wx'});
const result = await verifyOfflineKit(root,{fixture,product,buildRun,manifestDigest,browserDigest});
console.log('Verified '+result.files+' exact bundle files and independently pinned Chromium');
