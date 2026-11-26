import assert from "node:assert/strict";
import {once} from "node:events";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {isAbsolute} from "node:path";
import {measureLayout,viewports} from "../layout.mjs";
import {quickPanelAdapter,verifyWebUIBundle} from "./quick-panel-adapter.mjs";

const require=createRequire(import.meta.url);
assert.equal(require("@playwright/test/package.json").version,"1.56.1");
const name=process.env.RESPIRE_E2E_BROWSER??"chromium";
assert(["chromium","webkit"].includes(name));
const driver=require("@playwright/test")[name];
const executablePath=process.env.RESPIRE_E2E_BROWSER_EXECUTABLE??driver.executablePath();
assert(isAbsolute(executablePath));
const assets=await verifyWebUIBundle(process.env.RESPIRE_E2E_WEBUI_BUNDLE??"",
  process.env.RESPIRE_E2E_PRODUCT_SHA,process.env.RESPIRE_E2E_WEBUI_MANIFEST_SHA);
const captions=JSON.parse(await readFile(new URL("../../fixtures/i18n/compiled-quick-panel.json",import.meta.url),"utf8"));
assert(captions.en&&captions.zh&&captions.en!==captions.zh);

async function check(browser,locale,failStatus=false){
  const {app,observed,count}=quickPanelAdapter(assets,{locale,failStatus});
  const readyCount=new Intl.NumberFormat(locale).format(count);
  const context=await browser.newContext({serviceWorkers:"block",viewport:viewports.quickpanel,locale});
  const failures=[];
  try{
    await once(app.listen(0,"127.0.0.1"),"listening");
    const origin="http://127.0.0.1:"+app.address().port;
    await context.route("**/*",async route=>{
      if(new URL(route.request().url()).origin!==origin){
        failures.push("Unexpected external request");
        await route.abort();
      }else await route.continue();
    });
    const page=await context.newPage();
    page.on("pageerror",()=>failures.push("Page exception"));
    page.on("console",message=>{
      if(message.type()!=="error")return;
      const expectedFailure=failStatus&&message.location().url===origin+"/api/runtime-status"&&
        /failed to load resource/i.test(message.text());
      if(!expectedFailure)failures.push("Console error");
    });
    page.on("requestfailed",()=>failures.push("Failed asset or request"));
    page.on("response",response=>{
      if(response.status()>=400)failures.push(
        new URL(response.url()).pathname==="/api/runtime-status"?"Runtime status request failed":"Asset or request failed");
    });
    const path=origin+"/quickpanel.html";
    const status=page.waitForResponse(response=>response.url()===origin+"/api/runtime-status",{timeout:5000});
    const [loaded]=await Promise.all([status,page.goto(path)]);
    assert.equal(page.url(),path);
    const requireStatus=()=>assert.equal(loaded.status(),200,"Runtime status request failed");
    if(failStatus){
      assert.throws(requireStatus,/Runtime status request failed/);
      assert.equal(loaded.status(),503);
      await page.locator("#qp-body .qp-metrics").waitFor({state:"visible",timeout:5000});
      const values=await page.locator("#qp-body .qp-metrics .metric strong").allTextContents();
      assert(!values.includes(readyCount),"Failed status must not yield the ready count");
      assert.deepEqual(failures,["Runtime status request failed"]);
      assert(observed.state>=1&&observed.status>=1);
      assert.equal(observed.denied,0);
      return;
    }
    requireStatus();
    const metric=page.locator("#qp-body .qp-metrics .metric").filter({has:page.getByText(captions[locale],{exact:true})});
    await metric.waitFor({state:"visible",timeout:5000});
    assert.equal(await metric.count(),1,"Expected one exact loaded localized metric");
    assert.equal(await metric.locator("strong").innerText(),readyCount);
    assert.equal(await page.locator("html").getAttribute("lang"),locale==="zh"?"zh-CN":"en");
    await page.evaluate(()=>document.fonts.ready.then(()=>{}));
    const stock=await page.evaluate(measureLayout);
    assert.deepEqual(stock.issues,[],"Stock layout issues");
    const shellIssues=await page.evaluate(()=>{
      const issues=[];
      for(const button of document.querySelectorAll("header button,footer button")){
        if(!button.getClientRects().length)continue;
        const rect=button.getBoundingClientRect();
        if(rect.left< -1||rect.right>document.documentElement.clientWidth+1||
          button.scrollWidth>button.clientWidth+1||button.scrollHeight>button.clientHeight+1)
          issues.push("Quick Panel shell control clipped or out of bounds");
      }
      return issues;
    });
    assert.deepEqual(shellIssues,[]);
    assert.equal(await page.locator("#notice.error:not([hidden])").count(),0);
    const deadline=Date.now()+1000;
    while(observed.resize===0&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
    assert(observed.state>=1&&observed.status>=1&&observed.resize>=1,"Missing actual bridge requests");
    assert.equal(observed.denied,0,"Unexpected bridge requests");
    assert.deepEqual(failures,[]);
    console.log("PASS COMPILED WEBUI + MOCK RUNTIME quickpanel "+locale+" 560x520");
  }finally{
    try{await context.close();}finally{
      if(app.listening){app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
    }
  }
}
const browser=await driver.launch({executablePath});
try{
  for(const locale of ["en","zh"])await check(browser,locale);
  await check(browser,"en",true);
  console.log("PASS compiled quickpanel failed-status guard (negative; not a layout case)");
}finally{await browser.close();}
