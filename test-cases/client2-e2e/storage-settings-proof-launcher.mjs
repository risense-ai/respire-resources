import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createHash,randomBytes} from "node:crypto";
import {createReadStream} from "node:fs";
import {lstat, realpath} from "node:fs/promises";
import {dirname,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {encodeProofFrame,proofLines} from "./positive-memory-proof-ipc.mjs";
import {serveStorageSettingsProof} from "./storage-settings-proof-ipc.mjs";

const source="505ecc4d3a4f6c67c6a35751ed3c467a337027e9";

// This optional fixture bridge must never be called outside a reviewed,
// isolated hosted run. The caller is the separately verified Runtime
// launcher and supplies a fresh scoped reader, not a browser-facing service.
export async function withStorageSettingsApp({binary,owner,locale,ownedEnv,endpoint,readIndependent,chromium,playwrightCore,day}) {
  assert(process.platform==="win32" && process.arch==="x64" && process.env.GITHUB_ACTIONS==="true" &&
    process.env.RUNNER_ENVIRONMENT==="github-hosted" && process.env.CARD018_STORAGE_SETTINGS_ONLY==="1");
  assert(owner.source===source && isAbsolute(binary));
  const executable=await lstat(binary);
  assert(executable.isFile()&&!executable.isSymbolicLink()&&executable.nlink===1);
  assert(isAbsolute(ownedEnv?.RSRS_DATA_DIR) && ownedEnv.RSRS_NO_AUTOSYNC==="1" &&
    !ownedEnv.RSRS_ADDR && !ownedEnv.RSRS_TOKEN);
  assert.match(endpoint,/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  assert.match(day,/^\d{4}-\d{2}-\d{2}$/);
  assert(isAbsolute(chromium)&&isAbsolute(playwrightCore) && ["en","zh"].includes(locale));
  const path=await realpath(binary);
  const hash=createHash("sha256");
  for await(const bytes of createReadStream(path)) hash.update(bytes);
  assert.equal(hash.digest("hex"),owner.desktopDigest);
  const issuer=randomBytes(16).toString("hex");
  const deadline=AbortSignal.timeout(35000);
  const child=spawn(path,["-test.run=^TestCard018OwnedStorageSettings$","-test.timeout=32s"], {
    cwd:ownedEnv.HOME,env:{
      ...ownedEnv,GITHUB_ACTIONS:"true",RUNNER_ENVIRONMENT:"github-hosted",CARD018_STORAGE_SETTINGS_ONLY:"1",
      CARD018_SOURCE:source,CARD018_EXPECTED_ISSUER:issuer,CARD018_LOCALE:locale,CARD018_SYNTHETIC_DAY:day,
      CARD018_OWNER_PROCESS_INPUT:JSON.stringify(owner),CARD018_RUNTIME_URL:endpoint,
      CARD018_RUNTIME_DATA:ownedEnv.RSRS_DATA_DIR,CARD018_NODE:process.execPath,
      CARD018_SCRATCH:dirname(fileURLToPath(import.meta.url)),CARD018_CHROMIUM:chromium,CARD018_PLAYWRIGHT_CORE:playwrightCore
    },stdio:["pipe","pipe","ignore"],windowsHide:true,signal:deadline
  });
  const exited=new Promise(resolve=>{
    child.once("error",()=>resolve(null));
    child.once("close",(code,signal)=>resolve({code,signal}));
  });
  child.stdin.on("error",()=>{});
  try{
    await serveStorageSettingsProof({frames:proofLines(child.stdout),owner,expectedLocale:locale,expectedIssuer:issuer,fixturePath:ownedEnv.RSRS_DATA_DIR,
      readIndependent,send:frame=>new Promise((resolve,reject)=>
        child.stdin.write(encodeProofFrame(frame)+"\n",error=>error?reject(error):resolve())),
      close:async()=>{child.stdin.end();}});
    assert.deepEqual(await exited,{code:0,signal:null},"Positive memory fixture did not exit cleanly");
  }finally{
    if(child.exitCode===null&&child.signalCode===null)child.kill();
    await exited;
  }
}
