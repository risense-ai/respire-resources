import {browserMarker} from './card018-safe-diagnostic.mjs';
await browserMarker('browser-entry');
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {observePositiveMemoryPages,positiveMemoryLanes} from "./positive-memory-wails-observer.mjs";
import {compareOwnedMemoryWitnesses} from "./positive-memory-wails-contract.mjs";
import {proofLines,encodeProofFrame} from "./positive-memory-proof-ipc.mjs";

const [origin,locale]=process.argv.slice(2);
const lane=process.env.CARD018_POSITIVE_LANE??"full";
const owner=JSON.parse(process.env.CARD018_OWNER_PROCESS_INPUT??"null");
const issuer=process.env.CARD018_OWNER_WAILS_ISSUER;
const frames=proofLines(process.stdin)[Symbol.asyncIterator]();
const read=async kind=>{
  const {done,value}=await frames.next();
  assert(!done && value?.kind===kind,"Wrong inherited proof receipt");
  return value;
};
const write=frame=>new Promise((resolve,reject)=>
  process.stdout.write(encodeProofFrame(frame)+"\n",error=>error?reject(error):resolve()));
let observerFailureRecorded=false;
try {
  assert(process.platform==="win32" && process.arch==="x64" &&
    process.env.RUNNER_ENVIRONMENT==="github-hosted" && process.env.CARD018_POSITIVE_ONLY==="1" && positiveMemoryLanes.includes(lane));
  await write({kind:"hello",owner,issuer,locale});
  await browserMarker("browser-hello");
  const {snapshot}=await read("before");
  await browserMarker("browser-before");
  const marker=compareOwnedMemoryWitnesses(owner,snapshot,snapshot);
  let browser, ok=false;
  try {
    const {chromium}=createRequire(import.meta.url)(process.env.CARD018_PLAYWRIGHT_CORE);
    browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.CARD018_CHROMIUM,
      args:["--disable-background-networking","--no-first-run","--no-proxy-server","--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"]});
    await browserMarker("chromium-started");
    const page=await browser.newPage({serviceWorkers:"block",viewport:{width:1440,height:900}});
    await observePositiveMemoryPages({page,origin,owner:{...owner,issuer},locale,marker,lane});
      await browserMarker("browser-observed");
    ok=true;
  }catch(error){
    await browserMarker("browser-failure",error);
    observerFailureRecorded=true;
    throw error;
  }finally{
    await browser?.close();
    await write({kind:"after",ok});
    const after=await read("after");
    assert.equal(after.verified,true);
    // Do not replace the real observer failure with a generic final assertion.
    process.stdout.end();
  }
}catch(error){
  if(!observerFailureRecorded) await browserMarker('browser-failure',error);
  console.error("FAIL isolated positive memory browser verification");
  process.exitCode=1;
}finally{
  process.stdin.destroy();
}
