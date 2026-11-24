import assert from "node:assert/strict";
import {EventEmitter, once} from "node:events";
import {Readable} from "node:stream";
import {readdir} from "node:fs/promises";
import test from "node:test";
import {harness,local} from "./http-harness.mjs";
import {server} from "./server.mjs";

test("16 exact offline entry filenames",async()=>{
  const files = await readdir(new URL("../pages/",import.meta.url));
  assert.deepEqual(files.filter(p=>p.endsWith(".html")).sort(),[
    "accounts","diary","grants","injection","models","organize","overview","quickpanel","recall","session-import",
    "settings","space-members","stats","storage","wizard","workspace"
  ].map(p=>p+".html"));
});
test("all five seeds replay identically, including cancellation and rollback",()=>{
  const expected = {"empty":0,"rich-1k":1000,"downloading-sse":1000,"switch-rollback-error":1000,"multi-account":500};
  for (const [name,count] of Object.entries(expected)) {
    function replay() {
      const f = globalThis.RespireFixture.create(name);
      const read = path => f.request("GET",path).data;
      assert.equal(read("/v1/status/light").memory_count,count);
      if (name === "downloading-sse") {
        assert.equal(f.tick("op-1").progress_percent,25);
        assert.equal(f.request("DELETE","/v1/operations/op-1").status,202);
        assert.equal(f.tick("op-1").state,"cancelled");
      }
      const before = read("/v1/models/catalog").active_model_id;
      const {data,status} = f.request("POST","/v1/models/switch",{model_id:"archive-small",engine:"cpu"});
      assert.equal(status,202);
      const frames = [1,2,3,4].map(()=>f.tick(data.operation_id));
      assert.deepEqual(frames.map(s=>s.progress_percent),[25,50,75,100]);
      const rollback = name === "switch-rollback-error";
      assert.equal(frames[3].state,rollback ? "failed" : "completed");
      assert.equal(read("/v1/models/catalog").active_model_id,rollback ? before : "archive-small");
      assert.throws(()=>f.request("POST","/v1/models/switch",{model_id:"unknown"}),e=>e.problem.status === 400);
      return [read("/v1/health"),read("/v1/memories?limit=12"),read("/v1/host/account"),frames];
    }
    assert.deepEqual(replay(),replay());
  }
});
test("HTTP adapter routes and SSE framing in process",async()=>{
  const app = server({interval:2});
  const host = "127.0.0.1:4173";
  app.address = ()=>({port:4173});
  async function dispatch(method,url,body,headers = {}) {
    const req = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []),{
      method,url,headers:{host,...headers}
    });
    const res = new EventEmitter();
    const fields = {};
    const chunks = [];
    res.setHeader = (key,value)=>{fields[key] = value;};
    res.writeHead = (status,extra)=>{res.status = status; Object.assign(fields,extra); return res;};
    res.write = data=>chunks.push(String(data));
    res.end = data=>{if (data) res.write(data); res.emit("close");};
    const ended = once(res,"close");
    app.emit("request",req,res);
    await ended;
    return {status:res.status,fields,text:chunks.join("")};
  }
  try {
    const auth = {authorization:"Bearer synthetic-preview-only","content-type":"application/json"};
    assert.equal((await dispatch("GET","/v1/health")).status,200);
    assert.equal((await dispatch("GET","/preview/library")).status,401);
    assert.equal((await dispatch("GET","/v1/health",null,{origin:"null"})).status,403);
    for (const file of (await readdir(new URL("../pages/",import.meta.url))).filter(f=>f.endsWith(".html"))) {
      const response = await dispatch("GET","/pages/"+file);
      assert.equal(response.status,200);
      assert.match(response.text,/src="screens.js"/);
    }
    const start = await dispatch("POST","/v1/models/switch?scenario=switch-rollback-error",{model_id:"archive-small"},auth);
    assert.equal(start.status,202);
    const id = JSON.parse(start.text).operation_id;
    const events = await dispatch("GET","/v1/operations/"+id+"/events?scenario=switch-rollback-error",null,auth);
    assert.equal(events.fields["Content-Type"],"text/event-stream");
    assert.match(events.text,/event: progress/);
    assert.match(events.text,/event: failed/);
    const end = JSON.parse(events.text.trim().split("\ndata: ").at(-1));
    assert.equal(end.state,"failed");
    assert.equal(end.error.code,"model_switch_rollback");
  } finally { app.emit("close"); }
});
test("direct operation channels expire when the preview scope changes",()=>{
  const fixture = globalThis.RespireFixture.create("multi-account");
  const request = (method,path,body,headers)=>fixture.request(method,path,body,headers).data;
  const privateSpace = request("POST","/v1/spaces",{name:"Synthetic private notebook"});
  request("PATCH","/v1/spaces/"+privateSpace.id,{active:true});
  const note = request("POST","/v1/memories",{content:"Synthetic split note"});
  const {operation_id:id} = request("POST","/v1/organize/split",{memory_id:note.id});
  const before = fixture.operationChannel(id,local);
  assert.equal(before.canRead(),true);
  request("POST","/preview/account",{id:"archive"});
  assert.equal(before.signal.aborted,true);
  assert.equal(before.canRead(),false);
  const absent = error=>error.problem.status === 404;
  assert.throws(()=>fixture.operationChannel(id,local),absent);
  assert.throws(()=>request("GET","/v1/operations/"+id),absent);
  request("POST","/preview/account",{id:"studio"});
  assert.equal(before.canRead(),false);
  assert.equal(fixture.operationChannel(id,local).canRead(),true);
  assert.throws(()=>fixture.operationChannel(id,{...local,authorization:"invalid-preview-bearer"}),error=>error.problem.status === 401);
  const sync = request("POST","/v1/sync/trigger").operation_id;
  request("POST","/preview/account",{id:"archive"});
  assert.throws(()=>fixture.operationChannel(sync,local),absent);
  for (let i=0;i<4;i++) fixture.tick(sync);
  assert.equal(request("GET","/v1/sync/status").pending_outbox,4);
  request("POST","/preview/account",{id:"studio"});
  assert.equal(request("GET","/v1/sync/status").pending_outbox,0);
});

test("HTTP adapter closes open SSE immediately at logout, profile switch and active space change",async t=>{
  t.mock.timers.enable({apis:["setInterval"]});
  const cleared = t.mock.method(globalThis,"clearInterval");
  const h = harness(10);
  const call = (method,path,body,headers)=>h.call(method,path+"?scenario=multi-account",body,headers);
  const operation = id => "/v1/operations/"+id;
  const tick = (n=1)=>{for (let i=0;i<n;i++) t.mock.timers.tick(10);};
  const scope = async()=>String((await call("GET","/preview/scope")).json().generation);
  async function privateSplit() {
    const space = (await call("POST","/v1/spaces",{name:"Synthetic private notebook"})).json();
    assert.equal((await call("PATCH","/v1/spaces/"+space.id,{active:true})).status,200);
    const note = (await call("POST","/v1/memories",{content:"Synthetic split note"})).json();
    const op = await call("POST","/v1/organize/split",{memory_id:note.id});
    assert.equal(op.status,202,op.text);
    return {path:operation(op.json().operation_id),space};
  }
  try {
    for (const change of ["logout","profile","space"]) {
      const {path,space} = await privateSplit();
      const generation = await scope();
      const pending = [call("GET",path+"/events"),call("GET",path+"/events")];
      tick();
      const status = await (change === "logout" ? call("POST","/v1/host/transactions/logout")
        : change === "profile" ? call("POST","/preview/account",{id:"archive"})
          : call("PATCH","/v1/spaces/studio",{active:true}));
      assert.equal(status.status,200,status.text);
      // Require the streams to end without advancing the scheduler.
      const ended = await Promise.race([Promise.all(pending),new Promise(resolve=>setImmediate(()=>resolve(null)))]);
      assert.ok(ended,"Scope mutation left an SSE response open");
      for (const stream of ended) {
        assert.equal(stream.status,200);
        assert.deepEqual([...stream.text.matchAll(/"progress_percent":(\d+)/g)].map(match=>+match[1]),[0,25]);
        assert.doesNotMatch(stream.text,/event: (completed|failed|cancelled)/);
      }
      const count = cleared.mock.callCount();
      tick(4);
      assert.equal(cleared.mock.callCount(),count+1);
      for (const suffix of ["","/events"]) {
        assert.equal((await call("GET",path+suffix,undefined,{...local,"x-preview-scope":generation})).status,409);
        if (change !== "space") assert.equal((await call("GET",path+suffix)).status,404);
      }
      if (change === "logout") await call("POST","/v1/host/transactions/login",{mode:"offline_keygen"});
      if (change === "profile") await call("POST","/preview/account",{id:"studio"});
      if (change === "space") await call("PATCH","/v1/spaces/"+space.id,{active:true});
      const replay = await call("GET",path+"/events");
      assert.equal((await call("GET",path)).json().state,"completed");
      assert.match(replay.text,/^event: completed\n/);
    }
    const {path} = await privateSplit();
    const cancelled = call("GET",path+"/events");
    assert.equal((await call("DELETE",path)).status,202);
    const count = cleared.mock.callCount();
    tick();
    assert.match((await cancelled).text,/event: cancelled/);
    assert.equal(cleared.mock.callCount(),count+1);
    const next = await privateSplit();
    const completed = call("GET",next.path+"/events");
    tick(4);
    assert.match((await completed).text,/event: completed/);
    assert.equal(cleared.mock.callCount(),count+2);
    tick(4);
    assert.equal(cleared.mock.callCount(),count+2);

    // Deleting an inactive destination changes its ACL without changing the active scope.
    const removed = await privateSplit();
    assert.equal((await call("PATCH","/v1/spaces/studio",{active:true})).status,200);
    const unchanged = await scope();
    const revoked = call("GET",removed.path+"/events");
    assert.equal((await call("DELETE","/v1/spaces/"+removed.space.id)).status,204);
    assert.equal(await scope(),unchanged);
    tick();
    const closed = await Promise.race([revoked,new Promise(resolve=>setImmediate(()=>resolve(null)))]);
    assert.ok(closed,"Fanout did not close a response whose operation became inaccessible");
    assert.match(closed.text,/"progress_percent":0/);
    assert.doesNotMatch(closed.text,/"progress_percent":25|event: failed/);
    assert.equal((await call("GET",removed.path+"/events")).status,404);
    tick(3);
    assert.equal(cleared.mock.callCount(),count+3);
  } finally { h.close(); }
});

test("deterministic loopback walkthroughs",async t=>{
  const app = server({interval:25}).listen(0,"127.0.0.1");
  await once(app,"listening");
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  const base = "http://127.0.0.1:"+app.address().port;
  const token = {Authorization:"Bearer synthetic-preview-only"};
  const call = (path,scenario="rich-1k",method="GET",body)=>fetch(base+path,{
    method,headers:{...token,"X-Mock-Scenario":scenario,"Content-Type":"application/json"},body:JSON.stringify(body)
  });
  assert.equal((await fetch(base+"/v1/health")).status,200);
  assert.equal((await fetch(base+"/v1/models/catalog")).status,401);
  assert.equal((await fetch(base+"/v1/health",{headers:{Origin:"https://invalid.example"}})).status,403);
  assert.equal((await call("/v1/health","unknown")).status,400);
  assert.equal((await (await call("/v1/status/light?scenario=empty")).json()).memory_count,0);
  assert.equal((await (await call("/v1/status/light")).json()).memory_count,1000);
  assert.equal((await (await call("/v1/spaces","multi-account")).json()).spaces.length,2);
  const first = await (await call("/v1/memories?limit=2")).json();
  assert.deepEqual(first,await (await call("/v1/memories?limit=2")).json());
  assert.equal(first.next_cursor,"2");
  assert.equal((await call("/v1/memories?limit=201")).status,400);
  const scenario = "downloading-sse";
  assert.equal((await call("/v1/models/downloads",scenario,"POST",{model_id:"atlas-base"})).status,409);
  const pending = await call("/v1/operations/op-1/events",scenario);
  const cancelled = await call("/v1/operations/op-1",scenario,"DELETE");
  assert.equal(cancelled.status,202);
  assert.equal((await cancelled.json()).state,"cancelled");
  assert.match(await pending.text(),/event: cancelled/);
  for (const [seed,action,target,expected] of [
    ["rich-1k","downloads","atlas-base","completed"],
    ["rich-1k","switch","atlas-base","completed"],
    ["switch-rollback-error","switch","archive-small","failed"]
  ]) {
    const start = await call("/v1/models/"+action,seed,"POST",{model_id:target,engine:"cpu"});
    assert.equal(start.status,202);
    const {operation_id,status} = await start.json();
    assert.equal(status,"running");
    const before = await (await call("/v1/models/catalog",seed)).json();
    const response = await call("/v1/operations/"+operation_id+"/events",seed);
    assert.match(response.headers.get("content-type"),/^text\/event-stream/);
    const frames = (await response.text()).trim().split("\n\n");
    const states = frames.map(frame=>JSON.parse(frame.split("\ndata: ")[1]));
    assert.equal(states.at(-1).state,expected);
    assert.equal(states.at(-1).progress_percent,100);
    assert.deepEqual(states.at(-1),await (await call("/v1/operations/"+operation_id,seed)).json());
    const after = await (await call("/v1/models/catalog",seed)).json();
    if (expected === "failed") {
      assert.deepEqual(after,before);
      assert.equal(states.at(-1).error.status,409);
    } else if (action === "switch") assert.equal(after.active_model_id,target);
  }
  assert.equal((await call("/preview/uninstall","rich-1k","POST",{model_id:"atlas-base"})).status,409);
  assert.equal((await call("/preview/uninstall","rich-1k","POST",{model_id:"archive-small"})).status,200);
  assert.equal((await call("/v1/models/switch","rich-1k","POST",{model_id:"field-mini",engine:"gpu"})).status,400);
  const invalid = await call("/v1/models/downloads","rich-1k","POST",{});
  assert.equal(invalid.headers.get("content-type"),"application/problem+json");
  assert.equal((await invalid.json()).code,"invalid_model");
});
