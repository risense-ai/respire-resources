import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {lstat,readFile} from "node:fs/promises";
import {isAbsolute} from "node:path";
import "../../../prototypes/mock-api/fixture.js";

export const wailsRevision="7b11001b92b712210b27d8cb53430e83f67ad8e4";
export const wailsSHA="8326f27a4c511e71cf1e64eb8b861fd201b9cf0ca6035bfd65fc4dfd2cb0f25b";
export async function verifyWailsRuntime(path){
  assert(isAbsolute(path??""),"Supply the bundled production Wails runtime.js");
  const info=await lstat(path);
  assert(info.isFile()&&info.nlink===1&&info.size===56590,"Unexpected Wails production asset");
  const bytes=await readFile(path);
  assert.equal(createHash("sha256").update(bytes).digest("hex"),wailsSHA,"Wails runtime source pin differs");
  return bytes;
}
export const needle="CARD018 unique needle";
export const marker="CARD018 fixture: retained note";

export function workspaceMock(surface){
  assert(["overview","workspace","recall"].includes(surface));
  const memory=surface!=="overview";
  const fixture=globalThis.RespireFixture.create(memory?"empty":"rich-1k");
  const call=(method,path,body,headers)=>fixture.request(method,path,body,headers).data;
  if(memory){
    call("POST","/v1/host/transactions/login",{mode:"offline_keygen"});
    call("POST","/v1/memories",{title:marker,content:needle});
  }
  const health=call("GET","/v1/health");
  const status=call("GET","/v1/status/light");
  assert.equal(health.status,"ready");
  assert(status.memory_count>0);
  const {challenge}=call("POST","/preview/owner-challenge");
  const lease=call("POST","/v1/auth/handshake",{scopes:["query-log:read"]},
    {"x-respire-handshake-proof":"synthetic-owner-proof-"+challenge});
  const matches=(value,expected)=>{
    assert.deepEqual(Object.keys(value).sort(),Object.keys(expected).sort());
    for(const [key,field] of Object.entries(expected))assert.equal(value[key],field);
  };
  const operations=new Set();
  const catalog=call("GET","/v1/models/catalog");
  function execute(body){
    const {name,args,id}=body;
    assert.deepEqual(Object.keys(body).sort(),["args","confirmed","id","name","secret"]);
    assert(body.confirmed===true&&body.secret===""&&/^desktop-[0-9a-f-]{36}$/.test(id));
    let envelope;
    switch(name){
      case "diary_list":
        assert(/^\d{4}-\d{2}-\d{2}$/.test(args?.from??""));
        matches(args,{from:args.from,to:args.from});
        envelope={details:call("GET","/v1/diary?date="+args.from).entries};
        break;
      case "organize_suggestions":
        matches(args,{top:50});
        envelope={details:{suggests:call("GET","/v1/organize/suggestions?top=50").suggestions}};
        break;
      case "query_log":
        assert(!memory);
        matches(args,{stats:true,limit:1});
        envelope={details:call("GET","/v1/query-log?limit=1",{},
          {authorization:"Bearer "+lease.access_token}).stats};
        break;
      case "capabilities":
        assert(memory);
        matches(args,{});
        envelope={summary:{capabilities:{memory_list_metadata:true}}};
        break;
      case "memory_list":
        assert(memory);
        matches(args,{limit:500,metadata:true});
        envelope={details:call("GET","/v1/memories?limit=200").items};
        assert.equal(envelope.details.length,1,"One loaded synthetic item required");
        break;
      case "memory_search":
        assert(surface==="recall");
        matches(args,{query:needle,limit:50});
        envelope={details:call("POST","/v1/memories/recall",{query:needle,top_k:50}).hits.map(hit=>hit.memory)};
        assert.deepEqual(envelope.details.map(item=>item.title),[marker]);
        break;
      default:assert.fail("Unexpected read operation");
    }
    operations.add(name);
    return {id,name,state:"done",envelope};
  }
  return {status,operations,execute,modelProfile:{catalog:{details:{active:{
    model:catalog.active_model_id,variant:"quantized",engine:"cpu",
  }}}}};
}
