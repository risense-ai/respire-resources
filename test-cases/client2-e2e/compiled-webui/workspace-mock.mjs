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
export const diaryDay="2026-11-23";
const diaryStart=diaryDay.slice(0,8)+"01";
const diaryEnd=diaryDay.slice(0,8)+"30";
export const diaryTitle="CARD018 synthetic journal";
export const dataDir="/synthetic-card018/runtime-data";
export const accountName="CARD018 local account";
export const localUser="card018-fictitious-user";
export const mainSpace="Studio notebook";
export const agentMode={workspace_mode:"readonly",diary_mode:"verbose"};
export const settingsTheme="dark";
export const modelDir="/synthetic-card018/models/m3";
export const modelWeight=modelDir+"/model_quantized.onnx";
export const grantName="Research reader";
export const memberName="Robin Lee";
export const sessionSource={id:"codex",name:"CARD018 synthetic session source",
  installed:true,roots:["/synthetic-card018/sessions"]};
export const injectionTarget={id:"card018-synthetic",name:"CARD018 synthetic agent",
  path:"/synthetic-card018/agent/instructions.md",mode:"inject",state:"fresh",likelyInstalled:true};

export function workspaceMock(surface){
  assert(["overview","workspace","recall","diary","accounts","storage","settings","grants","space-members","injection","stats","wizard","organize","session-import","models"].includes(surface));
  const memory=["workspace","recall"].includes(surface);
  const settings=["storage","settings"].includes(surface);
  const accounts=["accounts","space-members"].includes(surface);
  const models=surface==="models";
  const overviewBootstrap=["overview","stats","wizard"].includes(surface)||settings;
  const fixture=globalThis.RespireFixture.create(memory?"empty":"rich-1k");
  const call=(method,path,body,headers)=>fixture.request(method,path,body,headers).data;
  if(memory){
    call("POST","/v1/host/transactions/login",{mode:"offline_keygen"});
    call("POST","/v1/memories",{title:marker,content:needle});
  }
  if(surface==="diary")call("POST","/v1/diary",{date:diaryDay,content:diaryTitle});
  if(surface==="stats")call("POST","/v1/memories/recall",{query:"observations",top_k:1});
  const health=call("GET","/v1/health");
  const status=call("GET","/v1/status/light");
  assert.equal(health.status,"ready");
  assert(status.memory_count>0);
  const {challenge}=call("POST","/preview/owner-challenge");
  const lease=call("POST","/v1/auth/handshake",{scopes:surface==="grants"?["grants:read"]:["query-log:read"]},
    {"x-respire-handshake-proof":"synthetic-owner-proof-"+challenge});
  const matches=(value,expected)=>{
    assert.deepEqual(Object.keys(value).sort(),Object.keys(expected).sort());
    for(const [key,field] of Object.entries(expected))assert.equal(value[key],field);
  };
  const operations=new Set();
  const pending=new Set();
  const issuedIDs=new Set();
  let issued=0,acknowledged=0;
  const catalog=call("GET","/v1/models/catalog");
  function execute(body){
    const {name,args,id}=body;
    assert.deepEqual(Object.keys(body).sort(),["args","confirmed","id","name","secret"]);
    assert(body.confirmed===true&&body.secret===""&&/^desktop-[0-9a-f-]{36}$/.test(id));
    assert(issued<32&&!issuedIDs.has(id),"Read operation receipt budget exceeded");
    let envelope;
    switch(name){
      case "diary_list":
        assert(/^\d{4}-\d{2}-\d{2}$/.test(args?.from??""));
        const month=surface==="diary"&&args.from===diaryStart;
        if(month)matches(args,{from:diaryStart,to:diaryEnd});
        else matches(args,{from:args.from,to:args.from});
        const diary=call("GET","/v1/diary?date="+(month?diaryDay:args.from)).entries;
        envelope={details:diary.map(item=>({id:item.id,day:item.date,title:item.content,
          content:item.content,created_at:item.updated_at}))};
        break;
      case "organize_suggestions":
        matches(args,{top:50});
        envelope={details:{suggests:call("GET","/v1/organize/suggestions?top=50").suggestions}};
        break;
      case "query_log": {
        assert(overviewBootstrap);
        matches(args,{stats:true,limit:1});
        const data=call("GET","/v1/query-log?limit=1",{}, {authorization:"Bearer "+lease.access_token});
        if(surface==="stats"){
          assert.equal(data.items.length,1);
          const [item]=data.items;
          const day=item.recorded_at.slice(0,10);
          assert.equal(day,diaryDay);
          envelope={details:{...data.stats,daily:[{day,recalls:1,hits:Number(item.candidate_count>0),
            adopted:item.adopted_count,good:item.good_count}]}};
        }else envelope={details:data.stats};
        break;
      }
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
      case "account_list":
        assert(accounts);
        matches(args,{});
        // Accounts are desktop host profiles, not Runtime libraries.
        envelope={summary:{accounts:[{name:accountName,user:localUser,dir:dataDir,current:true}]}};
        break;
      case "space_list": {
        assert(accounts);
        matches(args,{});
        const {spaces}=call("GET","/v1/spaces");
        assert(spaces.some(item=>item.name===mainSpace&&item.active));
        envelope={summary:{spaces:spaces.map(({name,role,active})=>({name,role,current:active}))}};
        break;
      }
      case "grant_list": {
        assert(surface==="grants");
        matches(args,{});
        const {items}=call("GET","/v1/grants",{}, {authorization:"Bearer "+lease.access_token});
        assert(items.some(item=>item.label===grantName&&!item.revoked));
        envelope={details:items};
        break;
      }
      case "space_members": {
        assert(surface==="space-members");
        matches(args,{});
        const {members}=call("GET","/v1/spaces/"+health.active_space_id+"/members");
        assert(members.some(item=>item.display_name===memberName&&item.status==="active"));
        envelope={details:members.map(item=>({session_id:item.member_id,device_name:item.display_name,
          readonly:item.role==="viewer"}))};
        break;
      }
      case "classification_config":
        assert(surface==="organize"||models);
        matches(args,models?{backend:"ds"}:{});
        envelope={summary:{backend:models?"ds":"jev",has_key:false}};
        break;
      case "session_import_targets":
        assert(surface==="session-import");
        matches(args,{});
        envelope={details:[sessionSource]};
        break;
      case "agent_config":
        assert(settings||models);
        matches(args,{});
        envelope={summary:models?{recall_mode:"quality"}:{...agentMode}};
        break;
      case "model_engine":
        assert(models);
        matches(args,{});
        envelope={summary:{engine:"cpu",model:"quantized"}};
        break;
      default:assert.fail("Unexpected read operation");
    }
    operations.add(name);
    pending.add(id);
    issuedIDs.add(id);
    issued++;
    return {id,name,state:"done",envelope};
  }
  function acknowledge(body){
    assert(body&&Object.keys(body).join(",")==="id"&&typeof body.id==="string","Invalid acknowledgement");
    assert(pending.delete(body.id),"Acknowledgement has no owned terminal receipt");
    acknowledged++;
    // Production discards a terminal read from the host operation ledger.
    return "Acknowledged";
  }
  const receipts=()=>({issued,acknowledged,pending:pending.size});
  return {status,operations,execute,acknowledge,receipts,overviewBootstrap,settings,accounts,
    modelInventory:{model:"m3",model_dir:modelDir,tokenizer_installed:true,cpu_container_ready:true,
      variants:[{name:"quantized",size:1024,path:modelWeight,bytes:1024,installed:true}]},
    modelProfile:{catalog:{details:{active:{
    model:models?"m3":catalog.active_model_id,variant:"quantized",engine:"cpu",
  }}}}};
}
