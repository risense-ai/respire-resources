import assert from "node:assert/strict";
import {measureLayout,viewports} from "./layout.mjs";

// Supplements (never replaces) the stock desktop checks on product surfaces
// outside main, e.g. Quick Panel, onboarding, and the actual members dialog.
export function measureProductSurface({selector}){
  const root=document.documentElement,surface=document.querySelector(selector);
  const issues=[];
  if(!surface || !surface.getClientRects().length)return {issues:["missing product surface"],fontSize:NaN};
  if(root.scrollWidth>root.clientWidth+1||surface.scrollWidth>surface.clientWidth+1)issues.push("horizontal overflow");
  if(/\bNaN\b|\[\[[^\]]+\]\]|\{\{[^}]+\}\}/.test(surface.innerText))issues.push("unresolved visible string or invalid number");
  for(const control of surface.querySelectorAll("button,select,input,textarea,[data-layout-icon]")){
    if(!control.getClientRects().length)continue;
    const box=control.getBoundingClientRect();
    if(box.left < -1||box.right>root.clientWidth+1||box.width<=0||box.height<=0)issues.push("control bounds");
    if(control.matches("button")&&(control.scrollWidth>control.clientWidth+1||control.scrollHeight>control.clientHeight+1))issues.push("clipped button");
    const icon=control.querySelector("svg,[data-layout-icon]");
    if(icon){
      const mark=icon.getBoundingClientRect();
      if(Math.abs((mark.top+mark.bottom-box.top-box.bottom)/2)>2)issues.push("misaligned control icon");
    }
  }
  const fontSize=parseFloat(getComputedStyle(root).fontSize);
  if(!Number.isFinite(fontSize)||fontSize<14||fontSize>18.81)issues.push("root font outside rem scale");
  return {issues,fontSize};
}

export function bindCompiledLayoutProof(page){
  let errorCount=0;
  const pageError=()=>{errorCount++;};
  const consoleError=message=>{if(message.type()==="error")errorCount++;};
  page.on("pageerror",pageError);
  page.on("console",consoleError);
  const failedAsset=request=>{
    if(["document","script","stylesheet","image","font"].includes(request.resourceType()))errorCount++;
  };
  const badAsset=response=>{
    if(response.status()>=400)failedAsset(response.request());
  };
  page.on("response",badAsset);
  page.on("requestfailed",failedAsset);
  const dispose=()=>{
    page.off("pageerror",pageError);
    page.off("console",consoleError);
    page.off("response",badAsset);
    page.off("requestfailed",failedAsset);
  };
  return {
    dispose,
    // Caller first completes source-bound loaded-data proof and then supplies an
    // independent expected localized control/heading; language alone is not a witness.
    async check({name,locale,surface,localized,checkLoaded,keepOpen=false}){
      assert(["en","zh"].includes(locale)&&typeof checkLoaded==="function");
      assert(localized?.selector&&localized.text?.trim(),"Expected a screen-specific localized witness");
      const sizes=name==="quickpanel"?[viewports.quickpanel]:[viewports.desktop,viewports.desktopSmall];
      let previous;
      try{
        for(const size of sizes){
          await page.setViewportSize(size);
          await checkLoaded();
          assert.equal(await page.locator("html").getAttribute("lang"),locale==="zh"?"zh-CN":"en");
          const text=page.locator(surface).locator(localized.selector);
          await text.waitFor({state:"visible"});
          assert.equal(await text.count(),1,"Localized witness ambiguous");
          assert.equal((await text.innerText()).trim(),localized.text);
          await page.evaluate(()=>document.fonts.ready.then(()=>{}));
          if(name!=="quickpanel"){
            const stock=await page.evaluate(measureLayout);
            assert.equal(stock.issues.length,0,"Stock layout checks found an issue");
          }
          const product=await page.evaluate(measureProductSurface,{selector:surface});
          assert.equal(product.issues.length,0,"Product surface layout checks found an issue");
          assert(Number.isFinite(product.fontSize));
          if(previous!==undefined)assert(product.fontSize<previous,"Small viewport must reduce root rem size");
          previous=product.fontSize;
          assert.equal(errorCount,0,"Compiled page emitted an error");
        }
      }finally{
        if(!keepOpen)dispose();
      }
    }
  };
}
