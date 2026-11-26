import assert from "node:assert/strict";
import {once} from "node:events";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {isAbsolute} from "node:path";
import {createRequestDiagnostics,optionalWailsStartupAbort} from "./request-diagnostics.mjs";
import {measureLayout,viewports} from "../layout.mjs";
import {quickPanelAdapter,requestID,verifyWebUIBundle} from "./quick-panel-adapter.mjs";
import {accountName,agentMode,dataDir,diaryDay,diaryTitle,grantName,injectionTarget,localUser,mainSpace,memberName,marker,modelWeight,needle,sessionSource,settingsTheme,verifyWailsRuntime} from "./workspace-mock.mjs";

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
const {statsMetric:statLabels,organizeState:organizeLabels}=captions;
const surfaces=["overview","workspace","recall","diary","accounts","storage","settings","grants","space-members","injection","stats","wizard","organize","session-import","models"];
for(const surface of surfaces)assert(captions[surface]?.en&&captions[surface]?.zh&&captions[surface].en!==captions[surface].zh);
const errorSelector="#notice.error:not([hidden]),[data-runtime-error]:not([hidden]):not(:empty),.danger-text,.form-error";

async function check(browser,surface,locale){
  const {app,observed,count,operations,receipts,deniedRequests}=quickPanelAdapter(assets,{locale,surface,wails});
  const context=await browser.newContext({serviceWorkers:"block",viewport:viewports.desktop,locale,timezoneId:"UTC"});
  const failures=[];
  let layoutDiagnostic=[];
  let phase="start",checkpoint="boot";
  const record=code=>{if(failures.length<8)failures.push(code);};
  try{
    await once(app.listen(0,"127.0.0.1"),"listening");
    const origin="http://127.0.0.1:"+app.address().port;
    const optional=origin+"/wails/custom.js";
    const classifyFailedRequest=createRequestDiagnostics(origin,assets);
    const memory=["workspace","recall"].includes(surface);
    const settings=["storage","settings"].includes(surface);
    const members=surface==="space-members";
    const overview=settings||surface==="stats"||surface==="wizard";
    const route=overview?"overview":memory?"memories":members?"accounts":surface;
    await context.route("**/*",async request=>{
      if(new URL(request.request().url()).origin!==origin){
        record("external-origin");
        await request.abort();
      }else await request.continue();
    });
    const page=await context.newPage();
    if(["diary","stats"].includes(surface))await page.clock.setFixedTime(new Date(diaryDay+"T12:00:00Z"));
    page.on("pageerror",()=>record("page-exception"));
    page.on("console",message=>{
      if(message.type()!=="error")return;
      if(message.location().url===optional&&/failed to load resource/i.test(message.text()))return;
      record("console-error");
    });
    let optionalStartupAbort=false;
    page.on("requestfailed",request=>{
      if(optionalWailsStartupAbort(request,origin,phase,optionalStartupAbort)){
        optionalStartupAbort=true;
        return;
      }
      record("request-failed:"+phase+":"+classifyFailedRequest(request));
    });
    page.on("response",response=>{
      if(response.status()>=400&&!(response.status()===404&&response.url()===optional&&
        response.request().method()==="HEAD"))record(requestID(response.request().method(),new URL(response.url()).pathname)+":"+response.status());
    });
    const url=origin+"/workspace.html#"+route;
    const runtime=page.waitForResponse(response=>response.url()===origin+"/wails/runtime.js",{timeout:5000});
    phase="navigation";
    const [runtimeResponse]=await Promise.all([runtime,page.goto(url)]);
    assert.equal(runtimeResponse.status(),200);
    assert.equal(page.url(),url);
    phase="readiness";
    const view=page.locator("#view .view-page");
    if(settings){
      await page.waitForFunction(({text})=>document.querySelector("[data-overview-summary] .metric strong")?.textContent===text,
        {text:new Intl.NumberFormat(locale).format(count)});
      await page.locator('nav [data-page="settings"]').click();
      assert.equal(page.url(),origin+"/workspace.html#settings");
    }
    const dialog=page.locator("dialog[open]");
    const wizard=page.locator("#onboarding:not([hidden])");
    const stats=view.locator("[data-overview-stats]");
    if(members){
      const current=view.locator("[data-spaces] .row strong").filter({hasText:mainSpace});
      await current.waitFor({state:"visible",timeout:5000});
      assert.equal(await current.count(),1);
      await view.locator('button[data-space="members"]').click();
      await dialog.waitFor({state:"visible",timeout:5000});
      assert.equal(await dialog.count(),1);
    }
    const storage=view.locator('section:has(input[name="dir"])');
    const title=surface==="storage"?storage.locator("h2"):members?dialog.locator(".dialog-heading h2"):
      surface==="wizard"?wizard.locator(".wizard-body h1"):
      surface==="stats"?stats.locator(".page-heading h2"):
      view.locator(surface==="settings"?".page-heading h1":"h1");
    if(surface==="models"){
      await view.locator("[data-advanced-open] button").click();
      await view.locator("[data-advanced-panel]:not([hidden])").waitFor({state:"visible",timeout:5000});
    }
    const item=view.locator(".memory-title[data-select]").filter({hasText:marker});
    if(surface==="recall"){
      await item.waitFor({state:"visible",timeout:5000});
      const search=view.locator("input[data-search]");
      await search.fill(needle);
      await search.press("Enter");
    }
    let fontSize;
    for(const size of [viewports.desktop,viewports.desktopSmall]){
      phase=size.width===1440?"desktop":"desktop-small";
      await page.setViewportSize(size);
      checkpoint="language";
      assert.equal(await page.locator("html").getAttribute("lang"),locale==="zh"?"zh-CN":"en");
      checkpoint="caption";
      const caption=surface==="recall"?view.locator("button[data-clear-search]"):title;
      if(surface==="settings"){
        await page.waitForFunction(({text})=>
          document.querySelector("#view .view-page .page-heading h1")?.textContent.trim()===text,
          {text:captions[surface][locale]},{timeout:5000});
      }
      await caption.waitFor({state:"visible",timeout:5000});
      assert.equal(await caption.count(),1);
      assert.equal((await caption.innerText()).trim(),captions[surface][locale]);
      checkpoint="loaded-data";
      if(surface==="overview"){
        const metric=view.locator("[data-overview-summary] .metric").first().locator("strong");
        await page.waitForFunction(({text})=>document.querySelector("[data-overview-summary] .metric strong")?.textContent===text,
          {text:new Intl.NumberFormat(locale).format(count)});
        assert.equal(await metric.innerText(),new Intl.NumberFormat(locale).format(count));
      }else if(memory){
        await item.waitFor({state:"visible",timeout:5000});
        assert.equal(await item.count(),1);
        assert.equal(await item.innerText(),marker);
        assert.equal(await view.locator("button[data-clear-search]").isVisible(),surface==="recall");
        assert(operations.has(surface==="recall"?"memory_search":"memory_list"),"Missing actual typed data request");
      }else if(surface==="diary"){
        const day=view.locator('button.calendar-day.has-entries[data-day="'+diaryDay+'"]');
        const entry=view.locator('[data-entries] button[data-entry="day-'+diaryDay+'"]');
        await day.waitFor({state:"visible",timeout:5000});
        assert.equal(await day.count(),1);
        await entry.waitFor({state:"visible",timeout:5000});
        assert.equal(await entry.innerText(),diaryTitle);
        assert(operations.has("diary_list"),"Missing actual Diary load");
      }else if(surface==="accounts"){
        for(const [selector,expected] of [["[data-accounts] .row strong",accountName],
          ["[data-spaces] .row strong",mainSpace],["[data-session-field=user]",localUser]]){
          const value=view.locator(selector);
          await page.waitForFunction(({selector,expected})=>document.querySelector(selector)?.textContent===expected,
            {selector,expected},{timeout:5000});
          assert.equal(await value.count(),1);
          assert.equal(await value.innerText(),expected);
        }
        assert(operations.has("account_list")&&operations.has("space_list"),"Missing actual Account and Space reads");
      }else if(surface==="stats"){
        const metric=stats.locator("[data-body] .metrics .metric").first();
        await metric.waitFor({state:"visible",timeout:5000});
        assert.equal(await metric.locator("span").innerText(),statLabels[locale]);
        assert.equal(await metric.locator("strong").innerText(),"1");
        const row=stats.locator("[data-body] table tbody tr");
        await row.waitFor({state:"visible",timeout:5000});
        assert.deepEqual(await row.locator("td").allTextContents(),[diaryDay,"1","1","0","0"]);
        assert(operations.has("query_log"),"Missing actual scoped Stats load");
      }else if(surface==="wizard"){
        await wizard.locator('.wizard-step[aria-current="step"]').waitFor({state:"visible",timeout:5000});
        assert.equal(await wizard.locator("button[data-choice]").count(),2);
        assert.equal(await wizard.locator("button[data-next-sync]").isEnabled(),false);
        assert(observed.state>=1&&observed.status>=1,"Wizard must begin after the actual startup reads");
      }else if(surface==="organize"){
        const provider=view.locator('select[name="backend"]');
        await page.waitForFunction(()=>document.querySelector('select[name="backend"]')?.value==="jev",null,{timeout:5000});
        assert.equal(await provider.inputValue(),"jev");
        assert.equal((await view.locator("[data-provider-state]").innerText()).trim(),organizeLabels[locale]);
        assert(operations.has("classification_config"),"Missing actual Organize provider load");
      }else if(surface==="models"){
        const active=view.locator('[data-variants] button.active[data-engine="cpu"][data-variant="quantized"]');
        await active.waitFor({state:"visible",timeout:5000});
        assert.equal(await active.count(),1);
        const row=view.locator("[data-variants] tbody tr");
        assert.equal(await row.count(),1);
        assert.equal(await row.locator(".path-cell code").innerText(),modelWeight);
        assert.equal(await view.locator('[data-recall] select[name="mode"]').inputValue(),"quality");
        for(const read of ["agent_config","model_engine","classification_config","model_variants"])
          assert(operations.has(read),"Missing actual model configuration read");
      }else if(surface==="session-import"){
        const source=view.locator("[data-sources] .si-source").filter({hasText:sessionSource.name});
        await source.waitFor({state:"visible",timeout:5000});
        assert.equal(await source.count(),1);
        assert.equal(await source.locator("strong").innerText(),sessionSource.name);
        assert.equal(await source.locator('input[data-source="codex"]').isChecked(),true);
        assert.equal(await view.locator("[data-apply]").isEnabled(),false);
        assert(operations.has("session_import_targets"),"Missing actual Session Import discovery");
      }else if(surface==="grants"||members||surface==="injection"){
        const [locator,text,read]=surface==="grants"
          ? [view.locator("[data-grants] .row strong"),grantName,"grant_list"]
          : members
            ? [dialog.locator("[data-members] .row strong"),memberName,"space_members"]
            : [view.locator("[data-agents] .ag-name strong"),injectionTarget.name,"inject_targets"];
        const witness=locator.filter({hasText:text});
        await witness.waitFor({state:"visible",timeout:5000});
        assert.equal(await witness.count(),1);
        assert.equal(await witness.innerText(),text);
        assert(operations.has(read),"Missing actual positive surface load");
        if(surface==="injection")assert.equal(await view.locator("[data-mode]").inputValue(),"readonly");
      }else if(settings){
        const data=storage.locator('input[name="dir"]');
        await data.waitFor({state:"visible",timeout:5000});
        assert.equal(await data.count(),1);
        assert.equal(await data.inputValue(),dataDir);
        await page.waitForFunction(({value})=>document.querySelector('select[name="workspace"]')?.value===value,
          {value:agentMode.workspace_mode},{timeout:5000});
        const mode=view.locator('[data-pref="theme"]');
        assert.equal(await mode.inputValue(),settingsTheme);
        assert.equal(await page.locator("html").getAttribute("data-theme"),settingsTheme);
        assert.equal(await view.locator('select[name="diary"]').inputValue(),agentMode.diary_mode);
        assert(operations.has("agent_config"),"Missing actual Settings configuration load");
      }
      checkpoint="layout-fonts";
      await page.evaluate(()=>document.fonts.ready.then(()=>{}));
      checkpoint="stock-layout";
      const stock=await page.evaluate(measureLayout);
      if(surface==="models"&&stock.issues.length>0){
        layoutDiagnostic=await page.evaluate(()=>{
          const root=document.documentElement;
          const issues=[];
          if(root.scrollWidth>root.clientWidth+1)issues.push({kind:"horizontal-overflow"});
          const groups=["[data-mode-select]","[data-variants]","[data-recall]","[data-status-card]","[data-primary-action]",
            "[data-advanced]","[data-mode-selector]",".page-heading",".panel"];
          for(const [index,control] of Array.from(document.querySelectorAll(
            "main button, main select, main input, main textarea, [data-layout-icon]")).entries()){
            if(!control.getClientRects().length)continue;
            const box=control.getBoundingClientRect();
            const bounds=box.left< -1||box.right>root.clientWidth+1||box.width<=0||box.height<=0;
            const clipped=control.matches("button")&&(control.scrollWidth>control.clientWidth+1||
              control.scrollHeight>control.clientHeight+1);
            const icon=control.querySelector("svg,[data-layout-icon]")?.getBoundingClientRect();
            const align=icon&&Math.abs((icon.top+icon.bottom-box.top-box.bottom)/2)>2;
            if(bounds||clipped||align)issues.push({index,tag:control.tagName,
              group:groups.find(selector=>control.closest(selector))??"unclassified",
              kind:bounds?"control-bounds":clipped?"button-clipping":"icon-alignment",
              contentWidth:control.scrollWidth,width:control.clientWidth,
              contentHeight:control.scrollHeight,height:control.clientHeight});
          }
          return issues.slice(0,8);
        });
        for(const code of ["visible invalid number or unresolved translation","root font outside rem scale"]){
          if(stock.issues.includes(code))layoutDiagnostic.push({kind:code});
        }
      }
      assert.deepEqual(stock.issues,[],"Stock layout issues");
      if(members||surface==="wizard"){
        const outside=members?dialog:wizard;
        const issues=await outside.evaluate(element=>{
          const issues=[], width=document.documentElement.clientWidth;
          if(element.scrollWidth>element.clientWidth+1)issues.push("dialog has horizontal overflow");
          for(const control of element.querySelectorAll("button, input, select, textarea")){
            if(!control.getClientRects().length)continue;
            const box=control.getBoundingClientRect();
            if(box.left< -1||box.right>width+1||box.width<=0||box.height<=0)issues.push("dialog control bounds");
            if(control.matches("button")&&(control.scrollWidth>control.clientWidth+1||
                control.scrollHeight>control.clientHeight+1))issues.push("dialog control clipping");
            const icon=control.querySelector("svg,[data-layout-icon]");
            if(icon){
              const mark=icon.getBoundingClientRect();
              if(Math.abs((mark.top+mark.bottom-box.top-box.bottom)/2)>2)issues.push("dialog icon alignment");
            }
          }
          if(element.querySelector(".form-error:not([hidden]):not(:empty)"))issues.push("dialog error");
          return issues;
        });
        assert.deepEqual(issues,[]);
      }
      if(fontSize!==undefined)assert(stock.fontSize<fontSize,"Expected fluid root rem scaling");
      fontSize=stock.fontSize;
      checkpoint="app-errors";
      assert.equal(await view.locator(errorSelector).count(),0,"Application error notice");
      assert.equal(await page.locator("#notice.error:not([hidden])").count(),0);
    }
    phase="terminal";
    checkpoint="acknowledgement";
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
      surface,locale,phase,checkpoint,counts,receipts:receipts(),denied:deniedRequests,events:failures,layout:layoutDiagnostic,
    }));
    throw error;
  }finally{
    try{await context.close();}finally{
      if(app.listening){app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
    }
  }
}

const browser=await driver.launch({executablePath});
const failed=[];
try{
  for(const surface of surfaces)for(const locale of ["en","zh"]){
    try{await check(browser,surface,locale);}
    catch{
      failed.push(surface+"/"+locale);
      console.error("FAIL COMPILED WEBUI + MOCK RUNTIME "+surface+" "+locale);
    }
    assert.equal(browser.contexts().length,0,"Do not start another case with a retained browser context");
  }
}finally{await browser.close();}
assert.deepEqual(failed,[],"All independently run workspace layout scenarios must pass");
