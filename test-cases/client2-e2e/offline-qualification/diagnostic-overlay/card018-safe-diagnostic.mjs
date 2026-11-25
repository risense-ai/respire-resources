import {appendFile,lstat,readFile,realpath} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {performance} from 'node:perf_hooks';
const phases = new Set(['browser-entry','browser-hello','browser-before','chromium-started','browser-observed','browser-ack','browser-failure','controller-failure','launcher-start','launcher-hello','launcher-after','launcher-closed','launcher-failure']);
const codes = new Set(['ERR_ASSERTION','ERR_INVALID_ARG_TYPE','ERR_STREAM_PREMATURE_CLOSE','ABORT_ERR','ENOENT','EPIPE','EACCES','EPERM','ETIMEDOUT','ECONNREFUSED']);
const kinds = new Set(['Error','AssertionError','TimeoutError','AbortError','TypeError','SyntaxError']);
const named = /^(?:positive-memory|diary-accounts|storage-settings|compiled-product|compiled-diary|compiled-storage)[-a-z]+\.mjs$/;
const pattern = /^FIXTURE DIAGNOSTIC (?:[a-z-]{1,24}) (?:[0-9]{1,8})ms (?:[A-Za-z]{1,20}) (?:[A-Z_]{1,36}|none)(?: [a-z-]+\.mjs:[0-9]{1,5}){0,5}$/;
const fileName = 'card018-safe-browser-diagnostic.log';
export function diagnosticLine(phase,error) {
  if (!phases.has(phase)) throw new Error('Invalid diagnostic stage');
  const name = kinds.has(error?.name)?error.name:error?'Other':'none';
  const code = codes.has(error?.code)?error.code:'none';
  const loc = String(error?.stack??'').split('\n').slice(1,12).flatMap(s=>{
    const m=s.match(/[\\/]([a-z-]+\.mjs):([0-9]{1,5}):[0-9]{1,5}(?:\)|$)/);
    return m&&named.test(m[1])?[m[1]+':'+m[2]]:[];
  }).slice(0,5);
  const line='FIXTURE DIAGNOSTIC '+phase+' '+Math.floor(performance.now())+'ms '+name+' '+code+(loc.length?' '+loc.join(' '):'');
  if(!pattern.test(line)) throw new Error('Invalid diagnostic envelope');
  return line;
}
export function diag(phase,error){ try{console.error(diagnosticLine(phase,error));}catch{} }
async function owned(root){
  if(!root||!basename(root).startsWith('respire '))return null;
  const d=await lstat(root);
  if(!d.isDirectory()||d.isSymbolicLink()) return null;
  return await realpath(root);
}
export async function browserMarker(phase,error){
  try {
    const root=await owned(process.env.HOME);
    if(!root||root.toLowerCase()!==(await realpath(process.cwd())).toLowerCase())return;
    await appendFile(join(root,fileName),diagnosticLine(phase,error)+'\n',{encoding:'utf8',mode:0o600});
  } catch {}
}
export async function relayBrowserMarkers(root){
  try{
    const canonical=await owned(root);
    if(!canonical)return;
    const path=join(canonical,fileName),stat=await lstat(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4096)return;
    const lines=(await readFile(path,'utf8')).split('\n').filter(Boolean);
    if(lines.length>12||!lines.every(x=>pattern.test(x)&&/^FIXTURE DIAGNOSTIC (browser-|chromium-started )/.test(x)))return;
    for(const line of lines) console.error(line);
  }catch{}
}
