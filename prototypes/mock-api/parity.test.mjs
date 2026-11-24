import assert from "node:assert/strict";
import test from "node:test";
import {methods,schemas,validate} from "./contract-check.mjs";
import {harness,local,proofHeaders} from "./http-harness.mjs";

const scopes = ["grants:read","grants:revoke","stats:read","query-log:read","reviews:read","sync-conflicts:read"];
const grant = "00000000-0000-4000-8000-000000000001";
const cases = [
  ["GET /v1/health",200], ["GET /v1/status/light",200], ["GET /v1/memories",200],
  ["POST /v1/memories",201,{content:"Synthetic note",title:"Test",tags:["fixture"]}],
  ["GET /v1/memories/{memoryId}",200], ["PATCH /v1/memories/{memoryId}",200,{content:"Updated note",tags:[]}],
  ["DELETE /v1/memories/{memoryId}",204], ["POST /v1/memories/recall",200,{query:"research"}],
  ["GET /v1/diary",200], ["POST /v1/diary",200,{date:"2026-11-23",content:"Synthetic journal"}],
  ["POST /v1/organize/deepen/plan",200,{}], ["POST /v1/organize/deepen/apply",202,{plan_id:"plan-studio"}],
  ["POST /v1/organize/split",202,{memory_id:"note-1"}], ["GET /v1/organize/suggestions",200],
  ["GET /v1/models/catalog",200], ["GET /v1/models/active-assets",200],
  ["POST /v1/models/switch",202,{model_id:"archive-small"}], ["POST /v1/models/downloads",202,{model_id:"atlas-base"}],
  ["GET /v1/operations/{operationId}",200], ["DELETE /v1/operations/{operationId}",202],
  ["GET /v1/operations/{operationId}/events",200], ["GET /v1/spaces",200], ["POST /v1/spaces",201,{name:"New space"}],
  ["GET /v1/spaces/{spaceId}",200], ["PATCH /v1/spaces/{spaceId}",200,{name:"Renamed archive"}],
  ["DELETE /v1/spaces/{spaceId}",204], ["GET /v1/spaces/{spaceId}/members",200],
  ["POST /v1/spaces/{spaceId}/members",201,{identifier:"Fixture editor",role:"editor"}],
  ["GET /v1/sync/status",200], ["POST /v1/sync/trigger",202], ["GET /v1/host/account",200],
  ["POST /v1/host/transactions/login",200,{mode:"offline_keygen"}], ["POST /v1/host/transactions/logout",200],
  ["GET /v1/host/config",200], ["PATCH /v1/host/config",200,{language:"en",proxy_url:null}],
  ["GET /v1/backups/export",200], ["POST /v1/backups/import",202], ["GET /v1/grants",200],
  ["DELETE /v1/grants/{grantId}",204], ["GET /v1/stats",200], ["GET /v1/query-log",200],
  ["GET /v1/memories/{memoryId}/reviews",200], ["GET /v1/sync/conflicts",200],
  ["POST /v1/auth/handshake",200,{scopes}]
];
async function issueProof(h,scenario = "multi-account") {
  const response = await h.call("POST","/preview/owner-challenge?scenario="+scenario,{});
  assert.equal(response.status,200,response.text);
  assert.equal(response.headers["cache-control"],"no-store");
  return {"content-type":"application/json",...proofHeaders(response.json().challenge)};
}
function check(key,response) {
  const operation = methods.get(key);
  const mapping = operation.responses[response.status] ?? operation.responses.default;
  assert.ok(mapping,"Unmapped status " + response.status);
  assert.equal(response.headers["content-type"],mapping.media,key);
  if (!mapping.media) { assert.equal(response.bytes.length,0); return; }
  if (mapping.media === "application/octet-stream") { assert.ok(response.bytes.length > 0); return; }
  if (mapping.media === "text/event-stream") {
    for (const frame of response.text.trim().split("\n\n")) {
      const [event,data] = frame.split("\n");
      assert.match(event,/^event: /); assert.match(data,/^data: /);
      const typed = {event:event.slice(7),data:JSON.parse(data.slice(6))};
      validate(typed,mapping.schema);
      assert.equal(typed.event,typed.data.state === "running" ? "progress" : typed.data.state);
    }
  } else {
    const data = response.json();
    validate(data,mapping.schema);
    if (response.status >= 400) assert.equal(data.status,response.status);
  }
}
test("canonical parity is exactly 44 methods with no missing or extra templates",()=>{
  assert.equal(methods.size,44);
  assert.equal(cases.length,44);
  assert.deepEqual(cases.map(c=>c[0]).sort(),[...methods.keys()].sort());
  assert.throws(()=>validate({items:[{id:"bad"}]},schemas.AccessGrantListResponse));
  assert.throws(()=>validate({event:"unknown",data:{}},schemas.OperationEvent));
});
for (const [key,expected,input] of cases) test(key + " maps success and RFC Problem responses",async()=>{
  const h = harness(key.endsWith("/events") ? 2 : 60000);
  try {
    const [method,template] = key.split(" ");
    const path = template.replace("{memoryId}","note-1").replace("{spaceId}","archive").replace("{operationId}","op-1").replace("{grantId}",grant);
    const url = path + "?scenario=multi-account";
    let body = input, headers = local;
    if (template === "/v1/organize/deepen/apply") assert.equal((await h.call("POST","/v1/organize/deepen/plan?scenario=multi-account",{})).status,200);
    if (template.includes("{operationId}")) assert.equal((await h.call("POST","/v1/models/downloads?scenario=multi-account",{model_id:"atlas-base"})).status,202);
    if (template === "/v1/backups/import") {
      body = (await h.call("GET","/v1/backups/export?scenario=multi-account")).bytes;
      headers = {...local,"content-type":"application/octet-stream"};
    }
    if (methods.get(key).scope) {
      const owner = await h.call("POST","/v1/auth/handshake?scenario=multi-account",{scopes},await issueProof(h));
      assert.equal(owner.status,200);
      headers = {...local,authorization:"Bearer " + owner.json().access_token};
    }
    if (template === "/v1/auth/handshake") headers = await issueProof(h);
    if (methods.get(key).requestSchema && body !== undefined) validate(body,methods.get(key).requestSchema);
    const response = await h.call(method,url,body,headers);
    assert.equal(response.status,expected,response.text);
    check(key,response);
    if (template === "/v1/auth/handshake") assert.equal(response.headers["cache-control"],"no-store");
    const denied = await h.call(method,key === "GET /v1/health" ? path+"?scenario=unknown" : url,body,{"content-type":headers["content-type"]});
    assert.equal(denied.status,key === "GET /v1/health" ? 400 : 401,denied.text);
    check(key,denied);
    if (denied.status === 401) assert.equal(denied.headers["www-authenticate"],"Bearer");
  } finally { h.close(); }
});
test("typed SSE covers completed, rollback failure, cancellation, and terminal replay",async()=>{
  for (const [scenario,cancel,terminal] of [["rich-1k",false,"completed"],["switch-rollback-error",false,"failed"],["rich-1k",true,"cancelled"]]) {
    const h = harness();
    try {
      const op = (await h.call("POST","/v1/models/switch?scenario="+scenario,{model_id:"archive-small"})).json();
      const base = "/v1/operations/"+op.operation_id;
      if (cancel) await h.call("DELETE",base+"?scenario="+scenario);
      const response = await h.call("GET",base+"/events?scenario="+scenario);
      check("GET /v1/operations/{operationId}/events",response);
      const frames = response.text.trim().split("\n\n");
      const final = JSON.parse(frames.at(-1).split("\ndata: ")[1]);
      assert.equal(final.state,terminal);
      assert.deepEqual(final,(await h.call("GET",base+"?scenario="+scenario)).json());
      const replay = await h.call("GET",base+"/events?scenario="+scenario);
      assert.equal(replay.text,frames.at(-1)+"\n\n");
      if (terminal === "failed") assert.equal((await h.call("GET","/v1/models/catalog?scenario="+scenario)).json().active_model_id,"field-mini");
    } finally { h.close(); }
  }
});
test("media, JSON, missing resources and invalid input use contract ProblemDetails",async()=>{
  const h = harness();
  try {
    for (const [key,url,body,status,headers] of [
      ["POST /v1/backups/import","/v1/backups/import",{},415,local],
      ["POST /v1/backups/import","/v1/backups/import",Buffer.from("not an archive"),400,{...local,"content-type":"application/octet-stream"}],
      ["POST /v1/memories","/v1/memories",Buffer.from("{"),400,local],
      ["POST /v1/memories","/v1/memories",[],400,local],
      ["POST /v1/memories","/v1/memories",{},400,local],
      ["GET /v1/memories","/v1/memories?limit=201",undefined,400,local],
      ["GET /v1/memories/{memoryId}","/v1/memories/missing",undefined,404,local],
      ["GET /v1/spaces/{spaceId}/members","/v1/spaces/missing/members",undefined,404,local],
      ["GET /v1/operations/{operationId}/events","/v1/operations/missing/events",undefined,404,local],
      ["POST /v1/models/downloads","/v1/models/downloads",{model_id:"unknown"},400,local]
    ]) {
      const response = await h.call(key.split(" ")[0],url,body,headers);
      assert.equal(response.status,status,response.text); check(key,response);
    }
  } finally { h.close(); }
});
test("Recall and Diary enforce JSON types and Gregorian dates",async()=>{
  const h = harness();
  const recall = "/v1/memories/recall", diary = "/v1/diary";
  const search = {query:"field"}, entry = {content:"Leap day"};
  async function reject(method,url,body,code) {
    const response = await h.call(method,url,body);
    assert.equal(response.status,400,response.text);
    check(method+" "+url.split("?")[0],response);
    assert.equal(response.json().code,code);
  }
  try {
    for (const top_k of ["4",[4],null,true,4.5,0,101])
      await reject("POST",recall,{...search,top_k},"invalid_parameter");
    await reject("POST",recall,{query:2},"invalid_query");
    await reject("POST",recall,{...search,space_id:["studio"]},"invalid_parameter");
    for (const date of ["2026-02-29","1900-02-29","2026-04-31","2026-13-01","2026-01-00","2026-2-03",""]) {
      await reject("GET",diary+"?date="+date,undefined,"invalid_parameter");
      await reject("POST",diary,{...entry,date},"invalid_entry");
    }
    for (const date of [["2024-02-29"],null,20240229])
      await reject("POST",diary,{...entry,date},"invalid_entry");
    await reject("POST",diary,{date:"2024-02-29",content:42},"invalid_entry");
    assert.equal((await h.call("GET",diary)).json().entries.length,1);
    for (const [body,expected] of [[search,10],[{...search,top_k:4},4]]) {
      const found = await h.call("POST",recall,body);
      assert.equal(found.status,200,found.text);
      check("POST "+recall,found);
      assert.equal(found.json().hits.length,expected);
    }
    for (const date of ["0001-01-01","2000-02-29","2024-02-29"]) {
      const saved = await h.call("POST",diary,{...entry,date});
      assert.equal(saved.status,200,saved.text);
      check("POST "+diary,saved);
      const loaded = await h.call("GET",diary+"?date="+date);
      check("GET "+diary,loaded);
      assert.deepEqual(loaded.json().entries,[saved.json()]);
    }
  } finally { h.close(); }
});
test("preview challenges and leases stay within their scenario",async()=>{
  const h = harness();
  try {
    const issue = "/preview/owner-challenge", exchange = "/v1/auth/handshake", stats = "/v1/stats";
    assert.equal((await h.call("POST",issue,{},{"content-type":"application/json"})).status,401);
    assert.equal((await h.call("POST",issue+"?scenario=empty",{})).status,401);
    const multi = await issueProof(h), rich = await issueProof(h,"rich-1k");
    const wrong = await h.call("POST",exchange,{scopes},multi);
    assert.equal(wrong.status,401);
    check("POST "+exchange,wrong);
    const owner = await h.call("POST",exchange+"?scenario=multi-account",{scopes},multi);
    assert.equal(owner.status,200);
    assert.equal((await h.call("POST",exchange,{scopes},rich)).status,200);
    const auth = {authorization:"Bearer "+owner.json().access_token};
    assert.equal((await h.call("GET",stats,undefined,auth)).status,401);
    assert.equal((await h.call("GET",stats+"?scenario=multi-account",undefined,auth)).status,200);
  } finally { h.close(); }
});
