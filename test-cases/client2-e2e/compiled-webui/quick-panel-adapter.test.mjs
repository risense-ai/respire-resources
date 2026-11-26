import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {once} from "node:events";
import {mkdir,mkdtemp,rm,symlink,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {test} from "node:test";
import {quickPanelAdapter,verifyWebUIBundle} from "./quick-panel-adapter.mjs";

const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const source="a".repeat(40);
async function bundle(t){
  const dir=await mkdtemp(join(tmpdir(),"card018-embed-fixture-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const contents={"quickpanel.html":"synthetic test placeholder","quickpanel.js":"/* synthetic */","ui/i18n.js":"/* synthetic catalog */"};
  for(const [name,bytes] of Object.entries(contents)){
    const target=join(dir,"assets",name);
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,bytes);
  }
  const manifest=JSON.stringify({schema:1,source_sha:source,files:Object.fromEntries(
    Object.entries(contents).map(([name,bytes])=>[name,{size:Buffer.byteLength(bytes),sha256:hash(bytes)}]))});
  await writeFile(join(dir,"webui.json"),manifest);
  return {dir,manifestSHA:hash(manifest),placeholder:contents["quickpanel.html"]};
}

test("exact pins bind bundle source, content and closed tree",async t=>{
  const {dir,manifestSHA,placeholder}=await bundle(t);
  const assets=await verifyWebUIBundle(dir,source,manifestSHA);
  assert.equal(assets.get("quickpanel.html").toString(),placeholder);
  await assert.rejects(verifyWebUIBundle(dir,"b".repeat(40),manifestSHA),/source differs/);
  await assert.rejects(verifyWebUIBundle(dir,source,"b".repeat(64)),/manifest digest differs/);
  const extra=join(dir,"assets","extra.txt");
  await writeFile(extra,"untracked");
  await assert.rejects(verifyWebUIBundle(dir,source,manifestSHA),/Unexpected bundle file/);
  await rm(extra);
  const pinned=join(dir,"assets","quickpanel.html");
  await writeFile(pinned,"?".repeat(placeholder.length));
  await assert.rejects(verifyWebUIBundle(dir,source,manifestSHA),/asset digest differs/);
  await rm(pinned);
  await symlink(join(dir,"assets","quickpanel.js"),pinned);
  await assert.rejects(verifyWebUIBundle(dir,source,manifestSHA),/Unexpected bundle file/);
});

test("loopback adapter serves exact asset and genuine positive Mock status; unknown reads and mutations fail",async t=>{
  const {dir,manifestSHA,placeholder}=await bundle(t);
  const assets=await verifyWebUIBundle(dir,source,manifestSHA);
  const {app,observed,count}=quickPanelAdapter(assets,{locale:"zh"});
  await once(app.listen(0,"127.0.0.1"),"listening");
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  const origin="http://127.0.0.1:"+app.address().port;
  const req=(path,options)=>fetch(origin+path,options);
  assert.equal(await (await req("/quickpanel.html")).text(),placeholder);
  assert.equal((await (await req("/api/state")).json()).result.preferences.language,"zh");
  const status=(await (await req("/api/runtime-status")).json()).result.summary;
  assert(count>0);
  assert.equal(status.local_alive,count);
  const resize={method:"POST",headers:{Origin:origin,"X-Respire-Client":"1","Content-Type":"application/json"},
    body:JSON.stringify({height:440})};
  assert.equal((await req("/api/panel-size",resize)).status,200);
  assert.equal((await req("/api/state",{headers:{Origin:"https://example.invalid"}})).status,403);
  assert.equal((await req("/api/execute",resize)).status,404);
  assert.equal((await req("/api/panel-size",{...resize,body:'{"height":-1}'})).status,400);
  assert.deepEqual(observed,{state:1,status:1,resize:1,denied:3});
});

test("negative status input cannot supply successful ready data",async t=>{
  const {app,observed}=quickPanelAdapter(new Map(),{locale:"en",failStatus:true});
  await once(app.listen(0,"127.0.0.1"),"listening");
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  const result=await fetch("http://127.0.0.1:"+app.address().port+"/api/runtime-status");
  assert.equal(result.status,503);
  assert.equal((await result.json()).ok,false);
  assert.deepEqual(observed,{state:0,status:1,resize:0,denied:0});
});
