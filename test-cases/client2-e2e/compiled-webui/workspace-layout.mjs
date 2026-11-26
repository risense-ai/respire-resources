import assert from "node:assert/strict";
import {once} from "node:events";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {isAbsolute} from "node:path";
import {measureLayout,viewports} from "../layout.mjs";
import {quickPanelAdapter,requestID,verifyWebUIBundle} from "./quick-panel-adapter.mjs";
import {marker,needle,verifyWailsRuntime} from "./workspace-mock.mjs";

const require=createRequire(import.meta.url);
assert.equal(require("@playwright/test/package.json").version,"1.56.1");
const driver=require("@playwright/test")[process.env.RESPIRE_E2E_BROWSER??"chromium"];
assert(driver,"A reviewed browser type is required");
const executablePath=process.env.RESPIRE_E2E_BROWSER_EXECUTABLE??driver.executablePath();
assert(isAbsolute(executablePath));
const assets=await verifyWebUIBundle(process.env.RESPIRE_E2E_WEBUI_BUNDLE??"",
  process.env.RESPIRE_E2E_PRODUCT_SHA,process.env.RESPIRE_E2E_WEBUI_MANIFEST_SHA);
const wails=await verifyWailsRuntime(process.env.RESPIRE_E2E_WAILS_RUNTIME);
const captions=JSON.parse(await readFile(new URL("../../fixtures/i18n/compiled-workspace.json",import.meta.url),"utf8"));
const surfaces=["overview","workspace","recall"];
for(const surface of surfaces)assert(captions[surface]?.en&&captions[surface]?.zh&&captions[surface].en!==captions[surface].zh);
const errorSelector="#notice.error:not([hidden]),[data-runtime-error]:not([hidden]):not(:empty),.danger-text,.form-error";

async function check(browser,surface,locale){
  const {app,observed,count,operations,receipts,deniedRequests}=quickPanelAdapter(assets,{locale,surface,wails});
  const context=await browser.newContext({serviceWorkers:"block",viewport:viewports.desktop,locale});
  const failures=[];
  const record=code=>{if(failures.length<8)failures.push(code);};
  try{
    await once(app.listen(0,"127.0.0.1"),"listening");
    const origin="http://127.0.0.1:"+app.address().port;
    const optional=origin+"/wails/custom.js";
    const route=surface==="overview"?"overview":"memories";
    await context.route("**/*",async request=>{
      if(new URL(request.request().url()).origin!==origin){
        record("external-origin");
        await request.abort();
      }else await request.continue();
    });
    const page=await context.newPage();
    page.on("pageerror",()=>record("page-exception"));
    page.on("console",message=>{
      if(message.type()!=="error")return;
      if(message.location().url===optional&&/failed to load resource/i.test(message.text()))return;
      record("console-error");
    });
    page.on("requestfailed",()=>record("request-failed"));
    page.on("response",response=>{
      if(response.status()>=400&&!(response.status()===404&&response.url()===optional&&
        response.request().method()==="HEAD"))record(requestID(response.request().method(),new URL(response.url()).pathname)+":"+response.status());
    });
    const url=origin+"/workspace.html#"+route;
    const runtime=page.waitForResponse(response=>response.url()===origin+"/wails/runtime.js",{timeout:5000});
    const [runtimeResponse]=await Promise.all([runtime,page.goto(url)]);
    assert.equal(runtimeResponse.status(),200);
    assert.equal(page.url(),url);
    const view=page.locator("#view .view-page");
    const title=view.locator("h1");
    const item=view.locator(".memory-title[data-select]").filter({hasText:marker});
    if(surface==="recall"){
      await item.waitFor({state:"visible",timeout:5000});
      const search=view.locator("input[data-search]");
      await search.fill(needle);
      await search.press("Enter");
    }
    let fontSize;
    for(const size of [viewports.desktop,viewports.desktopSmall]){
      await page.setViewportSize(size);
      assert.equal(await page.locator("html").getAttribute("lang"),locale==="zh"?"zh-CN":"en");
      const caption=surface==="recall"?view.locator("button[data-clear-search]"):title;
      await caption.waitFor({state:"visible",timeout:5000});
      assert.equal(await caption.count(),1);
      assert.equal((await caption.innerText()).trim(),captions[surface][locale]);
      if(surface==="overview"){
        const metric=view.locator("[data-overview-summary] .metric").first().locator("strong");
        await page.waitForFunction(({text})=>document.querySelector("[data-overview-summary] .metric strong")?.textContent===text,
          {text:new Intl.NumberFormat(locale).format(count)});
        assert.equal(await metric.innerText(),new Intl.NumberFormat(locale).format(count));
      }else{
        await item.waitFor({state:"visible",timeout:5000});
        assert.equal(await item.count(),1);
        assert.equal(await item.innerText(),marker);
        assert.equal(await view.locator("button[data-clear-search]").isVisible(),surface==="recall");
        assert(operations.has(surface==="recall"?"memory_search":"memory_list"),"Missing actual typed data request");
      }
      await page.evaluate(()=>document.fonts.ready.then(()=>{}));
      const stock=await page.evaluate(measureLayout);
      assert.deepEqual(stock.issues,[],"Stock layout issues");
      if(fontSize!==undefined)assert(stock.fontSize<fontSize,"Expected fluid root rem scaling");
      fontSize=stock.fontSize;
      assert.equal(await view.locator(errorSelector).count(),0,"Application error notice");
      assert.equal(await page.locator("#notice.error:not([hidden])").count(),0);
    }
    assert(observed.state>=1&&observed.status>=1,"Missing ready-state bridge requests");
    const deadline=Date.now()+1000;
    while((receipts().issued===0||receipts().pending>0)&&Date.now()<deadline)
      await new Promise(resolve=>setTimeout(resolve,25));
    assert(receipts().issued>0&&receipts().issued===receipts().acknowledged,
      "Missing browser acknowledgement for owned terminal reads");
    assert.equal(await page.locator("#notice.error:not([hidden])").count(),0);
    assert.equal(observed.denied,0);
    assert.deepEqual(failures,[]);
    console.log("PASS COMPILED WEBUI + MOCK RUNTIME "+surface+" "+locale+" 1440x900 1024x768");
  }catch(error){
    const counts=Object.fromEntries(Object.entries(observed).map(([key,value])=>[key,Math.min(value,999)]));
    console.error("WORKSPACE FIXTURE DIAGNOSTIC "+JSON.stringify({
      surface,locale,counts,receipts:receipts(),denied:deniedRequests,events:failures,
    }));
    throw error;
  }finally{
    try{await context.close();}finally{
      if(app.listening){app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
    }
  }
}

const browser=await driver.launch({executablePath});
try{
  for(const surface of surfaces)for(const locale of ["en","zh"])await check(browser,surface,locale);
}finally{await browser.close();}
