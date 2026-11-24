import assert from 'node:assert/strict';
import {createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes} from 'node:crypto';
import {copyFileSync,mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createServer} from 'node:net';
import {spawnSync} from 'node:child_process';
import {assertBinary, ownedProcess, withCleanup} from '../../targets.mjs';

const [tempPath,binary,sha,seed]=process.argv.slice(2);
assert.equal(process.platform,'win32','This fixture currently attests Windows only');
assert(tempPath && /^[a-f0-9]{64}$/.test(sha),'Supply an owned temp directory, Runtime binary, lowercase SHA-256 and synthetic seed executable');
await assertBinary(binary,'Runtime');
await assertBinary(seed,'synthetic Vault seed');
const temp=realpathSync(tempPath);
const base=new URL('../db/respire-1x-synthetic.db',import.meta.url);
const vectorPath=new URL('./vault-v1-v4.json',import.meta.url);
const digest=value=>createHash('sha256').update(value).digest('hex');
assert.equal(digest(readFileSync(binary)),sha);
const fixtures=JSON.parse(readFileSync(vectorPath,'utf8'));
assert.equal(fixtures.synthetic,true);
assert.equal(fixtures.vectors.length,8);
assert.equal(digest(readFileSync(base)),'a081b149521d3dd516fdda50bc744249293fb30990e3b98d1ee392189fe02c9d');
const samePath=x=>realpathSync(x).toLowerCase().replace(/^..[?]./,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const id='aaaaaaaa-0000-4000-8000-000000000001';
const user='card018-public-synthetic';
const at='2026-01-01T00:00:00.000Z';

async function run(v){
  const {version,domain}=v;
  assert([1,2,3,4].includes(version)&&['onememory','rsrs'].includes(domain));
  const root=realpathSync(mkdtempSync(join(temp,'vault-'+version+'-'+domain+'-')));
  return withCleanup(()=>exercise(v,root),async()=>{
    assert.equal(dirname(root),temp,'Refusing to clean outside the owned case root');
    assert.equal(realpathSync(root),root,'Owned case root was redirected');
    rmSync(root,{recursive:true});
  });
}

async function exercise(v,root){
  const {version,domain}=v;
  mkdirSync(join(root,'runtime'));
  const db=join(root,'rsrs.db');
  copyFileSync(base,db);
  const session=JSON.stringify({user,addr:'https://card018.invalid',vault_version:version,kdf_salt:v.kdf_salt,urk_nonce:v.urk_nonce,wrapped_urk:v.wrapped_urk});
  writeFileSync(join(root,'session.json'),session,{mode:0o600,flag:'wx'});
  const hostToken=randomBytes(32).toString('hex');
  writeFileSync(join(root,'runtime','token'),hostToken,{mode:0o600,flag:'wx'});
  const env={};
  for(const name of ['SystemRoot','WINDIR','PATH','PATHEXT','SYSTEMDRIVE']) if(process.env[name]) env[name]=process.env[name];
  Object.assign(env,{HOME:root,USERPROFILE:root,APPDATA:root,LOCALAPPDATA:root,TEMP:root,TMP:root,RSRS_DATA_DIR:root,RSRS_RPC_TOKEN:hostToken,RSRS_NO_AUTOSYNC:'1'});
  // Frozen ciphertext is a bare string, not a valid memory record. Verify its exact bytes
  // with the fixture's independently published data key, then seal a valid historical
  // memory object carrying that same exact text for the product read.
  const key=hkdfSync('sha256',Buffer.from(v.expected_urk_hex,'hex'),Buffer.alloc(0),Buffer.from(domain+':data:v1'),32);
  const frozen=Buffer.from(v.data.ciphertext.replace(/^rsrs:v1:/,''),'hex');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(v.data.nonce_hex,'hex'));
  decipher.setAuthTag(frozen.subarray(-16));
  assert.equal(Buffer.concat([decipher.update(frozen.subarray(0,-16)),decipher.final()]).toString('utf8'),v.data.expected_utf8);
  const structured=JSON.stringify({kind:'knowledge',tags:'',title:'Golden Vault memory',content:v.data.expected_utf8,user,computer:'',project:'',created_at:at,updated_at:at});
  const nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,nonce);
  const marker=domain==='rsrs'?'rsrs:v1:':'';
  const ciphertext=marker+Buffer.concat([cipher.update(structured),cipher.final(),cipher.getAuthTag()]).toString('hex');
  const seeded=spawnSync(seed,[db],{env,input:JSON.stringify({id,user,ciphertext,nonce:nonce.toString('hex')}),encoding:'utf8',timeout:5000,windowsHide:true});
  if(seeded.status!==0)throw new Error('native SQL fixture seed failed: '+seeded.status+' '+seeded.stderr);
  const socket=createServer();
  await new Promise((resolve,reject)=>socket.listen(0,'127.0.0.1',resolve).once('error',reject));
  const port=socket.address().port;
  await new Promise(resolve=>socket.close(resolve));
  const endpoint='http://127.0.0.1:'+port;
  const runner=ownedProcess(binary,['serve','--host','127.0.0.1','--port',String(port),'--data-dir',root],{cwd:dirname(binary),env,stdio:['ignore','ignore','pipe']});
  const worker=runner.child;
  worker.stderr.resume();
  const request=(path,body)=>fetch(endpoint+path,{method:'POST',headers:{Authorization:'Bearer '+hostToken,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(11000),redirect:'error'});
  const health=async()=>{
    const res=await fetch(endpoint+'/api/health',{signal:AbortSignal.timeout(900),redirect:'error'});
    assert.equal(res.status,200);
    const h=await res.json();
    assert.equal(h.pid,worker.pid);
    assert.equal(h.image_sha256,sha);
    assert.equal(samePath(h.image_path),samePath(binary));
    assert.equal(samePath(h.data_dir),samePath(root));
    // Bind the loopback response to the endpoint published in this test's
    // fresh, private profile before any synthetic unlock factors are sent.
    const published=JSON.parse(readFileSync(join(root,'runtime','endpoint.json'),'utf8'));
    assert.equal(published.pid,worker.pid);
    assert.equal(published.url,endpoint);
    assert.equal(published.image_sha256,sha);
    assert.equal(samePath(published.data_dir),samePath(root));
    assert.equal(published.instance_id,h.instance_id);
    return h;
  };
  try{
    const deadline=Date.now()+22000;
    let initial;
    while(Date.now()<deadline){
      runner.assertRunning();
      let current;
      try{current=await health();}catch(err){if(err.name==='AssertionError')throw err;await sleep(120);continue;}
      if(current.startup_complete&&current.state==='locked'&&current.credential_state==='required'){
        initial=current;break;
      }
      await sleep(120);
    }
    assert(initial,'never reached locked authenticated startup');
    const scope=Object.fromEntries(['account_id','instance_id','generation'].map(k=>[k,initial[k]]));
    const frame=good=>{
      const factor=good?v.unlock_factor:version===4?'A3-000000-000000-000000-000000-000000-000000':'wrong-public-fixture-factor';
      return {schema_version:2,profile:root,session_sha256:digest(session),instance_id:initial.instance_id,generation:initial.generation,
        super_password:version===1?null:factor,login_password:version===1?factor:null,
        legacy_secret:version===1?v.account_secret:version===3?v.secret_key:null,
        provider_update:{kind:'replace',credentials:[]}};
    };
    const negative=await request('/api/runtime/unlock',frame(false));
    assert.equal(negative.status,409,'wrong factor accepted or unexpected endpoint status');
    const still=await health();
    assert.equal(still.store_ready,false);
    assert.equal(still.instance_id,initial.instance_id);
    const positive=await request('/api/runtime/unlock',frame(true));
    if(positive.status!==200)throw Error('correct factor '+positive.status);
    const receipt=await positive.json();
    assert.equal(receipt.schema_version,2);
    assert.equal(receipt.store_ready,true);
    assert.equal(receipt.provider_status.state,'ready');
    const opened=await health();
    assert.equal(opened.store_ready,true);
    assert.equal(opened.instance_id,initial.instance_id);
    const req={v:1,id:'card018-vault-show',operation_id:'card018-vault-show-operation',idempotency_key:'card018-vault-show-key',
      scope,method:'cli.exec',args:['--json','show',id]};
    const response=await request('/api/rpc',req);
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.id,req.id);
    if(!result.ok)throw Error('legacy show failed: '+JSON.stringify({code:result.code,exit:result.exit,command:result.envelope?.command,errors:result.envelope?.errors}));
    assert.equal(result.envelope.command,'show');
    assert.equal(result.envelope.details.entry.id,id);
    assert.equal(result.envelope.details.entry.content,v.data.expected_utf8);
    console.log(version+','+domain+',409,locked,200,ready,legacy-show-exact-utf8');
  }finally{
    await runner.stop();
  }
}
console.log('version,domain,wrong_factor,wrong_post_state,correct_factor,correct_post_state,retrieval');
let failures=0;
for(const v of fixtures.vectors){
  try{await run(v)}catch(err){failures++;console.error('FAIL',v.version,v.domain,err.message)}
}
if(failures)process.exitCode=1;
