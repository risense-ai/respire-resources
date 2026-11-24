import assert from "node:assert/strict";
import test from "node:test";
import "./fixture.js";
import {harness,local} from "./http-harness.mjs";
import {validate,schemas} from "./contract-check.mjs";

const scopes = ["grants:read","grants:revoke","stats:read","query-log:read","reviews:read","sync-conflicts:read"];
const proof = {"x-respire-handshake-proof":"synthetic-owner-proof-only"};
const failure = status => e=>e.problem?.status === status;
function owner(f,selected = scopes) {
  const {data} = f.request("POST","/v1/auth/handshake",{scopes:selected},proof);
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
      return {frames,history,log,archive};
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
  const fresh = ()=>globalThis.RespireFixture.create("rich-1k");
  const f = fresh();
  assert.throws(()=>f.request("POST","/v1/auth/handshake",{scopes}),failure(401));
  for (const invalid of [[],["stats:read","stats:read"],["private:key"]])
    assert.throws(()=>f.request("POST","/v1/auth/handshake",{scopes:invalid},proof),failure(400));
  const auth = owner(f,["stats:read"]);
  assert.throws(()=>owner(f),failure(401));
  assert.throws(()=>f.request("GET","/v1/grants",{},auth),failure(403));
  assert.throws(()=>f.request("GET","/v1/stats"),failure(401));
  validate(f.request("GET","/v1/stats",{},auth).data,schemas.LibraryStatsResponse);
  f.advanceTime(300);
  assert.throws(()=>f.request("GET","/v1/stats",{},auth),failure(401));
  for (const [path,body] of [["/v1/host/transactions/logout",{}],["/preview/account",{id:"studio"}]]) {
    const other = fresh(), token = owner(other);
    other.request("POST",path,body);
    assert.throws(()=>other.request("GET","/v1/stats",{},token),failure(401));
  }
});
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
    const foreign = await h.call("POST","/v1/backups/import?scenario=empty",archive.bytes,{...local,"content-type":"application/octet-stream"});
    assert.equal(foreign.status,400);
  } finally { h.close(); }
});
