import assert from "node:assert/strict";
import {EventEmitter, once} from "node:events";
import {Readable} from "node:stream";
import {readdir} from "node:fs/promises";
import test from "node:test";
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
