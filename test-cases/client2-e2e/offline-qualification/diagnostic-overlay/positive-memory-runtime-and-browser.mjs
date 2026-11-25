import {diag,relayBrowserMarkers} from './card018-safe-diagnostic.mjs';
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createReadStream} from "node:fs";
import {lstat, readFile, realpath, readdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {isAbsolute, join} from "node:path";
import {withRuntime} from "../targets.mjs";
import {hostedRunPins} from "./compiled-ui-run-pins.mjs";
import {withPositiveMemoryApp} from "./positive-memory-proof-launcher.mjs";

const [binary,desktopBinary,receipt] = process.argv.slice(2);
const title = "CARD018 Ada compass witness";
const content = "A synthetic polar compass witness for isolated desktop acceptance.";
const query = "polar compass witness";
let owned;
let stage = "hosted-only positive fixture guard";
try {
  assert(process.env.RUNNER_ENVIRONMENT==="github-hosted" && process.env.GITHUB_ACTIONS==="true" &&
    process.env.CARD018_POSITIVE_ONLY==="1");
  stage = "exact hosted build receipt";
  const {digest, desktopDigest, chromium, playwrightCore}=await hostedRunPins(receipt,binary,desktopBinary);
  assert(process.platform === "win32" && process.arch === "x64" && isAbsolute(binary));
  assert((await lstat(binary)).isFile());
  const hash = createHash("sha256");
  for await (const part of createReadStream(await realpath(binary))) hash.update(part);
  assert.equal(hash.digest("hex"), digest);
  stage = "isolated owned Runtime startup";
  // The stock isolated runner inherits PATH, so do not pass an installed tool or user bin.
  process.env.PATH = join(process.env.SystemRoot || process.env.WINDIR, "System32");
  await withRuntime(binary, {syntheticReady:true}, async ({target, env, ownedRoot}) => {
    owned = ownedRoot;
    const json = async (method,path,status,body) => {
      const response = await target.request({method,path,...(body ? {body} : {})});
      assert.equal(response.status,status);
      assert.equal(response.media,"application/json");
      return response.data;
    };
    const endpoint = JSON.parse(await readFile(join(env.RSRS_DATA_DIR,"runtime","endpoint.json"),"utf8"));
    const session = JSON.parse(await readFile(join(env.RSRS_DATA_DIR,"session.json"),"utf8"));
    assert.equal(session.user,"runtime-smoke");
    assert(!session.addr && !env.RSRS_ADDR && !env.RSRS_TOKEN && env.RSRS_NO_AUTOSYNC==="1");
    assert.equal(env.HOME, owned);
    assert.equal(env.RSRS_M3_DIR,join(owned,"empty-models"));
    assert.deepEqual(await readdir(env.RSRS_M3_DIR),[]);
    assert(Number.isSafeInteger(endpoint.pid) && endpoint.pid>0 && typeof endpoint.instance_id==="string");
    const ready = async () => {
      const info=await json("GET","/v1/health",200);
      assert.equal(info.instance_id,endpoint.instance_id);
      assert.equal(info.status,"ready");
    };
    let scope;
    const legacy = async (command,args=[]) => {
      const id="positive-card018-"+randomUUID();
      const reply = await json("POST","/rpc",200,{v:1,id,method:"cli.exec",args:[command,...args,"--json"],
        operation_id:id,idempotency_key:id});
      assert.equal(reply.id,id);
      assert.equal(reply.operation_id,id);
      assert.equal(reply.pid,endpoint.pid);
      assert.equal(reply.ok,true);
      assert.equal(reply.exit,0);
      assert.equal(reply.envelope.status,"ok");
      const actual=reply.scope;
      assert.equal(actual.instance_id,endpoint.instance_id);
      assert(typeof actual.account_id==="string" && actual.account_id.length>0);
      assert(Number.isSafeInteger(actual.generation)&&actual.generation>0);
      if(!scope) scope=actual;
      else assert.deepEqual(actual,scope);
      return reply.envelope;
    };
    stage = "independent empty and strictly offline preflight";
    await ready();
    assert.equal((await json("GET","/v1/sync/status",200)).state,"offline");
    const before = await json("GET","/v1/status/light",200);
    assert.equal(before.memory_count,0);
    assert.deepEqual((await json("GET","/v1/memories",200)).items,[]);
    assert.equal((await legacy("status")).summary.local_alive,0);
    assert.deepEqual((await legacy("list",["--limit","2"])).details,[]);
    stage = "real one-time typed memory write";
    const created=await json("POST","/v1/memories",201,{title,content});
    assert.match(created.id,/^[0-9a-f-]{32,36}$/i);
    assert.equal(created.title,title);
    assert.equal(created.content,content);
    stage = "independent typed count list and lexical recall";
    const after=await json("GET","/v1/status/light",200);
    assert.equal(after.space_id,before.space_id);
    assert.equal(after.memory_count,1);
    const typed = await json("GET","/v1/memories",200);
    assert.equal(typed.next_cursor,null);
    assert.deepEqual(typed.items,[created]);
    const lexical = await json("POST","/v1/memories/recall",200,{query,top_k:2});
    assert.deepEqual(lexical.hits.map(x=>x.memory.id),[created.id]);
    stage = "independent legacy status and list same owner";
    assert.equal((await legacy("status")).summary.local_alive,1);
    const listed = (await legacy("list",["--limit","2"])).details;
    assert.deepEqual(listed.map(x=>[x.id,x.title,x.content]),[[created.id,title,content]]);
    stage = "independent legacy fast recall same marker and owner";
    const recall = await legacy("recall",[query,"--mode","fast","--intent","fact","--limit","2","--titles","--no-related"]);
    assert.equal(recall.summary.count,1);
    assert.deepEqual(recall.details.map(x=>[x.id,x.title]),[[created.id,title]]);
    stage = "same scope and unchanged marker after legacy recall";
    assert.deepEqual((await json("GET","/v1/memories",200)).items,[created]);
    assert.equal((await legacy("status")).summary.local_alive,1);
    await ready();
    assert.equal((await json("GET","/v1/sync/status",200)).state,"offline");
    stage = "independently pinned Wails fixture";
    const owner={pid:endpoint.pid,instance_id:scope.instance_id,account_id:scope.account_id,
      generation:scope.generation,runtimeDigest:digest,desktopDigest,
      source:"505ecc4d3a4f6c67c6a35751ed3c467a337027e9"};
    const locale=process.env.CARD018_LOCALE;
    const now=new Date();
    const day=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
    const memoryRevision=JSON.stringify((await legacy("memory-revision")).summary);
    const projection=row=>({id:row.id,title:row.title,content:row.content});
    async function readIndependent() {
      await ready();
      const light=await json("GET","/v1/status/light",200);
      const typedList=await json("GET","/v1/memories",200);
      assert.equal(typedList.next_cursor,null);
      const typedHits=await json("POST","/v1/memories/recall",200,{query,top_k:2});
      const legacyCount=(await legacy("status")).summary.local_alive;
      const legacyList=(await legacy("list",["--limit","2"])).details;
      const legacyHits=(await legacy("recall",[query,"--mode","fast","--intent","fact","--limit","2","--titles","--no-related"])).details;
      assert.equal(JSON.stringify((await legacy("memory-revision")).summary),memoryRevision);
      assert.equal((await json("GET","/v1/sync/status",200)).state,"offline");
      return {owner, typed:{space:light.space_id,count:light.memory_count,list:typedList.items.map(projection),
        hits:typedHits.hits.map(x=>x.memory.id)},
        legacy:{count:legacyCount,list:legacyList.map(projection),hits:legacyHits.map(x=>x.id)}};
    }
    try { await withPositiveMemoryApp({binary:desktopBinary,owner,locale,ownedEnv:env,endpoint:endpoint.url,
      readIndependent,day,chromium,playwrightCore}); } finally { await relayBrowserMarkers(owned); }
    console.log("PASS positive Overview, Memories and Recall with independent scoped Runtime observations");
    stage = "owned process teardown";
  }, {deviceLocal:true});
  await assert.rejects(lstat(owned),{code:"ENOENT"});
  console.log("PASS owned Runtime stopped and synthetic root removed");
}catch(error){
  diag('controller-failure',error);
  let removed=false;
  if(owned) removed=await lstat(owned).then(()=>false,error=>error.code==="ENOENT");
  console.error("FAIL positive-memory proof stage: "+stage+"; known-owned root removed="+removed);
  process.exitCode=1;
}
