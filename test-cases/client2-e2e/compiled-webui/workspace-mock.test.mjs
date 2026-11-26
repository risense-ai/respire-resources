import assert from "node:assert/strict";
import {once} from "node:events";
import {test} from "node:test";
import {quickPanelAdapter} from "./quick-panel-adapter.mjs";
import {marker,needle,verifyWailsRuntime,workspaceMock} from "./workspace-mock.mjs";

const id="desktop-00000000-0000-0000-0000-000000000000";
let sequence=0;
const nextID=()=>id.slice(0,-8)+String(++sequence).padStart(8,"0");
const exec=(domain,name,args,operation=nextID())=>domain.execute({name,args,id:operation,confirmed:true,secret:""});

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


test("acks consume only known terminal read IDs, once, without weakening route guarantees",async t=>{
  const {app,receipts,deniedRequests}=quickPanelAdapter(new Map(),{locale:"en",surface:"overview",wails:Buffer.alloc(0)});
  await once(app.listen(0,"127.0.0.1"),"listening");
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  const origin="http://127.0.0.1:"+app.address().port;
  const post=(path,body,source=origin)=>fetch(origin+path,{
    method:"POST",headers:{Origin:source,"X-Respire-Client":"1","Content-Type":"application/json"},
    body:JSON.stringify(body),
  });
  assert.equal((await post("/api/operation-ack",{id})).status,400);
  const operation={id,name:"query_log",args:{stats:true,limit:1},confirmed:true,secret:""};
  const launched=await post("/api/execute",operation);
  assert.equal(launched.status,200);
  assert.equal((await launched.json()).result.id,id);
  assert.deepEqual(receipts(),{issued:1,acknowledged:0,pending:1});
  assert.equal((await post("/api/operation-ack",{id},"https://example.invalid")).status,403);
  assert.equal((await post("/api/operation-ack",{id,unexpected:true})).status,400);
  assert.equal((await post("/api/operation-ack",{id})).status,200);
  assert.deepEqual(receipts(),{issued:1,acknowledged:1,pending:0});
  assert.equal((await post("/api/operation-ack",{id})).status,400);
  assert.equal((await post("/api/execute",operation)).status,400);
  assert.equal((await post("/api/reserved-private-marker?private=value",{})).status,400);
  assert.deepEqual(deniedRequests,["POST:operation-ack:400","POST:operation-ack:403",
    "POST:operation-ack:400","POST:operation-ack:400","POST:execute:400","POST:other:400"]);
});

test("Diary's genuine typed data matches only explicit calendar range and startup day",()=>{
  const diary=workspaceMock("diary");
  const {details}=exec(diary,"diary_list",{from:"2026-11-01",to:"2026-11-30"}).envelope;
  assert.equal(details.length,1);
  assert.deepEqual(details[0],{id:"day-2026-11-23",day:"2026-11-23",title:"CARD018 synthetic journal",
    content:"CARD018 synthetic journal",created_at:"2026-11-23T09:30:00Z"});
  assert.equal(exec(diary,"diary_list",{from:"2026-11-23",to:"2026-11-23"}).envelope.details.length,1);
  assert.throws(()=>exec(diary,"diary_list",{from:"2026-11-01",to:"2026-12-01"}));
  assert.throws(()=>exec(diary,"diary_list",{from:"2026-11-01",to:"2026-11-01"}));
  assert.throws(()=>exec(workspaceMock("overview"),"diary_list",{from:"2026-11-01",to:"2026-11-30"}));
  assert.throws(()=>exec(diary,"diary_search",{query:"not authorized"}));
});

test("Accounts keeps the host profile distinct from typed Mock spaces and rejects changes",()=>{
  const account=workspaceMock("accounts");
  assert.deepEqual(exec(account,"account_list",{}).envelope.summary.accounts.map(item=>[item.name,item.current]),
    [["CARD018 local account",true]]);
  assert.deepEqual(exec(account,"space_list",{}).envelope.summary.spaces.filter(item=>item.current).map(item=>item.name),
    ["Studio notebook"]);
  assert.throws(()=>exec(account,"account_list",{other:true}));
  assert.throws(()=>exec(account,"account_use",{name:"other"}));
  assert.throws(()=>exec(workspaceMock("overview"),"space_list",{}));
});

test("Storage/Settings bootstrap ready Overview then allow only a loaded read-only settings witness",()=>{
  for(const surface of ["storage","settings"]){
    const settings=workspaceMock(surface);
    assert(settings.overviewBootstrap&&settings.settings);
    assert.equal(typeof exec(settings,"query_log",{stats:true,limit:1}).envelope.details.total,"number");
    assert.deepEqual(exec(settings,"agent_config",{}).envelope.summary,{workspace_mode:"readonly",diary_mode:"verbose"});
    assert.throws(()=>exec(settings,"agent_set",{setting:"workspace_mode=normal"}));
    assert.throws(()=>exec(settings,"data_dir_set",{dir:"/somewhere-else"}));
  }
  assert.throws(()=>exec(workspaceMock("overview"),"agent_config",{}));
});

test("Grants and Members use real typed Mock reads and accept no mutations",()=>{
  const grants=workspaceMock("grants");
  assert.deepEqual(exec(grants,"grant_list",{}).envelope.details.map(x=>[x.label,x.revoked]),[["Research reader",false]]);
  assert.throws(()=>exec(grants,"grant_list",{unexpected:true}));
  assert.throws(()=>exec(grants,"grant_revoke",{id:"not accepted"}));
  assert.throws(()=>exec(workspaceMock("overview"),"grant_list",{}));
  const members=workspaceMock("space-members");
  assert.equal(exec(members,"space_members",{}).envelope.details[0].device_name,"Robin Lee");
  assert.equal(exec(members,"space_list",{}).envelope.summary.spaces[0].current,true);
  assert.throws(()=>exec(members,"space_kick",{session:"not accepted"}));
  assert.throws(()=>exec(workspaceMock("accounts"),"space_members",{}));
});

test("Injection presents one explicit synthetic host read but no write endpoint",async t=>{
  const {app,operations}=quickPanelAdapter(new Map(),{locale:"en",surface:"injection",wails:Buffer.alloc(0)});
  await once(app.listen(0,"127.0.0.1"),"listening");
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  const origin="http://127.0.0.1:"+app.address().port;
  const loaded=await (await fetch(origin+"/api/inject-targets")).json();
  assert.equal(loaded.result.mode,"readonly");
  assert.equal(loaded.result.targets[0].name,"CARD018 synthetic agent");
  assert(operations.has("inject_targets"));
  assert.equal((await fetch(origin+"/api/inject-set",{method:"POST",headers:{
    Origin:origin,"X-Respire-Client":"1","Content-Type":"application/json",
  },body:'{"enable":true}'})).status,404);
});

test("Stats maps a real synthetic Recall log into a positive local daily row",()=>{
  const stats=workspaceMock("stats");
  const {details}=exec(stats,"query_log",{stats:true,limit:1}).envelope;
  assert.equal(details.total,1);
  assert.deepEqual(details.daily,[{day:"2026-11-23",recalls:1,hits:1,adopted:0,good:0}]);
  assert.throws(()=>exec(stats,"query_log",{stats:false,limit:1}));
});

test("Wizard startup, Organize and Session Import allow only explicit fixture reads",async t=>{
  const org=workspaceMock("organize");
  assert.deepEqual(exec(org,"classification_config",{}).envelope.summary,{backend:"jev",has_key:false});
  assert.throws(()=>exec(org,"classification_save",{key:"not permitted"}));
  const sessions=workspaceMock("session-import");
  const {details}=exec(sessions,"session_import_targets",{}).envelope;
  assert.equal(details[0].installed,true);
  assert.equal(details[0].roots.length,1);
  assert.throws(()=>exec(sessions,"session_import_apply",{}));
  const {app}=quickPanelAdapter(new Map(),{locale:"zh",surface:"wizard",wails:Buffer.alloc(0)});
  await once(app.listen(0,"127.0.0.1"),"listening");
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  const origin="http://127.0.0.1:"+app.address().port;
  const state=(await (await fetch(origin+"/api/state")).json()).result;
  assert.deepEqual(state.preferences,{language:"zh",onboardingCompleted:false,onboardingStep:"sync"});
  const status=(await (await fetch(origin+"/api/runtime-status")).json()).result;
  assert.equal(status.summary.session.has_token,false);
  assert.equal((await fetch(origin+"/api/preferences",{method:"POST",headers:{
    Origin:origin,"X-Respire-Client":"1","Content-Type":"application/json",
  },body:'{"onboardingCompleted":true}'})).status,404);
});

test("Models receives only its exact synthetic product-shaped local catalog and loaded engine",async t=>{
  const {app,operations}=quickPanelAdapter(new Map(),{locale:"en",surface:"models",wails:Buffer.alloc(0)});
  await once(app.listen(0,"127.0.0.1"),"listening");
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  const origin="http://127.0.0.1:"+app.address().port;
  const get=path=>fetch(origin+path);
  const {result}=await (await get("/api/model-variants?model=m3")).json();
  assert.equal(result.model,"m3");
  assert.deepEqual(result.variants.map(x=>[x.name,x.installed]),[["quantized",true]]);
  assert(operations.has("model_variants"));
  assert.equal((await get("/api/model-variants?model=m3&extra=true")).status,400);
  assert.equal((await get("/api/model-variants?model=unknown")).status,400);
  assert.equal((await (await get("/api/model-profile-state")).json()).result.catalog.details.active.model,"m3");
  const model=workspaceMock("models");
  assert.deepEqual(exec(model,"model_engine",{}).envelope.summary,{engine:"cpu",model:"quantized"});
  assert.throws(()=>exec(model,"model_switch",{engine:"gpu"}));
});
