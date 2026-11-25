import {browserMarker} from './card018-safe-diagnostic.mjs';
await browserMarker('browser-entry');
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {bindCompiledLayoutProof} from "./compiled-product-layout-proof.mjs";
import {observeOwnedStorageSettings} from "./compiled-storage-settings-observer.mjs";
import {proofLines,encodeProofFrame} from "./positive-memory-proof-ipc.mjs";

const [origin,locale]=process.argv.slice(2);
const owner=JSON.parse(process.env.CARD018_OWNER_PROCESS_INPUT??"null");
const issuer=process.env.CARD018_OWNER_WAILS_ISSUER;
const frames=proofLines(process.stdin)[Symbol.asyncIterator]();
async function frame(kind){
  const {done,value}=await frames.next();
  assert(!done&&value?.kind===kind,"Wrong private Settings proof frame");
  return value;
}
const write=value=>new Promise((ok,fail)=>process.stdout.write(encodeProofFrame(value)+"\n",err=>err?fail(err):ok()));
let browser,layout,after=false;
try{
  assert(process.platform==="win32"&&process.arch==="x64"&&process.env.GITHUB_ACTIONS==="true"&&
    process.env.RUNNER_ENVIRONMENT==="github-hosted"&&process.env.CARD018_STORAGE_SETTINGS_ONLY==="1");
  assert.match(origin,/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  await write({kind:"hello",owner,issuer,locale});
  await browserMarker("browser-hello");
  const before=(await frame("before")).snapshot;
  await browserMarker("browser-before");
  const {chromium}=createRequire(import.meta.url)(process.env.CARD018_PLAYWRIGHT_CORE);
  browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.CARD018_CHROMIUM,
    args:["--disable-background-networking","--no-first-run","--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"]});
  await browserMarker("chromium-started");
  const page=await browser.newPage({serviceWorkers:"block",viewport:{width:1440,height:900}});
  layout=bindCompiledLayoutProof(page);
  let denied=false;
  await page.route("**/*",async r=>{
    const req=r.request(),url=new URL(req.url());
    if(url.origin===origin&&["GET","HEAD","POST"].includes(req.method()))await r.continue();
    else {denied=true;await r.abort();}
  });
  const response=await page.goto(origin+"/workspace.html#overview");
  assert.equal(response.headers()["x-card018-issuer"],issuer);
  await page.waitForFunction(()=>document.querySelector("#connection-dot")?.classList.contains("online")&&
    document.querySelector("#status-summary")?.textContent.includes("Runtime "));
  let calls=0;
  await observeOwnedStorageSettings({page,origin,owner:{...owner,issuer},locale,
    fixturePath:process.env.CARD018_RUNTIME_DATA,layout,readIndependent:async()=>{
      if(++calls===1)return before;
      assert.equal(calls,2);
      after=true;
      // This signals the independent comparison phase, never a final pass.
      // Later DOM/cleanup exceptions still make the overall child exit nonzero.
      await browserMarker("browser-observed");
      await write({kind:"after",ok:true});
      const result=await frame("after");
      assert.equal(result.verified,true);
      return result.snapshot;
    }});
  assert.equal(denied,false);
}catch(error){
  await browserMarker('browser-failure',error);
  process.exitCode=1;
  console.error("FAIL isolated Storage/Settings browser verification");
  if(!after){
    try{await write({kind:"after",ok:false});await frame("after");}catch{/* launcher does bounded cleanup */}
  }
}finally{
  layout?.dispose();
  await browser?.close();
  process.stdout.end();
  process.stdin.destroy();
}
