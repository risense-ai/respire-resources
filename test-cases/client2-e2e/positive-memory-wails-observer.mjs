import assert from "node:assert/strict";
import {bindCompiledLayoutProof} from "./compiled-product-layout-proof.mjs";
import {pinnedProductCaption} from "./compiled-product-layout-captions.mjs";
import {observeHostedWorkspace} from "./compiled-product-hosted-observer.mjs";
import {acceptPositiveSearchTerminal, compareOwnedMemoryWitnesses, isPositiveMemorySearch, positiveMemory} from "./positive-memory-wails-contract.mjs";

// Stage-only executor. Caller supplies a fresh isolated Page and independently
// pinned owner with a before-browser typed+legacy witness. No process launch here.
export async function observePositiveMemoryPages({page, origin, owner, locale, marker}) {
  assert.match(new URL(origin).origin,/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  assert.equal(origin,new URL(origin).origin);
  assert(["en","zh"].includes(locale) && marker?.count===1 && marker.title===positiveMemory.title);
  const expectedLang=locale==="zh"?"zh-CN":"en";
  let operationID, allowSearch=false;
  let rejected=false;
  await page.route("**/*",async route=>{
    const request=route.request(), url=new URL(request.url());
    let pass=url.origin===origin && ["GET","HEAD","POST"].includes(request.method());
    if(pass&&request.method()==="POST"){
      let value;
      try{value=request.postDataJSON();}catch{/* fail closed below */}
      if(url.pathname==="/api/execute" && value?.name==="memory_search"){
        pass=allowSearch&&!operationID&&!url.search&&isPositiveMemorySearch(value);
        if(pass)operationID=value.id;
      }else{
        // Actual transport-side Go allowlist is decisive for other operations.
        pass=!url.search && (url.pathname==="/api/operation-ack" ||
          url.pathname==="/api/execute"&&["capabilities","memory_list","query_log","diary_list","organize_suggestions"].includes(value?.name));
      }
    }
    if(!pass){rejected=true;await route.abort();return;}
    await route.continue();
  });
  const layout=bindCompiledLayoutProof(page);
  try {
  const receipt=await page.goto(origin+"/workspace.html#overview");
  assert.equal(receipt.headers()["x-card018-issuer"],owner.issuer);
  await observeHostedWorkspace({page,request:page.request,origin,name:"overview",locale,owned:owner,
    receipt:{...owner,sourceSHA:owner.source,source:"runtime-status",fixture:"seeded-memory",field:"memoryCount",locale,value:"1"}});
  const check=async(name,loaded,surface="#view .view-page")=>layout.check({
    name,locale,surface,localized:pinnedProductCaption(name,locale),checkLoaded:loaded,keepOpen:true});
  await check("overview",async()=>{
    const count=page.locator("#view .view-page [data-overview-summary] .metric:first-child strong");
    await count.waitFor({state:"visible"});
    assert.equal((await count.innerText()).trim(),"1");
  });
  const loadedList = page.waitForResponse(async response=>{
    const path=new URL(response.url());
    if(path.origin!==origin||!["/api/execute","/api/operation"].includes(path.pathname)||!response.ok())return false;
    const body=await response.json();
    const job=body.result;
    if(job?.name!=="memory_list" || job.state!=="done")return false;
    assert.equal(job.envelope?.status,"ok");
    assert.deepEqual(job.envelope.details?.map(x=>[x.id,x.title]),[[marker.id,marker.title]]);
    for(const key of ["instance_id","account_id","generation"])assert.equal(job.scope?.[key],owner[key]);
    return true;
  },{timeout:8000});
  await Promise.all([loadedList,page.locator('nav [data-page="memories"]').click()]);
  const view=page.locator("#view .view-page");
  assert.match(marker.id,/^[a-f0-9-]{32,36}$/i);
  const memory=view.locator('.memory-title[data-select="'+marker.id+'"]');
  await memory.waitFor({state:"visible"});
  assert.equal(await memory.count(),1);
  assert.equal((await memory.innerText()).trim(),marker.title);
  assert.equal(await view.locator("[data-clear-search]").isVisible(),false);
  assert.equal(await page.locator("html").getAttribute("lang"),expectedLang);
  assert.equal(new URL(page.url()).hash,"#memories");
  const visibleMarker=async()=>{
    await memory.waitFor({state:"visible"});
    assert.equal(await memory.count(),1);
    assert.equal((await memory.innerText()).trim(),marker.title);
  };
  await check("workspace",visibleMarker);
  const input=view.locator("[data-search]");
  await input.fill(positiveMemory.query);
  allowSearch=true;
  let terminal;
  const wait=page.waitForResponse(async response=>{
    const path=new URL(response.url());
    if(path.origin!==origin||!["/api/execute","/api/operation"].includes(path.pathname)||!operationID||!response.ok())return false;
    const body=await response.json();
    if(body.result?.id!==operationID||body.result.state!=="done")return false;
    terminal=body.result;
    return true;
  },{timeout:8000});
  await Promise.all([wait,input.press("Enter")]);
  acceptPositiveSearchTerminal({operationID,owner,memoryID:marker.id,terminal});
  await view.locator("[data-clear-search]").waitFor({state:"visible"});
  assert.equal(await view.locator(".memory-title[data-select]").count(),1);
  assert.equal((await memory.innerText()).trim(),marker.title);
  await check("recall",async()=>{
    await view.locator("[data-clear-search]").waitFor({state:"visible"});
    await visibleMarker();
  });
  assert.equal(rejected,false,"Request escaped literal allowlist");
  }finally{layout.dispose();}
}

/** Attach only after caller independently established the one owned process
 * and its scope; readIndependent must issue fresh typed/legacy GET and scoped
 * RPC reads on each invocation, never use Browser DOM as a source. */
export async function runOwnedPositiveMemoryObservation({page, origin, owner, locale, readIndependent}) {
  assert.equal(typeof readIndependent,"function");
  const before=await readIndependent();
  const marker=compareOwnedMemoryWitnesses(owner,before,before);
  try {
    await observePositiveMemoryPages({page,origin,owner,locale,marker});
  } finally {
    const after=await readIndependent();
    compareOwnedMemoryWitnesses(owner,before,after);
  }
}