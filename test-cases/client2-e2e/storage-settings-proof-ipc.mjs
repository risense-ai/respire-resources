import assert from "node:assert/strict";
import {validateSettingsWitness} from "./compiled-storage-settings-observer.mjs";

const identityFields=["account_id","desktopDigest","generation","instance_id","pid","runtimeDigest","source"];
function only(value,fields){assert.deepEqual(Object.keys(value).sort(),[...fields].sort());}

export async function serveStorageSettingsProof({frames,send,close,owner,expectedLocale,expectedIssuer,fixturePath,readIndependent}){
  const iter=frames[Symbol.asyncIterator]();
  async function receive(){
    const r=await iter.next();assert.equal(r.done,false,"Unexpected storage/settings pipe EOF");return r.value;
  }
  const pinned={...owner,issuer:expectedIssuer};
  const validate=witness=>validateSettingsWitness({owner:pinned,locale:expectedLocale,fixturePath,witness});
  // Forward only exact test projections, not raw product configuration or errors.
  const project=witness=>({owner:Object.fromEntries(identityFields.map(k=>[k,witness.owner[k]])),
    runtimePath:witness.runtimePath,realRuntimePath:witness.realRuntimePath,
    preferences:{language:witness.preferences.language,theme:witness.preferences.theme,proxyMode:witness.preferences.proxyMode},
    agent:{workspace_mode:witness.agent.workspace_mode,diary_mode:witness.agent.diary_mode}});
  try{
    const hello=await receive();
    only(hello,["kind","owner","issuer","locale"]);
    only(hello.owner,identityFields);
    assert.equal(hello.kind,"hello");
    assert.equal(hello.issuer,expectedIssuer);
    assert.equal(hello.locale,expectedLocale);
    for(const k of identityFields)assert.equal(hello.owner[k],owner[k]);
    const before=await readIndependent();
    const expected=validate(before);
    await send({kind:"before",snapshot:project(before)});
    const request=await receive();
    only(request,["kind","ok"]);
    assert.equal(request.kind,"after");
    assert.equal(typeof request.ok,"boolean");
    const after=await readIndependent();
    assert.deepEqual(validate(after),expected);
    assert.equal(after.runtimePath,before.runtimePath);
    await send({kind:"after",verified:true,snapshot:project(after)});
    assert.equal((await iter.next()).done,true,"Duplicate storage/settings proof frame");
    assert.equal(request.ok,true);
  }finally{
    await close();
  }
}
