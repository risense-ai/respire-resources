import assert from "node:assert/strict";
import {win32} from "node:path";
import {pinnedProductCaption} from "./compiled-product-layout-captions.mjs";

const stateFields=["pid","instance_id","account_id","generation"];

// Local Windows only. Preserve root separator semantics and reject UNC,
// drive-relative names, NUL, and alternate filesystem paths.
function ownedPath(path){
  assert(typeof path==="string" && !path.includes("\0"));
  const clean=path.replace(/^\\\\\?\\(?=[A-Za-z]:\\)/,"");
  assert.match(clean,/^[A-Za-z]:[\\/][^:]*$/);
  return win32.normalize(clean).replace(/[\\/]+$/,"").toLowerCase();
}

export function validateSettingsWitness({owner,locale,fixturePath,witness}){
  assert(["en","zh"].includes(locale));
  assert(Number.isSafeInteger(owner?.pid)&&owner.pid>0&&Number.isSafeInteger(owner.generation)&&owner.generation>0&&
    owner.instance_id&&owner.account_id&&/^[0-9a-f]{64}$/.test(owner.runtimeDigest)&&/^[0-9a-f]{64}$/.test(owner.desktopDigest)&&
    /^[0-9a-f]{40}$/.test(owner.source)&&/^[0-9a-f]{32}$/.test(owner.issuer),"Missing independently pinned owned app scope");
  for(const key of [...stateFields,"runtimeDigest","desktopDigest","source"])assert.equal(witness?.owner?.[key],owner[key]);
  const path=ownedPath(fixturePath);
  assert.equal(ownedPath(witness.runtimePath),path);
  assert.equal(ownedPath(witness.realRuntimePath),path);
  assert.equal(witness.preferences?.language,locale);
  assert.equal(witness.preferences.theme,"dark","Expected non-default isolated host preference");
  assert.equal(witness.preferences.proxyMode,"direct");
  assert.equal(witness.agent?.workspace_mode,"normal");
  assert([null,"concise","verbose"].includes(witness.agent?.diary_mode));
  return Object.freeze({path,theme:"dark",locale,agent:{workspace:"normal",diary:witness.agent.diary_mode}});
}

async function checkState(request,origin,owner,expected,wirePath){
  for(const endpoint of ["/api/state","/api/runtime-status"]){
    const url=origin+endpoint,response=await request.get(url,{maxRedirects:0,timeout:4000});
    assert(response.url()===url&&response.status()===200&&response.headers()["x-card018-issuer"]===owner.issuer);
    const body=await response.json();assert.equal(body.ok,true);
    if(endpoint==="/api/state"){
      assert.equal(body.result.connected,true);
      for(const key of stateFields)assert.equal(body.result.health?.[key],owner[key]);
      assert.equal(body.result.health.image_sha256,owner.runtimeDigest);
      assert.deepEqual([body.result.preferences?.language,body.result.preferences?.theme],
        [expected.locale,expected.theme]);
    }else{
      assert.equal(ownedPath(body.result.summary?.data_dir),expected.path);
      assert.equal(body.result.summary.data_dir,wirePath,"Wails status did not present the exact Runtime value");
    }
  }
}

// Designed only for a fresh Page already observing the isolated connected
// Overview. The separate Go gate decides which product reads may execute.
export async function observeOwnedStorageSettings({page,origin,owner,locale,fixturePath,readIndependent,layout}){
  assert.match(origin,/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  assert(typeof readIndependent==="function");
  assert.equal(page.url(),origin+"/workspace.html#overview");
  const before=await readIndependent();
  const expected=validateSettingsWitness({owner,locale,fixturePath,witness:before});
  try {
    await checkState(page.request,origin,owner,expected,before.runtimePath);
    let terminal;
    const operation=page.waitForResponse(async response=>{
      const url=new URL(response.url());
      if(url.origin!==origin||!["/api/execute","/api/operation"].includes(url.pathname)||!response.ok())return false;
      const job=(await response.json()).result;
      if(job?.name!=="agent_config"||job.state!=="done")return false;
      terminal=job;return true;
    },{timeout:8000});
    await Promise.all([operation,page.locator('nav [data-page="settings"]').click()]);
    assert.equal(page.url(),origin+"/workspace.html#settings");
    assert.equal(terminal.envelope?.status,"ok");
    for(const key of ["instance_id","account_id","generation"])assert.equal(terminal.scope?.[key],owner[key]);
    assert.equal(terminal.envelope.summary?.workspace_mode,expected.agent.workspace);
    assert.equal(terminal.envelope.summary?.diary_mode??null,expected.agent.diary);
    const view=page.locator("#view .view-page");
    const storage=view.locator("input[name=dir]");
    await storage.waitFor({state:"visible"});
    assert.equal(await storage.count(),1);
    assert.equal(await storage.inputValue(),before.runtimePath,"Storage renders a different or fallback path");
    const mode=view.locator("[data-pref=theme]");
    await mode.waitFor({state:"visible"});
    assert.equal(await mode.count(),1);
    assert.equal(await mode.inputValue(),expected.theme);
    assert.equal(await page.locator("html").getAttribute("data-theme"),expected.theme);
    assert.equal(await page.locator("html").getAttribute("lang"),locale==="zh"?"zh-CN":"en");
    if(layout){
      await layout.check({name:"storage",locale,surface:"#view .view-page > section:has(input[name=dir])",
        localized:pinnedProductCaption("storage",locale),keepOpen:true,checkLoaded:async()=>{
          await storage.waitFor({state:"visible"});
          assert.equal(await storage.inputValue(),before.runtimePath);
        }});
      await layout.check({name:"settings",locale,surface:"#view .view-page",
        localized:pinnedProductCaption("settings",locale),keepOpen:true,checkLoaded:async()=>{
          await mode.waitFor({state:"visible"});
          assert.equal(await mode.inputValue(),expected.theme);
        }});
    }
  }finally{
    const after=await readIndependent();
    assert.deepEqual(validateSettingsWitness({owner,locale,fixturePath,witness:after}),expected);
    assert.equal(after.runtimePath,before.runtimePath);
  }
}
