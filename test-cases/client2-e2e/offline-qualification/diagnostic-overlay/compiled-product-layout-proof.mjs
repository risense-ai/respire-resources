import assert from "node:assert/strict";
import {measureLayout,viewports} from "./layout.mjs";

// Supplements (never replaces) the stock desktop checks on product surfaces
// outside main, e.g. Quick Panel, onboarding, and the actual members dialog.
export function measureProductSurface({selector,name}){
  const root=document.documentElement,surface=document.querySelector(selector);
  const issues=[], details=[];
  const finiteMetric = x => Number.isFinite(x) && Math.abs(x) <= 99999;
  const note = (issue, role, ...values) => {
    issues.push(issue);
    if(details.length<6)details.push({issue,role,values:values.every(finiteMetric)?values.map(x=>Math.round(x*10)/10):[]});
  };
  if(!surface || !surface.getClientRects().length)return {issues:["missing product surface"],details:[{issue:"missing product surface",role:"surface",values:[]}],fontSize:NaN};
  if(root.scrollWidth>root.clientWidth+1||surface.scrollWidth>surface.clientWidth+1){
    note("horizontal overflow","surface",root.scrollWidth,root.clientWidth,surface.scrollWidth,surface.clientWidth);
    if(name==="overview"){
      const bounds=surface.getBoundingClientRect(), width=surface.clientWidth;
      const candidates=[
        ["summary","[data-overview-summary]"],["stats","[data-overview-stats]"],
        ["details","[data-overview-details]"],["runtime","[data-runtime-status]"],
        ["onboarding","[data-overview-onboarding]"],
        ...["one","two","three","four"].map((role,index)=>[
          "metric-"+role+"-note","[data-overview-summary] .metric:nth-child("+(index+1)+") > small"
        ])
      ];
      const measured=candidates.flatMap(([role,path])=>{
        const el=surface.querySelector(path);
        if(!el||!el.getClientRects().length)return [];
        const box=el.getBoundingClientRect();
        const range=document.createRange();
        range.selectNodeContents(el);
        const right=box.right-bounds.left, textRight=range.getBoundingClientRect().right-bounds.left;
        const extent=Math.max(right,textRight,el.scrollWidth+box.left-bounds.left);
        return extent>width+1?[{role,extent,values:[el.clientWidth,el.scrollWidth,right,textRight]}]:[];
      });
      measured.sort((a,b)=>(b.extent-a.extent)||Number(b.role.startsWith("metric"))-Number(a.role.startsWith("metric")));
      for(const {role,values} of measured.slice(0,2)){
        // Diagnostic only; preserve the exact original issue count and verdict.
        if(values.every(finiteMetric))details.push({issue:"horizontal overflow",role,values:values.map(x=>Math.round(x*10)/10)});
      }
    }
  }
  if(/\bNaN\b|\[\[[^\]]+\]\]|\{\{[^}]+\}\}/.test(surface.innerText))note("unresolved visible string or invalid number","surface");
  for(const control of surface.querySelectorAll("button,select,input,textarea,[data-layout-icon]")){
    if(!control.getClientRects().length)continue;
    const box=control.getBoundingClientRect();
    const role=["BUTTON","SELECT","INPUT","TEXTAREA"].includes(control.tagName)?control.tagName.toLowerCase():"icon";
    if(box.left < -1||box.right>root.clientWidth+1||box.width<=0||box.height<=0)note("control bounds",role,box.left,box.right,box.width,box.height,root.clientWidth);
    if(control.matches("button")&&(control.scrollWidth>control.clientWidth+1||control.scrollHeight>control.clientHeight+1))note("clipped button",role,control.scrollWidth,control.clientWidth,control.scrollHeight,control.clientHeight);
    const icon=control.querySelector("svg,[data-layout-icon]");
    if(icon){
      const mark=icon.getBoundingClientRect();
      if(Math.abs((mark.top+mark.bottom-box.top-box.bottom)/2)>2)note("misaligned control icon",role,(mark.top+mark.bottom-box.top-box.bottom)/2);
    }
  }
  const fontSize=parseFloat(getComputedStyle(root).fontSize);
  if(!Number.isFinite(fontSize)||fontSize<14||fontSize>18.81)note("root font outside rem scale","surface",fontSize);
  return {issues,details,fontSize};
}

// The stock checker includes control IDs or text in two messages. Never
// put those suffixes into diagnostic metadata: use only fixed categories.
export function stockLayoutDiagnostic(size, issues) {
  const known = new Set(["horizontal overflow", "misaligned control icon", "root font outside rem scale"]);
  if (!((size?.width === 1440 && size?.height === 900) ||
        (size?.width === 1024 && size?.height === 768))) return undefined;
  const details = [];
  for (const value of issues) {
    const classified = (
      value === "visible invalid number or unresolved translation" ? "unresolved visible string or invalid number" :
      typeof value === "string" && value.startsWith("out-of-bounds control: ") ? "control bounds" :
      typeof value === "string" && value.startsWith("clipped button: ") ? "clipped button" :
      known.has(value) ? value : null
    );
    if (classified && !details.some(item => item.issue === classified))
      details.push({issue:classified,role:"surface",values:[]});
  }
  return {size:{width:size.width,height:size.height},details};
}

// Match the stock clipped-button predicate exactly, exporting only a
// bounded ordinal and four geometry values. Never read a name or text.
export function measureStockClippedControls() {
  const result=[];
  const controls=document.querySelectorAll("main button, main select, main input, main textarea, [data-layout-icon]");
  for(let i=0;i<controls.length&&i<1024&&result.length<3;i++){
    const control=controls[i];
    if(!control.getClientRects().length||!control.matches("button"))continue;
    const {scrollWidth,clientWidth,scrollHeight,clientHeight}=control;
    if(scrollWidth>clientWidth+1||scrollHeight>clientHeight+1){
      const values=[i+1,scrollWidth,clientWidth,scrollHeight,clientHeight];
      if(values.every(value=>Number.isInteger(value)&&value>=0&&value<=99999))
        result.push({issue:"clipped button",role:control.matches("button.memory-title[data-select]")?"memory-title":
          control.matches("button.tree-toggle[data-expand]")?"tree-toggle":
          control.matches("button[data-search-submit]")?"search-button":
          control.closest?.(".memory-toolbar")?"toolbar":"button",values});
    }
  }
  return result;
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
            try {
              assert.equal(stock.issues.length,0,"Stock layout checks found an issue");
            } catch(error) {
              error.productLayout = stockLayoutDiagnostic(size,stock.issues);
              if(name==="workspace"&&size.width===1024&&size.height===768&&
                  error.productLayout?.details.some(x=>x.issue==="clipped button")){
                try{
                  const controls=await page.evaluate(measureStockClippedControls);
                  if(controls.length)error.productLayout.details=[
                    ...controls,...error.productLayout.details.filter(x=>x.issue!=="clipped button")
                  ].slice(0,3);
                }catch{/* Preserve the original stock failure. */}
              }
              throw error;
            }
          }
          const product=await page.evaluate(measureProductSurface,{selector:surface,name});
          try {
            assert.equal(product.issues.length,0,"Product surface layout checks found an issue");
          } catch(error) {
            error.productLayout = {size, details:product.details};
            throw error;
          }
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
