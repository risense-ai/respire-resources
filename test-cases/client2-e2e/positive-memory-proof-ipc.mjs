import assert from "node:assert/strict";
import {compareOwnedMemoryWitnesses} from "./positive-memory-wails-contract.mjs";

// One proof-only stdio exchange per owned process. Project only sanitized
// fixture data at the producer, never forward credentials or raw RPC frames.
export const ipcPrefix = "CARD018-PROOF ";
const bound = 8 * 1024;
const fields = ["pid","instance_id","account_id","generation","runtimeDigest","desktopDigest","source"];

export function decodeProofFrame(line) {
  assert(typeof line==="string" && Buffer.byteLength(line,"utf8")<=bound);
  assert(line.startsWith(ipcPrefix) && !/[\r\n]/.test(line));
  const frame=JSON.parse(line.slice(ipcPrefix.length));
  assert(frame && typeof frame==="object" && !Array.isArray(frame));
  return frame;
}
export function encodeProofFrame(frame) {
  const line=ipcPrefix+JSON.stringify(frame);
  decodeProofFrame(line);
  return line;
}
function only(frame, keys) {
  assert.deepEqual(Object.keys(frame).sort(),[...keys].sort(),"Unexpected proof frame fields");
}
export async function* proofLines(stream) {
  let buffer=Buffer.alloc(0);
  for await(const chunk of stream){
    const next=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    buffer=Buffer.concat([buffer,next]);
    let end;
    while((end=buffer.indexOf(10))>=0){
      assert(end<=bound,"Oversized proof frame");
      const line=buffer.subarray(0,end).toString("utf8");
      buffer=buffer.subarray(end+1);
      yield decodeProofFrame(line);
    }
    assert(buffer.length<=bound,"Oversized incomplete proof frame");
  }
  assert.equal(buffer.length,0,"Truncated proof frame");
}
export async function servePositiveMemoryProof({frames,send,owner,expectedLocale,expectedIssuer,readIndependent,close}) {
  const iter=frames[Symbol.asyncIterator]();
  const receive=async()=>{
    const result=await iter.next();
    assert.equal(result.done,false,"Premature proof pipe EOF");
    return result.value;
  };
  try {
    const hello=await receive();
    only(hello,["kind","owner","issuer","locale"]);
    only(hello.owner,fields);
    assert.equal(hello.kind,"hello");
    assert(["en","zh"].includes(expectedLocale));
    assert.equal(hello.locale,expectedLocale,"Wrong proof child locale");
    assert.match(expectedIssuer??"",/^[0-9a-f]{32}$/);
    assert.equal(hello.issuer,expectedIssuer,"Wrong proof issuer");
    for(const key of fields)assert.equal(hello.owner[key],owner[key],"Wrong proof child identity");
    assert.match(owner.source??"",/^[0-9a-f]{40}$/);
    assert.match(owner.desktopDigest??"",/^[0-9a-f]{64}$/);
    const before=await readIndependent();
    compareOwnedMemoryWitnesses(owner,before,before);
    await send({kind:"before",snapshot:before});
    const request=await receive();
    only(request,["kind","ok"]);
    assert.equal(request.kind,"after");
    assert.equal(typeof request.ok,"boolean");
    const after=await readIndependent();
    compareOwnedMemoryWitnesses(owner,before,after);
    // On Windows an inherited Node stdout may not deliver EOF until that
    // child exits. Acknowledgement releases the child; only EOF and the
    // launcher verified clean exit can finalize a pass.
    await send({kind:"after",verified:true});
    assert.equal((await iter.next()).done,true,"Unexpected duplicate proof frame");
    assert.equal(request.ok,true,"Browser observation failed");
  } finally {
    await close();
  }
}
