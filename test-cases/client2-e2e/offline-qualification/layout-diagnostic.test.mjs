import assert from "node:assert/strict";
import {copyFile,mkdir,mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {pathToFileURL} from "node:url";
import {runInNewContext} from "node:vm";
import {diagnosticLine} from "./diagnostic-overlay/card018-safe-diagnostic.mjs";

const here=import.meta.url;
async function installedProof(t){
  const scratch=await mkdtemp(join(tmpdir(),"card018-geometry-"));
  t.after(()=>rm(scratch,{recursive:true,force:true}));
  const layoutHome=join(scratch,"client2-e2e");
  await mkdir(layoutHome);
  await mkdir(join(scratch,"fixtures","i18n"),{recursive:true});
  await copyFile(new URL("../../fixtures/i18n/screens.json",here),join(scratch,"fixtures","i18n","screens.json"));
  for(const [src,dest] of [
    ["../layout.mjs","layout.mjs"],
    ["./diagnostic-overlay/compiled-product-layout-proof.mjs","compiled-product-layout-proof.mjs"],
  ])await copyFile(new URL(src,here),join(layoutHome,dest));
  return import(pathToFileURL(join(layoutHome,"compiled-product-layout-proof.mjs")).href);
}
function control({selectors=[],width=100,visible=true,within=true}={}){
  return {
    matches:selector=>selector==="button"||selectors.includes(selector),
    closest:()=>null,getClientRects:()=>visible?[{}]:[],
    scrollWidth:width,clientWidth:100,scrollHeight:29,clientHeight:29,within,
    get textContent(){throw Error("Reading a raw control label is forbidden");},
    get id(){throw Error("Reading a raw control id is forbidden");},
  };
}
function measure(fn,name,items){
  const document={
    querySelector:selector=>{
      assert.equal(selector,"#view .view-page");
      return {contains:el=>el.within};
    },
    querySelectorAll:selector=>{
      assert.equal(selector,"main button, main select, main input, main textarea, [data-layout-icon]");
      return items;
    },
  };
  return runInNewContext("(" + fn.toString() + ")({name,selector:'#view .view-page'})",{name,document});
}
test("clipped diagnostics identify only fixed Recall and Diary roles and bounded geometry",async t=>{
  const {measureStockClippedControls}=await installedProof(t);
  const checks=[
    ["recall","button.memory-title[data-select]","memory-title"],
    ["recall","button[data-clear-search]","recall-clear"],
    ["diary",".timeline-body button[data-entry]","diary-entry"],
    ["diary","button.calendar-day[data-day]","diary-day"],
    ["diary",".memory-toolbar button[data-prev],.memory-toolbar button[data-next],.memory-toolbar button[data-today]","diary-month"],
    ["diary",".memory-toolbar button[data-search]","diary-search"],
  ];
  for(const [name,selector,role] of checks){
    const details=measure(measureStockClippedControls,name,[
      control({selectors:[selector],width:120,visible:false}),
      control({selectors:[selector],width:101}),
      control({selectors:[selector],width:120}),
    ]);
    assert.equal(JSON.stringify(details),JSON.stringify([{issue:"clipped button",role,values:[3,120,100,29,29]}]));
    const output=diagnosticLine("browser-primary",{productLayout:{size:{width:1024,height:768},details}});
    assert(output.endsWith(" layout=1024x768 clipped:"+role+",3,120,100,29,29"));
  }
  const shared=control({selectors:["button.calendar-day[data-day]"],width:124,within:false});
  const clipped=measure(measureStockClippedControls,"diary",Array(6).fill(shared));
  assert.equal(clipped.length,3);
  assert(clipped.every(x=>x.role==="shared-button"));
  const untrusted={issue:"clipped button",role:"private-marker",values:[1,200,100,29,29]};
  assert(!diagnosticLine("browser-primary",{productLayout:{size:{width:1024,height:768},
    details:[untrusted]}}).includes("private-marker"));
});
test("diagnostic enrichment preserves exact stock failure and never certifies a screen",async t=>{
  const {bindCompiledLayoutProof}=await installedProof(t);
  for(const [name,role] of [["recall","memory-title"],["diary","diary-entry"]]){
    for(const enrich of [true,false]){
      let width=0, calls=0;
      const text={waitFor:async()=>{},count:async()=>1,innerText:async()=>"Synthetic caption"};
      const page={
        on(){},off(){},
        setViewportSize:async size=>{width=size.width;},
        locator:()=>({getAttribute:async()=>"zh-CN",locator:()=>text}),
        evaluate:async(fn,arg)=>{
          switch(fn.name){
            case "measureLayout":
              return {issues:width===1024?["clipped button: PRIVATE_TITLE"]:[]};
            case "measureProductSurface":
              assert.equal(width,1440,"stock failure must prevent product verdict at 1024");
              return {fontSize:16,issues:[]};
            case "measureStockClippedControls":
              calls++;
              assert.deepEqual(arg,{name,selector:"#view .view-page"});
              if(!enrich)throw Error("diagnostic unavailable");
              return [{issue:"clipped button",role,values:[2,120,100,29,29]}];
            default:return undefined;
          }
        },
      };
      await assert.rejects(bindCompiledLayoutProof(page).check({name,locale:"zh",surface:"#view .view-page",
        localized:{selector:"h1",text:"Synthetic caption"},checkLoaded:async()=>{}}),error=>{
        assert.equal(error.message,"Stock layout checks found an issue\n\n1 !== 0\n");
        assert.equal(error.productLayout.details[0].role,enrich?role:"surface");
        assert(!diagnosticLine("browser-primary",error).includes("PRIVATE_TITLE"));
        assert.equal(calls,1);
        return true;
      });
    }
  }
});
