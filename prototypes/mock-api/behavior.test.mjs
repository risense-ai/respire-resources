import assert from "node:assert/strict";
import test from "node:test";
import "./fixture.js";
import {harness,local,proofHeaders} from "./http-harness.mjs";
import {validate,schemas} from "./contract-check.mjs";

const scopes = ["grants:read","grants:revoke","stats:read","query-log:read","reviews:read","sync-conflicts:read"];
const failure = status => e=>e.problem?.status === status;
const challenge = f => proofHeaders(f.request("POST","/preview/owner-challenge").data.challenge);
function owner(f,selected = scopes) {
  const {data} = f.request("POST","/v1/auth/handshake",{scopes:selected},challenge(f));
  return {authorization:"Bearer "+data.access_token};
}
function finish(f,op) {
  const frames = [1,2,3,4].map(()=>structuredClone(f.tick(op.operation_id)));
  assert.deepEqual(frames.map(s=>s.progress_percent),[25,50,75,100]);
  assert.equal(frames.at(-1).state,"completed");
  return frames;
}
test("all five scenarios replay CRUD, split, reviews, query aggregates and backup bytes",()=>{
  for (const name of globalThis.RespireFixture.scenarios) {
    function replay() {
      const f = globalThis.RespireFixture.create(name);
      const call = (method,path,body) => f.request(method,path,body).data;
      if (name === "empty") call("POST","/v1/host/transactions/login",{mode:"offline_keygen"});
      const auth = owner(f);
      const read = path=>f.request("GET",path,{},auth).data;
      const before = read("/v1/stats");
      const note = call("POST","/v1/memories",{content:"one two three four",title:"Fixture",tags:["synthetic"]});
      call("PATCH","/v1/memories/"+note.id,{title:"Changed",tags:[]});
      assert.equal(call("GET","/v1/memories/"+note.id).title,"Changed");
      assert.throws(()=>call("PATCH","/v1/memories/"+note.id,{content:12}),failure(400));
      const frames = finish(f,call("POST","/v1/organize/split",{memory_id:note.id}));
      const parts = call("GET","/v1/memories?limit=200").items;
      assert.equal(parts.find(m=>m.id === note.id).content,"one two");
      // The split child can fall outside the first page in the 1k fixture.
      const child = call("POST","/v1/memories/recall",{query:"three four"}).hits[0].memory;
      assert.equal(child.parent_id,note.id);
      const history = read("/v1/memories/"+note.id+"/reviews");
      assert.deepEqual(history.items.map(r=>r.action),["split","update","create"]);
      validate(history,schemas.MemoryReviewListResponse);
      call("POST","/v1/memories/recall",{query:"no-synthetic-match"});
      const log = read("/v1/query-log?limit=1");
      assert.equal(log.items.length,1); assert.equal(log.stats.total,2); assert.equal(log.stats.empty_candidates,1);
      validate(log,schemas.QueryLogResponse);
      const archive = call("GET","/v1/backups/export");
      assert.deepEqual(archive,call("GET","/v1/backups/export"));
      assert.equal(f.request("DELETE","/v1/memories/"+note.id).status,204);
      assert.throws(()=>call("GET","/v1/memories/"+note.id),failure(404));
      assert.equal(read("/v1/stats").local_total,before.local_total+2);
      assert.equal(read("/v1/stats").local_alive,before.local_alive+1);
      finish(f,call("POST","/v1/backups/import",archive));
      assert.equal(call("GET","/v1/memories/"+note.id).content,"one two");
      assert.throws(()=>call("POST","/v1/backups/import",new TextEncoder().encode("other data")),failure(400));
      return {auth,frames,history,log,archive};
    }
    assert.deepEqual(replay(),replay());
  }
});
test("spaces isolate notes, members, plans and grants; active switches revoke owner leases",()=>{
  const f = globalThis.RespireFixture.create("multi-account");
  const call = (method,path,body)=>f.request(method,path,body).data;
  const auth = owner(f);
  const space = call("POST","/v1/spaces",{name:"Synthetic third"});
  call("POST","/v1/spaces/"+space.id+"/members",{identifier:"Reviewer",role:"viewer"});
  assert.equal(call("GET","/v1/spaces/"+space.id+"/members").members.length,2);
  assert.equal(call("GET","/v1/spaces/studio/members").members.length,1);
  assert.throws(()=>call("POST","/v1/spaces/"+space.id+"/members",{identifier:"Reviewer",role:"viewer"}),failure(409));
  assert.throws(()=>call("GET","/v1/memories/note-2?space_id=studio"),failure(404));
  const note = call("POST","/v1/memories",{space_id:space.id,content:"isolated content"});
  assert.equal(call("GET","/v1/memories?space_id="+space.id).items.length,1);
  assert.throws(()=>f.request("GET","/v1/stats?space_id=archive",{},auth),failure(403));
  assert.throws(()=>call("POST","/v1/organize/deepen/apply",{plan_id:"plan-archive"}),failure(409));
  const plan = call("POST","/v1/organize/deepen/plan",{space_id:"archive"});
  finish(f,call("POST","/v1/organize/deepen/apply",{plan_id:plan.plan_id}));
  for (const move of plan.moves) assert.equal(call("GET","/v1/memories/"+move.memory_id+"?space_id=archive").parent_id,move.new_parent_id);
  assert.throws(()=>call("POST","/v1/organize/deepen/apply",{plan_id:plan.plan_id}),failure(409));
  call("PATCH","/v1/spaces/"+space.id,{name:"Renamed",active:true});
  assert.equal(call("GET","/v1/spaces/"+space.id).name,"Renamed");
  assert.throws(()=>f.request("GET","/v1/stats",{},auth),failure(401));
  assert.throws(()=>call("DELETE","/v1/spaces/"+space.id),failure(409));
  call("PATCH","/v1/spaces/studio",{active:true});
  call("DELETE","/v1/spaces/"+space.id);
  assert.throws(()=>call("GET","/v1/spaces/"+space.id),failure(404));
  assert.throws(()=>call("GET","/v1/memories/"+note.id),failure(404));
});
test("owner fixture rejects bearer substitution, replay, bad scopes, expiry and identity changes",()=>{
  const fresh = ()=>globalThis.RespireFixture.create("multi-account");
  const f = fresh();
  assert.throws(()=>f.request("POST","/v1/auth/handshake",{scopes}),failure(401));
  for (const invalid of [[],["stats:read","stats:read"],["private:key"],"stats:read"]) {
    const proof = challenge(f);
    assert.throws(()=>f.request("POST","/v1/auth/handshake",{scopes:invalid},proof),failure(400));
    assert.throws(()=>f.request("POST","/v1/auth/handshake",{scopes},proof),failure(401));
  }
  const proof = challenge(f);
  const second = challenge(f);
  assert.notDeepEqual(proof,second);
  f.request("POST","/v1/auth/handshake",{scopes},second);
  f.request("POST","/v1/auth/handshake",{scopes},proof);
  assert.throws(()=>f.request("POST","/v1/auth/handshake",{scopes},proof),failure(401));
  const expired = challenge(f);
  f.advanceTime(30);
  assert.throws(()=>f.request("POST","/v1/auth/handshake",{scopes},expired),failure(401));
  const auth = owner(f,["stats:read"]);
  assert.throws(()=>f.request("GET","/v1/grants",{},auth),failure(403));
  assert.throws(()=>f.request("GET","/v1/stats",{},{authorization:auth.authorization.slice(7)}),failure(401));
  assert.throws(()=>f.request("GET","/v1/stats"),failure(401));
  validate(f.request("GET","/v1/stats",{},auth).data,schemas.LibraryStatsResponse);
  f.advanceTime(300);
  assert.throws(()=>f.request("GET","/v1/stats",{},auth),failure(401));
  for (const [method,path,body] of [
    ["POST","/v1/host/transactions/logout",{}],["POST","/preview/account",{id:"archive"}],
    ["PATCH","/v1/spaces/archive",{active:true}],["POST","/v1/host/transactions/login",{mode:"offline_keygen"}]
  ]) {
    const other = fresh(), token = owner(other), pending = challenge(other);
    other.request(method,path,body);
    assert.throws(()=>other.request("GET","/v1/stats",{},token),failure(401));
    assert.throws(()=>other.request("POST","/v1/auth/handshake",{scopes},pending),failure(401));
    if (path.endsWith("logout")) assert.throws(()=>challenge(other),failure(401));
    else assert.equal(other.request("GET","/v1/stats",{},owner(other)).status,200);
  }
});
test("account profiles and owned spaces are independent",()=>{
  const f = globalThis.RespireFixture.create("multi-account");
  const call = (method,path,body)=>f.request(method,path,body).data;
  const accounts = ()=>call("GET","/preview/library").accounts;
  const identity = ()=>call("GET","/v1/host/account").account_id;
  const active = ()=>call("GET","/v1/health").active_space_id;
  const spaceIds = ()=>call("GET","/v1/spaces").spaces.map(s=>s.id);
  const created = call("POST","/v1/spaces",{name:"Private studio notebook"});
  assert.deepEqual(accounts(),["studio","archive"]);
  assert.deepEqual(spaceIds(),["studio","archive",created.id]);
  assert.throws(()=>call("POST","/preview/account",{id:created.id}),failure(404));
  call("PATCH","/v1/spaces/"+created.id,{active:true});
  assert.equal(identity(),"studio");
  assert.equal(active(),created.id);
  call("POST","/preview/account",{id:"archive"});
  assert.equal(identity(),"archive");
  assert.equal(active(),"archive");
  assert.deepEqual(spaceIds(),["studio","archive"]);
  assert.throws(()=>call("GET","/v1/memories?space_id="+created.id),failure(404));
  assert.throws(()=>call("PATCH","/v1/spaces/"+created.id,{active:true}),failure(404));
  call("PATCH","/v1/spaces/studio",{active:true});
  assert.equal(identity(),"archive");
  assert.equal(active(),"studio");
  call("POST","/preview/account",{id:"studio"});
  assert.equal(active(),created.id);
  call("POST","/preview/account",{id:"archive"});
  assert.equal(active(),"studio");
  assert.deepEqual(accounts(),["studio","archive"]);

  const empty = globalThis.RespireFixture.create("empty");
  assert.equal(empty.request("GET","/v1/health").data.active_space_id,"demo");
  const offline = empty.request("POST","/v1/spaces",{name:"Offline notebook"}).data;
  empty.request("PATCH","/v1/spaces/"+offline.id,{active:true});
  const note = empty.request("POST","/v1/memories",{content:"Offline fixture note"}).data;
  assert.equal(empty.request("GET","/v1/host/account").data.account_id,null);
  assert.throws(()=>empty.request("GET","/v1/spaces/studio"),failure(404));
  empty.request("POST","/v1/host/transactions/login",{mode:"offline_keygen"});
  assert.equal(empty.request("GET","/v1/host/account").data.account_id,"studio");
  assert.equal(empty.request("GET","/v1/health").data.active_space_id,"studio");
  assert.deepEqual(empty.request("GET","/preview/library").data.accounts,["studio"]);
  assert.throws(()=>empty.request("GET","/v1/memories/"+note.id+"?space_id="+offline.id),failure(404));
  empty.request("POST","/v1/host/transactions/logout");
  assert.equal(empty.request("GET","/v1/health").data.active_space_id,offline.id);
  assert.deepEqual(empty.request("GET","/v1/memories").data.items,[note]);
});
for (const transport of ["direct fixture","HTTP adapter"]) {
  test(`${transport} isolates signed-out guests and restores the Studio selection on login`,async t=>{
    const scenario = "multi-account";
    const http = transport === "HTTP adapter" ? harness(60000) : null;
    const fixture = http ? null : globalThis.RespireFixture.create(scenario);
    if (http) t.after(http.close);
    async function call(method,path,body,status = 200,headers = {}) {
      let response;
      if (http) {
        const binary = body instanceof Uint8Array;
        const input = binary ? Buffer.from(body) : body;
        const responseUrl = path + (path.includes("?") ? "&" : "?") + "scenario=" + scenario;
        const wire = await http.call(method,responseUrl,input,{...local,...headers,
          ...(binary ? {"content-type":"application/octet-stream"} : {})});
        response = {status:wire.status,data:wire.headers["content-type"] === "application/octet-stream" ? wire.bytes : wire.bytes.length ? wire.json() : undefined};
      } else {
        try { response = fixture.request(method,path,body,{...local,...headers}); }
        catch (error) {
          if (!error.problem) throw error;
          response = {status:error.problem.status,data:error.problem};
        }
      }
      assert.equal(response.status,status,`${method} ${path}`);
      return response.data;
    }
    const login = "/v1/host/transactions/login", logout = "/v1/host/transactions/logout", account = "/v1/host/account";
    const memories = "/v1/memories", diary = "/v1/diary", spaces = "/v1/spaces", stats = "/v1/stats";
    const backups = "/v1/backups/", switchAccount = "/preview/account", challengePath = "/preview/owner-challenge";
    const handshake = "/v1/auth/handshake", scope = {scopes:["stats:read"]};
    const issue = async()=>proofHeaders((await call("POST",challengePath,{})).challenge);
    const exchange = async proof=>({authorization:"Bearer " + (await call("POST",handshake,scope,200,proof)).access_token});
    const active = async()=>(await call("GET","/v1/health")).active_space_id;
    const privateSpace = await call("POST",spaces,{name:"Private Studio fixture"},201);
    const spacePath = spaces + "/" + privateSpace.id, query = "?space_id=" + privateSpace.id;
    await call("PATCH",spacePath,{active:true});
    assert.equal(await active(),privateSpace.id);
    const content = "synthetic private fixture marker";
    const note = await call("POST",memories,{content},201);
    const record = memories + "/" + note.id;
    const entry = await call("POST",diary,{date:"2026-11-23",content});
    const archive = await call("GET",backups+"export");
    const split = await call("POST","/v1/organize/split",{memory_id:note.id},202);
    const operation = "/v1/operations/" + split.operation_id;
    const studioAuth = await exchange(await issue());
    const studioProof = await issue();
    assert.equal((await call("GET",stats,undefined,200,studioAuth)).local_total,1);

    await call("POST",switchAccount,{id:"archive"});
    assert.equal((await call("GET",account)).account_id,"archive");
    assert.equal(await active(),"archive");
    await call("GET",record+query,undefined,404);
    const usedProof = await issue(), archiveAuth = await exchange(usedProof), pendingProof = await issue();
    await call("GET",stats,undefined,200,archiveAuth);
    await call("GET","/v1/grants",undefined,403,archiveAuth);
    await call("POST",handshake,scope,401,usedProof);
    await call("POST",logout);

    assert.deepEqual(await call("GET",account),{signed_in:false,account_id:null,transaction_state:"none"});
    assert.equal(await active(),undefined);
    assert.deepEqual(await call("GET",spaces),{spaces:[]});
    assert.deepEqual(await call("GET",memories),{items:[],next_cursor:null});
    assert.deepEqual(await call("GET",diary),{entries:[]});
    assert.deepEqual(await call("POST",memories+"/recall",{query:content}),{hits:[]});
    for (const [method,path,body] of [
      ["GET",record],["GET",record+query],["GET",memories+query],["GET",memories+"?space_id=studio"],
      ["POST",memories,{space_id:privateSpace.id,content}], ["PATCH",record,{content:"guest edit"}],
      ["PATCH",record+query,{content:"guest edit"}],["DELETE",record+query],
      ["GET",diary+query],["POST",diary,{space_id:privateSpace.id,date:entry.date,content:"guest entry"}],
      ["POST",memories+"/recall",{space_id:privateSpace.id,query:content}],
      ["GET",spacePath],["PATCH",spacePath,{active:true,name:"Guest rename"}],["DELETE",spacePath],
      ["GET",spacePath+"/members"],["POST",spacePath+"/members",{identifier:"Guest fixture",role:"viewer"}],
      ["GET",backups+"export"+query],["POST",backups+"import"+query,archive],["GET",operation],["DELETE",operation]
    ]) await call(method,path,body,404);
    if (http) await call("GET",operation+"/events",undefined,404);
    for (const [method,path,body] of [
      ["POST",memories,{content}],["POST",diary,{date:entry.date,content}],
      ["GET",backups+"export"],["POST",backups+"import",archive]
    ]) assert.equal((await call(method,path,body,409)).code,"no_active_space");
    assert.deepEqual((await call("GET","/preview/library")).operations,[]);
    assert.deepEqual(await call("GET","/v1/sync/status"),{state:"idle",pending_outbox:0,last_synced_at:null});
    await call("POST","/v1/sync/trigger",undefined,401);
    await call("POST",switchAccount,{id:"studio"},401);
    await call("POST",challengePath,{},401);
    await call("POST",handshake,scope,401,pendingProof);
    for (const auth of [{},studioAuth,archiveAuth]) await call("GET",stats,undefined,401,auth);

    const demo = await call("POST",spaces,{name:"Guest demo fixture"},201);
    assert.equal(await active(),demo.id);
    assert.deepEqual((await call("GET",spaces)).spaces.map(space=>space.id),[demo.id]);
    await call("POST",backups+"import",archive,400);
    await call("POST",login,{mode:"offline_keygen"});
    assert.deepEqual(await call("GET",account),{signed_in:true,account_id:"studio",transaction_state:"none"});
    assert.equal(await active(),privateSpace.id);
    assert.deepEqual(await call("GET",record),note);
    assert.deepEqual((await call("GET",memories)).items,[note]);
    assert.deepEqual((await call("GET",diary)).entries,[entry]);
    assert.equal((await call("GET",spacePath)).name,privateSpace.name);
    assert.equal((await call("GET",spacePath+"/members")).members.length,1);
    assert.equal((await call("DELETE",operation,undefined,202)).state,"cancelled");
    await call("GET",spaces+"/"+demo.id,undefined,404);
    await call("POST",handshake,scope,401,studioProof);
    await call("GET",stats,undefined,401,studioAuth);
    assert.equal((await call("GET",stats,undefined,200,await exchange(await issue()))).local_total,1);
    await call("POST",switchAccount,{id:"archive"});
    assert.equal(await active(),"archive");
    await call("GET",stats,undefined,401,archiveAuth);
  });
}
test("grant revocation retains metadata and conflicts retain exact decimal revisions",()=>{
  const f = globalThis.RespireFixture.create("multi-account"), auth = owner(f);
  const call = (method,path)=>f.request(method,path,{},auth);
  const grant = call("GET","/v1/grants").data.items[0];
  for (const id of [grant.id,grant.id,"00000000-0000-4000-8000-000000000099"])
    assert.equal(call("DELETE","/v1/grants/"+id).status,204);
  assert.equal(call("GET","/v1/grants").data.items[0].revoked,true);
  assert.equal(f.request("GET","/v1/status/light").data.memory_count,500);
  assert.throws(()=>call("DELETE","/v1/grants/0000"),failure(400));
  const pending = call("GET","/v1/sync/conflicts").data;
  assert.equal(pending.items[0].revision,"9007199254740993");
  assert.equal(pending.items.length,1);
  assert.equal(call("GET","/v1/sync/conflicts?include_processed=true").data.items.length,2);
  assert.equal(call("GET","/v1/sync/conflicts?memory_id=note-3").data.items.length,0);
  validate(pending,schemas.SyncConflictListResponse);
});
test("cancelled operations retain data and stale organize targets fail explicitly",()=>{
  const f = globalThis.RespireFixture.create("rich-1k");
  const call = (method,path,body)=>f.request(method,path,body).data;
  const before = structuredClone(call("GET","/v1/memories/note-1"));
  const split = call("POST","/v1/organize/split",{memory_id:"note-1"});
  call("DELETE","/v1/operations/"+split.operation_id);
  assert.equal(f.tick(split.operation_id).state,"cancelled");
  assert.deepEqual(call("GET","/v1/memories/note-1"),before);
  const plan = call("POST","/v1/organize/deepen/plan",{});
  const apply = call("POST","/v1/organize/deepen/apply",{plan_id:plan.plan_id});
  call("DELETE","/v1/memories/"+plan.moves[0].memory_id);
  const final = [1,2,3,4].map(()=>f.tick(apply.operation_id)).at(-1);
  assert.equal(final.state,"failed"); assert.equal(final.error.code,"stale_plan");
  for (const [mode,state] of [["browser_oauth","login_pending"],["recovery","recovery_pending"]]) {
    call("POST","/v1/host/transactions/login",{mode});
    assert.equal(call("GET","/v1/host/account").transaction_state,state);
  }
  const sync = call("POST","/v1/sync/trigger");
  assert.equal(call("GET","/v1/sync/status").state,"syncing");
  finish(f,sync); assert.equal(call("GET","/v1/sync/status").state,"idle");
});

test("HTTP byte export and restore change synthetic state after asynchronous completion",async()=>{
  const h = harness();
  try {
    const original = (await h.call("GET","/v1/memories/note-1")).json();
    const archive = await h.call("GET","/v1/backups/export");
    assert.equal(archive.headers["content-type"],"application/octet-stream");
    await h.call("PATCH","/v1/memories/note-1",{content:"changed"});
    const op = await h.call("POST","/v1/backups/import",archive.bytes,{...local,"content-type":"application/octet-stream"});
    assert.equal(op.status,202);
    await h.call("GET","/v1/operations/"+op.json().operation_id+"/events");
    assert.deepEqual((await h.call("GET","/v1/memories/note-1")).json(),original);
    assert.equal((await h.call("POST","/v1/host/transactions/login?scenario=empty",{mode:"offline_keygen"})).status,200);
    const foreign = await h.call("POST","/v1/backups/import?scenario=empty",archive.bytes,{...local,"content-type":"application/octet-stream"});
    assert.equal(foreign.status,400);
  } finally { h.close(); }
});
