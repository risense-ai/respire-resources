import assert from "node:assert/strict";
import {isDeepStrictEqual} from "node:util";
const operationID = /^desktop-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function only(value, keys){
  return !!value && typeof value==="object" && isDeepStrictEqual(Object.keys(value).sort(),[...keys].sort());
}

// Accept the exact original product submission, then only the same POST or
// its exact GET poll may report the same completed operation.
export function bindOwnedWailsOperations(page,{origin,issuer,specs,owner}){
  assert.match(origin,/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  assert.match(issuer,/^[a-f0-9]{32}$/);
  const ids=new Map();
  let invalid=false;
  const completed=new Map();
  const executed=origin+"/api/execute";
  const inFlight=request=>{
    if(request.url()!==executed||request.method()!=="POST")return;
    const headers=request.headers();
    if(headers["x-respire-client"]!=="1"||headers["content-type"]!=="application/json")return;
    let body;
    try{body=request.postDataJSON();}catch{return;}
    if(!only(body,["args","confirmed","id","name","secret"])||!operationID.test(body.id)||
       body.confirmed!==true||body.secret!=="")return;
    const spec=specs.find(x=>x.name===body.name&&isDeepStrictEqual(x.args,body.args));
    if(!spec)return;
    if(ids.has(spec.name)){invalid=true;return;}
    ids.set(spec.name,{id:body.id,request});
  };
  page.on("request",inFlight);
  return {
    async accept(response){
      assert.equal(invalid,false,"Duplicate matching Wails submission");
      const request=response.request();
      if(!response.ok()||response.headers()["x-card018-issuer"]!==issuer||request.url()!==response.url())return false;
      const match=[...ids].find(([,item])=>
        (request===item.request&&request.method()==="POST"&&response.url()===executed) ||
        (request.method()==="GET"&&response.url()===origin+"/api/operation?id="+item.id));
      if(!match)return false;
      const [name,{id}]=match;
      const body=await response.json();
      assert.equal(body.ok,true);
      const job=body.result;
      assert.equal(job?.id,id);
      assert.equal(job.name,name);
      if(job.state==="running")return false;
      assert.equal(job.state,"done");
      assert.equal(job.envelope?.status,"ok");
      const spec=specs.find(x=>x.name===name);
      if(spec.authority==="runtime"){
        for(const key of ["instance_id","account_id","generation"])assert.equal(job.scope?.[key],owner[key]);
        assert.equal(job.runtimeOperationId,id);
      }else{
        assert.equal(spec.authority,"host");
        assert(job.scope==null && job.runtimeOperationId==null,"Host-local receipt unexpectedly claimed Runtime authority");
      }
      spec.verify?.(job.envelope);
      completed.set(name,job);
      return completed.size===specs.length;
    },
    dispose(){page.off("request",inFlight);}
  };
}
