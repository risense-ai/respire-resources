import assert from "node:assert/strict";
import {validateDiaryAccountsIndependent} from "./compiled-diary-accounts-observer.mjs";

const identityFields=["account_id","desktopDigest","generation","instance_id","pid","runtimeDigest","source"];
function only(value,fields){assert.deepEqual(Object.keys(value).sort(),[...fields].sort());}

export async function serveDiaryAccountsProof({frames,send,close,owner,expectedLocale,expectedIssuer,kind,readIndependent}){
  const iter=frames[Symbol.asyncIterator]();
  async function receive(){
    const r=await iter.next();assert.equal(r.done,false,"Unexpected Diary/Accounts pipe EOF");return r.value;
  }
  assert(["diary","accounts"].includes(kind));
  const validate=receipt=>validateDiaryAccountsIndependent({kind,owner,receipt});
  const project=w=>{
    const owned=Object.fromEntries(identityFields.map(k=>[k,w.owner[k]]));
    return kind==="diary"?{owner:owned,day:w.day,localDay:w.localDay,
      typed:w.typed.map(x=>({id:x.id,date:x.date,content:x.content})),
      legacy:w.legacy.map(x=>({id:x.id,day:x.day,title:x.title,content:x.content}))}:
      {owner:owned,legacyUser:w.legacyUser,hostUser:w.hostUser,typedSpace:w.typedSpace,
        sessionHash:w.sessionHash,oneOwnedMainProfile:w.oneOwnedMainProfile};
  };
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
    await send({kind:"after",verified:true,snapshot:project(after)});
    assert.equal((await iter.next()).done,true,"Duplicate Diary/Accounts proof frame");
    assert.equal(request.ok,true);
  }finally{
    await close();
  }
}
