import {appendFile,lstat,readFile,realpath} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {performance} from 'node:perf_hooks';
const phases = new Set(['browser-entry','browser-primary','browser-dispose-ops','browser-dispose-layout','browser-post-read','controller-diary-sync','browser-hello','browser-before','chromium-started','browser-observed','browser-ack','browser-failure','controller-failure','launcher-start','launcher-hello','launcher-after','launcher-closed','launcher-failure']);
const codes = new Set(['ERR_ASSERTION','ERR_INVALID_ARG_TYPE','ERR_STREAM_PREMATURE_CLOSE','ABORT_ERR','ENOENT','EPIPE','EACCES','EPERM','ETIMEDOUT','ECONNREFUSED']);
const kinds = new Set(['Error','AssertionError','TimeoutError','AbortError','TypeError','SyntaxError']);
const named = /^(?:positive-memory|diary-accounts|storage-settings|compiled-product|compiled-diary|compiled-storage)[-a-z]+\.mjs$/;
const pattern = /^FIXTURE DIAGNOSTIC (?:[a-z-]{1,24}) (?:[0-9]{1,8})ms (?:[A-Za-z]{1,20}) (?:[A-Z_]{1,36}|none)(?: [a-z-]+\.mjs:[0-9]{1,5}){0,5}(?: layout=[0-9]{2,4}x[0-9]{2,4}(?: (?:missing|overflow|invalid-text|bounds|clipped|icon|font):(?:surface|button|select|input|textarea|icon|summary|stats|details|runtime|onboarding|memory-title|tree-toggle|search-button|toolbar|metric-(?:one|two|three|four)-note)(?:,-?[0-9]{1,5}(?:\.[0-9])?){0,5}){1,3})?(?: http=[1-5][0-9]{2})?$/;
const layoutNames = new Map([
  ['missing product surface','missing'], ['horizontal overflow','overflow'],
  ['unresolved visible string or invalid number','invalid-text'], ['control bounds','bounds'],
  ['clipped button','clipped'], ['misaligned control icon','icon'], ['root font outside rem scale','font']
]);
const layoutRoles = new Set(['surface','button','select','input','textarea','icon','summary','stats','details','runtime','onboarding',
  'metric-one-note','metric-two-note','metric-three-note','metric-four-note','memory-title','tree-toggle','search-button','toolbar']);
function layoutSuffix(proof) {
  const {width,height} = proof?.size ?? {};
  if (![width,height].every(v=>Number.isInteger(v)&&v>=10&&v<=9999) || !Array.isArray(proof?.details)) return '';
  const details = proof.details.slice(0,3).flatMap(({issue,role,values} = {})=>{
    const label=layoutNames.get(issue);
    if(!label || !layoutRoles.has(role) || !Array.isArray(values) || values.length>5 ||
      !values.every(v=>Number.isFinite(v)&&Math.abs(v)<=99999)) return [];
    return [label+':'+role+values.map(v=>','+String(Math.round(v*10)/10)).join('')];
  });
  return details.length ? ' layout='+width+'x'+height+' '+details.join(' ') : '';
}
const fileName = 'card018-safe-browser-diagnostic.log';
export function diagnosticLine(phase,error) {
  if (!phases.has(phase)) throw new Error('Invalid diagnostic stage');
  const name = kinds.has(error?.name)?error.name:error?'Other':'none';
  const observed = String(error?.message??'').match(/\bnet::(ERR_(?:NAME_NOT_RESOLVED|CONNECTION_REFUSED|CONNECTION_RESET|ADDRESS_UNREACHABLE|BLOCKED_BY_CLIENT|PROXY_CONNECTION_FAILED|TIMED_OUT|ABORTED))\b/)?.[1];
  const code = observed??(codes.has(error?.code)?error.code:'none');
  const loc = String(error?.stack??'').split('\n').slice(1,12).flatMap(s=>{
    const m=s.match(/[\\/]([a-z-]+\.mjs):([0-9]{1,5}):[0-9]{1,5}(?:\)|$)/);
    return m&&named.test(m[1])?[m[1]+':'+m[2]]:[];
  }).slice(0,5);
  const status=phase==="controller-diary-sync"&&Number.isInteger(error?.diaryAfterSyncHTTP)&&
    error.diaryAfterSyncHTTP>=100&&error.diaryAfterSyncHTTP<=599 ? " http="+error.diaryAfterSyncHTTP : "";
  const line='FIXTURE DIAGNOSTIC '+phase+' '+Math.floor(performance.now())+'ms '+name+' '+code+(loc.length?' '+loc.join(' '):'')+layoutSuffix(error?.productLayout)+status;
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
