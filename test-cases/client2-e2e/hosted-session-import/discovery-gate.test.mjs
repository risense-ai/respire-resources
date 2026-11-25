import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, realpathSync, rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertTargets,PrivacyGateError} from './discovery-gate.mjs';
const ids=['aside','claude','codex','openclaw','droid','amp','gemini','kimi','qwen','codebuff',
  'roo-code','kilo-code','cline','aider','kiro','opencode','kilo-cli','hermes','goose','crush','zed','senpi',
  'oh-my-pi','gajae-code','kodu','cursor-cli'];
const report=()=>({status:'ok',summary:{count:26,installed:0},details:ids.map(id=>({id,installed:false,roots:[]}))});
const row=(r,id)=>r.details.find(x=>x.id===id);
test('empty discovery and one explicitly owned synthetic root',()=>{
 const p=realpathSync.native(mkdtempSync(join(tmpdir(),'session-gate-unit-')));
 try{
   const r=report();
   assertTargets(r);
   Object.assign(row(r,'codex'),{installed:true,roots:[p]});r.summary.installed=1;
   assertTargets(r,p);
   assert.throws(()=>assertTargets(r),PrivacyGateError);
   row(r,'codex').roots.push(p);
   assert.throws(()=>assertTargets(r,p),PrivacyGateError);
 }finally{rmdirSync(p);}
});
for(const [name,bad] of [
 ['nonempty unrelated roots even with false installed',r=>row(r,'claude').roots=['redacted']],
 ['unrelated installed source',r=>row(r,'claude').installed=true],
 ['unknown scanner',r=>r.details[0].id='unexpected'],
 ['duplicate scanner',r=>r.details[0].id='codex'],
 ['missing scanner',r=>r.details.pop()],
 ['miscount',r=>r.summary.installed=1],
 ['malformed row',r=>r.details[0]=null],
 ['incorrect success state',r=>r.status='skip']
])test('rejects '+name,()=>{const r=report();bad(r);assert.throws(()=>assertTargets(r),PrivacyGateError);});
