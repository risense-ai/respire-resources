import assert from "node:assert/strict";
import http from "node:http";
import {createHash} from "node:crypto";
import {lstat,readFile,readdir,realpath} from "node:fs/promises";
import {extname,isAbsolute,join,resolve} from "node:path";
import "../../../prototypes/mock-api/fixture.js";
import {dataDir,localUser,settingsTheme,workspaceMock} from "./workspace-mock.mjs";

const commit=/^[a-f0-9]{40}$/;
const sha256=/^[a-f0-9]{64}$/;
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
const logicalPath=/^[A-Za-z0-9_.+-]+(?:\/[A-Za-z0-9_.+-]+)*$/;
const safe=path=>logicalPath.test(path)&&!path.split("/").some(part=>part==="."||part==="..");
async function boundedFile(path,limit){
  const entry=await lstat(path);
  assert(entry.isFile()&&entry.nlink===1&&entry.size>0&&entry.size<=limit,"Untrusted bundle file shape");
  const bytes=await readFile(path);
  assert.equal(bytes.length,entry.size,"Bundle file size changed");
  return bytes;
}
export async function verifyWebUIBundle(directory,source,manifestSHA){
  assert(isAbsolute(directory)&&await realpath(directory)===resolve(directory),"Use an absolute unredirected bundle");
  assert(commit.test(source??"")&&sha256.test(manifestSHA??""),"Independent source and manifest SHA pins are mandatory");
  assert.deepEqual((await readdir(directory)).sort(),["assets","webui.json"]);
  const manifestBytes=await boundedFile(join(directory,"webui.json"),256*1024);
  assert.equal(digest(manifestBytes),manifestSHA,"Review-pinned manifest digest differs");
  const manifest=JSON.parse(manifestBytes);
  assert.deepEqual(Object.keys(manifest).sort(),["files","schema","source_sha"]);
  assert.equal(manifest.schema,1);
  assert.equal(manifest.source_sha,source,"Bundle source differs");
  const names=Object.keys(manifest.files);
  assert(names.length>0&&names.length<=1024&&names.every(safe),"Invalid bundle inventory");
  const logicalNames=new Set(names.map(name=>name.toLowerCase()));
  assert.equal(logicalNames.size,names.length,"Bundle case collision");
  const assets=new Map();
  let total=0;
  async function visit(path,prefix=""){
    assert((await lstat(path)).isDirectory(),"Bundle directory is not direct");
    for(const child of await readdir(path,{withFileTypes:true})){
      const name=prefix+child.name, file=join(path,child.name);
      assert(safe(name),"Invalid bundle item name");
      if(child.isDirectory()){
        assert(names.some(key=>key.startsWith(name+"/")),"Unexpected bundle directory");
        await visit(file,name+"/");
        continue;
      }
      assert(child.isFile()&&Object.hasOwn(manifest.files,name),"Unexpected bundle file");
      const {size,sha256:hash}=manifest.files[name];
      assert(Number.isSafeInteger(size)&&size>0&&size<=8*1024*1024&&sha256.test(hash??""),"Invalid bundle file pin");
      total+=size;
      assert(total<=32*1024*1024,"Bundle size limit");
      const bytes=await boundedFile(file,size);
      assert.equal(bytes.length,size);
      assert.equal(digest(bytes),hash,"Bundle asset digest differs");
      assets.set(name,bytes);
    }
  }
  await visit(join(directory,"assets"));
  assert.equal(assets.size,names.length,"Missing declared bundle files");
  assert(assets.has("quickpanel.html")&&assets.has("quickpanel.js")&&assets.has("ui/i18n.js"),"Missing genuine product assets");
  return assets;
}

const mime=new Map([[".html","text/html"],[".css","text/css"],[".js","text/javascript"],
  [".svg","image/svg+xml"],[".woff2","font/woff2"],[".woff","font/woff"]]);
const requestIDs=new Map([
  ["GET /api/state","state"],["GET /api/runtime-status","status"],["GET /api/operations","operations"],
  ["GET /api/inject-targets","inject-targets"],["GET /api/model-profile-state","model-profile"],
  ["POST /api/execute","execute"],["POST /api/operation-ack","operation-ack"],
  ["GET /wails/runtime.js","wails-runtime"],["GET /wails/runtime","wails-transport"],
  ["POST /wails/runtime","wails-transport"],["HEAD /wails/custom.js","wails-optional"],
  ["GET /workspace.html","workspace"],["GET /quickpanel.html","quickpanel"],["POST /api/panel-size","panel-size"],
]);
export function requestID(method,path){
  const type=["GET","POST","HEAD"].includes(method)?method:"OTHER";
  return type+":"+(requestIDs.get(type+" "+path)??"other");
}
export function quickPanelAdapter(assets,{locale,failStatus=false,surface="quickpanel",wails}){
  assert(["en","zh"].includes(locale));
  const workspace=surface==="quickpanel"?null:workspaceMock(surface);
  assert(!workspace||Buffer.isBuffer(wails),"Workspace needs verified production Wails asset");
  const fixture=globalThis.RespireFixture.create("rich-1k");
  const health=fixture.request("GET","/v1/health").data;
  const status=workspace?.status??fixture.request("GET","/v1/status/light").data;
  assert.equal(health.status,"ready");
  assert(Number.isInteger(status.memory_count)&&status.memory_count>0);
  const observed={state:0,status:0,resize:0,denied:0};
  const response=(res,statusCode,body)=>res.writeHead(statusCode,{"Content-Type":"application/json"}).end(JSON.stringify(body));
  const ok=(res,result)=>response(res,200,{ok:true,result});
  const deniedRequests=[];
  const deny=(req,res,statusCode)=>{
    observed.denied++;
    if(deniedRequests.length<8)
      deniedRequests.push(requestID(req.method,req.url)+":"+statusCode);
    return response(res,statusCode,{ok:false,error:"Unexpected compiled WebUI request"});
  };
  const app=http.createServer({requestTimeout:5000,headersTimeout:5000},async(req,res)=>{
    res.setHeader("Cache-Control","no-store");
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Content-Security-Policy","default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'");
    try{
      const host="127.0.0.1:"+app.address().port;
      const origin="http://"+host;
      if(req.headers.host!==host||(req.headers.origin&&req.headers.origin!==origin)||
          typeof req.url!=="string"||!req.url.startsWith("/")||req.url.startsWith("//"))
        return deny(req,res,403);
      const url=new URL(req.url,origin);
      if(url.search||url.pathname!==req.url)return deny(req,res,400);
      if(req.method==="GET"&&url.pathname==="/api/state"){
        observed.state++;
        return ok(res,{connected:true,platform:"linux",version:"fixture",preferences:{language:locale,onboardingCompleted:true,...(workspace?.settings&&{theme:settingsTheme})},
          health:{bin:"synthetic-runtime",inference:{phase:"ready",queued:0}}});
      }
      if(req.method==="GET"&&url.pathname==="/api/runtime-status"){
        observed.status++;
        if(failStatus)return response(res,503,{ok:false,error:"Synthetic status deliberately unavailable"});
        return ok(res,{summary:{local_alive:status.memory_count,local_total:status.memory_count,
          unlocked:true,...(workspace&&{data_dir:dataDir}),
          session:{has_token:true,...(surface==="accounts"&&{user:localUser,has_local_keys:true})},retrieval_index:{state:"ready"},sync_live:{phase:"idle",remote_alive:0,pending:0,conflicts:0}}});
      }
      if(workspace){
        if(req.method==="HEAD"&&url.pathname==="/wails/custom.js"){
          // The genuine Wails bundle probes this optional server-mode script.
          return res.writeHead(404).end();
        }
        if(req.method==="GET"&&url.pathname==="/wails/runtime.js")
          return res.writeHead(200,{"Content-Type":"text/javascript"}).end(wails);
        if(req.method==="GET"&&url.pathname==="/api/operations")return ok(res,[]);
        if(req.method==="GET"&&url.pathname==="/api/inject-targets"&&workspace.overviewBootstrap)return ok(res,{targets:[]});
        if(req.method==="GET"&&url.pathname==="/api/model-profile-state"&&workspace.overviewBootstrap)return ok(res,workspace.modelProfile);
        if(req.method==="POST"&&["/api/execute","/api/operation-ack"].includes(url.pathname)){
          if(req.headers.origin!==origin||req.headers["x-respire-client"]!=="1"||
              req.headers["content-type"]!=="application/json")return deny(req,res,403);
          const acknowledge=url.pathname==="/api/operation-ack";
          let body="";
          for await(const chunk of req){
            body+=chunk;
            if(body.length>(acknowledge?96:1024))return deny(req,res,400);
          }
          return ok(res,(acknowledge?workspace.acknowledge:workspace.execute)(JSON.parse(body)));
        }
      }
      if(!workspace&&req.method==="POST"&&url.pathname==="/api/panel-size"){
        if(req.headers.origin!==origin||req.headers["x-respire-client"]!=="1"||
            req.headers["content-type"]!=="application/json")return deny(req,res,403);
        let body="";
        for await(const chunk of req){
          body+=chunk;
          if(body.length>64)return deny(req,res,400);
        }
        const size=JSON.parse(body);
        if(!size||Object.keys(size).join(",")!=="height"||!Number.isInteger(size.height)||
            size.height<1||size.height>2048)return deny(req,res,400);
        observed.resize++;
        return ok(res,{});
      }
      const name=url.pathname.slice(1),type=mime.get(extname(name));
      if(req.method==="GET"&&safe(name)&&type&&assets.has(name)&&(extname(name)!==".html"||name===(workspace?"workspace.html":"quickpanel.html")))
        return res.writeHead(200,{"Content-Type":type}).end(assets.get(name));
      return deny(req,res,404);
    }catch{
      if(!res.headersSent)deny(req,res,400);
    }
  });
  return {app,observed,count:status.memory_count,operations:workspace?.operations,receipts:workspace?.receipts,deniedRequests};
}
