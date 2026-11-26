import assert from "node:assert/strict";
import {once} from "node:events";
import {test} from "node:test";
import {quickPanelAdapter} from "./quick-panel-adapter.mjs";
import {marker,needle,verifyWailsRuntime,workspaceMock} from "./workspace-mock.mjs";

const id="desktop-00000000-0000-0000-0000-000000000000";
const exec=(domain,name,args)=>domain.execute({name,args,id,confirmed:true,secret:""});

test("positive list and Recall use the deterministic typed fixture and reject scope drift",()=>{
  const workspace=workspaceMock("workspace");
  const recall=workspaceMock("recall");
  assert.equal(workspace.status.memory_count,1);
  assert.deepEqual(exec(workspace,"memory_list",{limit:500,metadata:true}).envelope.details.map(item=>item.title),[marker]);
  assert.throws(()=>exec(workspace,"memory_search",{query:needle,limit:50}));
  assert.equal(exec(recall,"capabilities",{}).envelope.summary.capabilities.memory_list_metadata,true);
  assert.throws(()=>exec(recall,"memory_search",{query:"not authorized",limit:50}));
  assert.deepEqual(exec(recall,"memory_search",{query:needle,limit:50}).envelope.details.map(item=>item.title),[marker]);
  assert.throws(()=>exec(recall,"memory_store",{content:"not allowed"}));
  assert.deepEqual([...recall.operations],["capabilities","memory_search"]);
});

test("Overview scopes its legacy reads to known typed Mock routes",()=>{
  const mock=workspaceMock("overview");
  assert.equal(mock.status.memory_count,1000);
  assert.equal(typeof exec(mock,"query_log",{stats:true,limit:1}).envelope.details.total,"number");
  assert.throws(()=>exec(mock,"query_log",{stats:true,limit:10}));
  assert.throws(()=>exec(mock,"capabilities",{}));
  assert.throws(()=>exec(mock,"diary_list",{from:"2026-01-01",to:"2026-01-02"}));
  assert.equal(exec(mock,"organize_suggestions",{top:50}).envelope.details.suggests.length,50);
});

test("Wails pin rejects absent path and tests real bytes when provisioned",async t=>{
  await assert.rejects(verifyWailsRuntime("relative"),/production Wails runtime/);
  const path=process.env.RESPIRE_E2E_WAILS_RUNTIME;
  if(!path)return t.diagnostic("Actual Wails production asset not provisioned");
  const wails=await verifyWailsRuntime(path);
  const {app,observed}=quickPanelAdapter(new Map([["workspace.html",Buffer.from("test placeholder")]]),{
    locale:"en",surface:"overview",wails,
  });
  await once(app.listen(0,"127.0.0.1"),"listening");
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  const origin="http://127.0.0.1:"+app.address().port;
  const actual=await fetch(origin+"/wails/runtime.js");
  assert.equal(actual.status,200);
  assert.deepEqual(Buffer.from(await actual.arrayBuffer()),wails);
  assert.equal((await fetch(origin+"/wails/custom.js",{method:"HEAD"})).status,404);
  assert.equal((await fetch(origin+"/wails/runtime",{method:"POST"})).status,404);
  assert.equal(observed.denied,1);
});
