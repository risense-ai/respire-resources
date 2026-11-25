import {win32} from "node:path";
import {bindOwnedWailsOperations} from "./owned-wails-operation.mjs";
import assert from "node:assert/strict";
import {bindCompiledLayoutProof} from "./compiled-product-layout-proof.mjs";

const scopeFields=["instance_id","account_id","generation"];
const selection="#view .view-page";
const markerText="CARD018 synthetic pocket diary witness";

export function validateDiaryAccountsIndependent({kind,owner,receipt}){
  for(const key of [...scopeFields,"pid","runtimeDigest","desktopDigest","source"])assert.equal(receipt?.owner?.[key],owner[key]);
  if(kind==="diary"){
    assert.match(receipt.day??"",/^\d{4}-\d{2}-\d{2}$/);
    assert.equal(receipt.localDay,receipt.day);
    const {typed,legacy}=receipt;
    assert(typed?.length===1&&legacy?.length===1);
    const a=typed[0], b=legacy[0];
    assert.match(a.id??"",/^[A-Za-z0-9-]{12,128}$/);
    assert.equal(a.content,markerText);
    assert.deepEqual([a.id,a.date,a.content],[b.id,b.day,b.content]);
    assert.equal(a.date,receipt.day);
    assert(typeof b.title==="string"&&b.title.trim());
    return {id:a.id,day:a.date,title:b.title,content:a.content};
  }
  assert.equal(kind,"accounts");
  assert.equal(receipt.legacyUser,"runtime-smoke");
  assert.equal(receipt.hostUser,receipt.legacyUser);
  assert.equal(receipt.typedSpace,"main");
  assert.match(receipt.sessionHash??"",/^[0-9a-f]{64}$/);
  assert.equal(receipt.oneOwnedMainProfile,true);
  return {user:receipt.hostUser,space:receipt.typedSpace,sessionHash:receipt.sessionHash};
}

async function readState(page,origin,owner,locale){
  const url=origin+"/api/state";
  const r=await page.request.get(url,{maxRedirects:0,timeout:4000});
  assert(r.url()===url&&r.status()===200&&r.headers()["x-card018-issuer"]===owner.issuer);
  const state=(await r.json()).result;
  assert.equal(state.connected,true);
  assert.equal(state.preferences?.language,locale);
  assert.equal(state.health.image_sha256,owner.runtimeDigest);
  for(const key of [...scopeFields,"pid"])assert.equal(state.health?.[key],owner[key]);
}

export async function observeDiaryAccounts({page,origin,owner,kind,locale,localized,readIndependent,fixturePath=process.env.CARD018_RUNTIME_DATA}){
  assert.match(origin,/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  assert(["en","zh"].includes(locale)&&["diary","accounts"].includes(kind));
  const before=await readIndependent();
  const marker=validateDiaryAccountsIndependent({kind,owner,receipt:before});
  const layout=bindCompiledLayoutProof(page);
  const normalize=path=>{
    assert(typeof path==="string"&&/^(?:\\\\\?\\)?[A-Za-z]:[\\/]/.test(path));
    return win32.normalize(path.startsWith("\\\\?\\")?path.slice(4):path).toLowerCase();
  };
  const specs=kind==="diary"?(()=>{
    const day=marker.day, year=Number(day.slice(0,4)),month=Number(day.slice(5,7));
    const end=new Date(Date.UTC(year,month,0)).getUTCDate().toString().padStart(2,"0");
    return [{name:"diary_list",args:{from:day.slice(0,8)+"01",to:day.slice(0,8)+end},authority:"runtime",verify:envelope=>{
      assert.equal(envelope.summary?.count,1);
      assert.deepEqual(envelope.details?.map(x=>[x.id,x.day,x.title,x.content]),
        [[marker.id,marker.day,marker.title,marker.content]]);
    }}];
  })():["account_list","space_list"].map(name=>({name,args:{},authority:"host",verify:envelope=>{
    const root=normalize(fixturePath);
    assert.equal(normalize(envelope.summary?.current_dir),root);
    const rows=envelope.summary?.[name==="account_list"?"accounts":"spaces"];
    assert.deepEqual(rows?.map(x=>[x.name,x.user,x.current,normalize(x.dir)]),[["main",marker.user,true,root]]);
  }}));
  const receipt=bindOwnedWailsOperations(page,{origin,issuer:owner.issuer,owner,specs});
  try{
    const done=page.waitForResponse(response=>receipt.accept(response),{timeout:8000});
    const nav=page.goto(origin+"/workspace.html#"+kind).then(response=>{
      assert.equal(response.headers()["x-card018-issuer"],owner.issuer);
    });
    await Promise.all([nav,done]);
    await readState(page,origin,owner,locale);
    const present=async()=>{
      const view=page.locator(selection);
      const fields=kind==="diary"?[[`[data-entry="${marker.id}"]`,marker.title]]:
        [["[data-session-field=user]",marker.user],["[data-accounts] .row strong","main"],["[data-spaces] .row strong","main"]];
      for(const [selector,txt] of fields){
        const item=view.locator(selector);
        await item.waitFor({state:"visible"});
        assert.equal(await item.count(),1);
        assert.equal((await item.innerText()).trim(),txt);
      }
    };
    await layout.check({name:kind,locale,surface:selection,localized,checkLoaded:present});
    await readState(page,origin,owner,locale);
  }finally{
    receipt.dispose();
    layout.dispose();
    const after=await readIndependent();
    assert.deepEqual(validateDiaryAccountsIndependent({kind,owner,receipt:after}),marker);
  }
}
