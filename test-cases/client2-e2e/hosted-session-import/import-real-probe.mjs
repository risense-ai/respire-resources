import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertTargets, sameResolvedWindowsPath as samePath} from './discovery-gate.mjs';
const [url,locale]=process.argv.slice(2);
const expected=JSON.parse(process.env.CARD018_EXPECTED_IMPORT);
const {chromium}=createRequire(import.meta.url)(process.env.CARD018_PLAYWRIGHT_CORE);
const browser=await chromium.launch({headless:true,executablePath:process.env.CARD018_CHROMIUM,
  args:['--disable-background-networking','--no-first-run']});
let phase='browser startup', issue='';
try{
 const page=await browser.newPage({viewport:{width:1280,height:800},serviceWorkers:'block'});
 page.setDefaultTimeout(16000);
 let errors=0, previews=0;
 const reject=(kind)=>{errors++;if(!issue)issue=kind};
 const submitted=new Map(), done=new Map(), allowedReads=new Set(['session_import_targets',
   'session_import_preview','query_log','model_profile_list','diary_list','organize_suggestions','capabilities','model_profiles']);
 page.on('console',m=>{if(m.type()==='error')reject('console error')});
 page.on('pageerror',()=>reject('page error'));
 page.on('response',async r=>{
   const path=new URL(r.url()).pathname;
   if(r.status()>=400) {
     const label=path==='/api/execute'?'execute':path==='/api/operation'?'operation':path==='/api/operation-ack'?'ack':'other route';
     const code=r.status()===403?'forbidden':r.status()===404?'not found':'other HTTP error';
     if(issue==='console error')issue='';
     reject(label+' '+code);
   }
   if(!['/api/execute','/api/operation'].includes(path))return;
   try{const j=(await r.json()).result;if(j && ['done','unconfirmed','failed'].includes(j.state) &&
     ['session_import_targets','session_import_preview'].includes(j.name))done.set(j.id,j)}catch{reject('operation response decoding')}
 });
 await page.route('**/*',route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.origin!==url || !['GET','HEAD','POST'].includes(req.method())) {reject('request origin or method');return route.abort()}
   if(req.method()==='POST'){
     let data;try{data=req.postDataJSON()}catch{reject('POST body decoding');return route.abort()}
     const read=u.pathname==='/api/execute'&&allowedReads.has(data?.name);
     const ack=u.pathname==='/api/operation-ack'&&submitted.has(data?.id);
     if(!read&&!ack){reject('unexpected POST');return route.abort()}
     if(read){
       if(!/^desktop-[a-f0-9-]{36}$/.test(data?.id??'')){reject('unexpected operation ID');return route.abort()}
       if(data.name==='session_import_preview')previews++;
       submitted.set(data.id,data.name);
     }
   }
   return route.continue();
 });
 const terminal=async name=>{
   for(let i=0;i<600;i++){
     if(errors)throw Error('browser error before terminal receipt');
     for(const [id,r] of done)if(submitted.get(id)===name){
       assert.equal(r.state,'done');assert.equal(r.name,name);
       assert.deepEqual(r.scope,expected.scope);
       assert.equal(r.runtimeOperationId,id);
       assert.equal(r.envelope?.status,'ok');
       return r.envelope;
     }
     await new Promise(resolve=>setTimeout(resolve,25));
   }
   throw Error('terminal receipt missing');
 };
 phase='owned desktop state';
 const ready=page.waitForResponse(r=>r.url()===url+'/api/state'&&r.request().method()==='GET');
 await page.goto(url+'/workspace.html#session-import');
 const state=(await (await ready).json()).result;
 assert.equal(state.connected,true);assert.equal(state.preferences.language,locale);
 assert.equal(state.health.pid,Number(process.env.CARD018_RUNTIME_PID));
 assert.equal(state.health.instance_id,expected.scope.instance_id);

 phase='browser source operation receipt';
 const targets=await terminal('session_import_targets');
 phase='browser source typed discovery gate';
 assertTargets(targets,expected.codex);
 phase='browser sole selected source';
 await page.locator('[data-source=codex]:checked').waitFor();
 assert.equal(await page.locator('[data-source]:checked').count(),1);

 phase='read-only preview receipt';
 const control=page.locator('button[data-preview]');
 await control.click();
 const receipt=await terminal('session_import_preview');
 assert.deepEqual(receipt.summary,{dry_run:true,scanned:1,pending:1,skipped_imported:0,deferred_by_limit:0,by_platform:[{id:'codex',count:1}]});
 assert.equal(receipt.details?.sessions?.length,1);
 const row=receipt.details.sessions[0];
 assert.equal(row.platform,'codex');assert.equal(row.id,expected.id);
 assert.equal(row.first_user_message,expected.witness);
 assert.ok(samePath(row.path,expected.file));assert.ok(samePath(row.cwd,expected.cwd));

 phase='rendered localized preview';
 const panel=page.locator('[data-preview-result]');
 const witness=panel.getByText(expected.witness,{exact:true});
 await witness.waitFor();assert.equal(await panel.locator('.si-session').count(),1);
 assert.equal(await page.locator('html').getAttribute('lang'),locale==='zh'?'zh-CN':'en');
 assert.match(await control.innerText(),locale==='zh'?/\p{Script=Han}/u:/preview/i);
 for(const width of [1280,480]){
   await page.setViewportSize({width,height:800});
   assert.ok(await witness.isVisible());
   assert.deepEqual(await panel.evaluate(el=>({document:document.documentElement.scrollWidth<=innerWidth,
     panel:el.scrollWidth<=el.clientWidth})),{document:true,panel:true});
 }
 await panel.locator('details > summary').click();
 assert.ok(await panel.getByText('codex:'+expected.id,{exact:true}).isVisible());
 assert.equal(previews,1);assert.equal(errors,0);
 console.log('PASS genuine Windows Session Import preview '+locale+'; one synthetic session, two viewport widths, no Apply.');
}catch{
 console.error('FAIL: Session Import browser stage: '+phase+(issue?' ('+issue+')':''));
 process.exitCode=1;
}finally{await browser.close()}
