// Public command/flag discoverability only. Never executes a business command.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const manifest=JSON.parse(readFileSync(new URL("./legacy-help-inventory.json",import.meta.url),"utf8"));
const commandName=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const usage=/^Usage:[ \t]+/m;
const commandRow=/^ {2}([a-z0-9]+(?:-[a-z0-9]+)*)(?:[ \t]+|$)/;
const optionRow=/^[ \t]+(?:-[A-Za-z0-9],[ \t]+)?(--[a-z0-9]+(?:-[a-z0-9]+)*)(?=[ \t=,]|$)/;

export function inspectHelp(raw, topic, {commands=[], aliases={}, options=[]}) {
  assert.ok(typeof raw==="string" && usage.test(raw), "missing Clap usage");
  const names=new Map(), flags=new Set();
  let section;
  for(const line of raw.replace(/\r\n/g,"\n").split("\n")){
    if(/^[a-z][^:]*:$/i.test(line)){section=line;continue}
    if(section==="Commands:"){
      const m=commandRow.exec(line);
      if(!m)continue;
      const advertised=line.match(/\[aliases?: ([^\]]+)\]/)?.[1]?.split(/,\s*/)??[];
      assert.ok(!names.has(m[1]),"duplicate help command: "+m[1]);
      names.set(m[1],advertised);
    }
    if(section==="Options:" || section==="Global Options:"){
      const m=optionRow.exec(line);
      if(m) flags.add(m[1]);
    }
  }
  for(const name of commands)assert.ok(names.has(name),"missing required command: "+name);
  for(const [name,values] of Object.entries(aliases))
    for(const alias of values)assert.ok(names.get(name)?.includes(alias),"missing required alias: "+name+" "+alias);
  for(const flag of options)assert.ok(flags.has(flag),"missing required option: "+flag);
  if(topic){
    const words=topic.split(" ");
    const firstLine=raw.match(/^Usage:[ \t]+([^\r\n]+)/m)?.[1];
    const match=firstLine?.match(/\brsrs(?:\.exe)?\b(.*)/);
    const pos=match?.[1]?.trim().split(/\s+/)??[];
    assert.ok(words.every((word,i)=>pos[i]===word),"not the requested help topic: "+topic);
  }
}

export function helpCaseList(baseline=manifest){
  const topics=[...new Set(["",...Object.keys(baseline.groups),...Object.keys(baseline.options)])];
  for(const name of baseline.top)assert.ok(commandName.test(name),"invalid manifest name");
  assert.equal(new Set(baseline.top).size,baseline.top.length,"duplicate manifest name");
  return topics.map(topic=>{
    const words=topic?topic.split(" "):[];
    assert.ok(words.every(w=>commandName.test(w)) && (words.length===0||baseline.top.includes(words[0])), "invalid help topic");
    if(words.length>1)assert.ok(words.slice(1).every((w,i)=>baseline.groups[words.slice(0,i+1).join(" ")]?.includes(w)), "unknown nested help topic");
    return {topic,args:["--client-only",...words,"--help"], expectation:{
      commands:topic?baseline.groups[topic]:baseline.top,
      aliases:topic?baseline.groupAliases[topic]:baseline.aliases,
      options:baseline.options[topic],
    }};
  });
}

async function checksum(file){
  const hash=createHash("sha256");
  for await(const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
function beneath(base,child){
  const rel=relative(base,child);
  return rel && !isAbsolute(rel) && !rel.split(sep).includes("..");
}
function isolatedEnvironment(root, executable){
  const paths=Object.fromEntries(["home","roam","local","config","cache","data","state","temp","profile"].map(key=>{
    const path=join(root,key);mkdirSync(path);return [key,path];
  }));
  const os={};
  for(const key of ["SystemRoot","WINDIR","SYSTEMDRIVE","ComSpec"])if(process.platform==="win32"&&process.env[key])os[key]=process.env[key];
  const system=process.platform==="win32"?join(os.SystemRoot??os.WINDIR??"C:\\Windows","System32"):"/usr/bin";
  const env={...os,PATH:[dirname(executable),system].join(delimiter),LANG:"C",LC_ALL:"C",
    HOME:paths.home,USERPROFILE:paths.home,APPDATA:paths.roam,LOCALAPPDATA:paths.local,
    XDG_CONFIG_HOME:paths.config,XDG_CACHE_HOME:paths.cache,XDG_DATA_HOME:paths.data,XDG_STATE_HOME:paths.state,
    TEMP:paths.temp,TMP:paths.temp,TMPDIR:paths.temp,
    RSRS_DATA_DIR:paths.profile,RSRS_CLIENT_ONLY:"1",RSRS_NO_AUTOSTART:"1",RSRS_NO_AUTOSYNC:"1"};
  return {env, paths};
}

async function main(args){
  assert.ok(process.env.CARD018_DISPOSABLE_CLI_HELP==="1","requires an approved disposable, network-isolated VM");
  assert.ok(args.length===4 && args[0]==="--cli-bin" && isAbsolute(args[1]) &&
    args[2]==="--sha256" && /^[0-9a-f]{64}$/.test(args[3]),"usage: --cli-bin ABSOLUTE_PATH --sha256 REVIEWED_DIGEST");
  assert.ok(process.env.RUNNER_TEMP && isAbsolute(process.env.RUNNER_TEMP),"requires the VM's owned scratch root");
  const supplied=resolve(args[1]), info=lstatSync(supplied);
  assert.ok(info.isFile()&&!info.isSymbolicLink(),"requires a regular, reviewed CLI executable");
  const executable=realpathSync.native(supplied), expected=args[3];
  assert.equal(await checksum(executable),expected,"CLI artifact digest mismatch");
  const scratch=realpathSync.native(process.env.RUNNER_TEMP);
  const root=realpathSync.native(mkdtempSync(join(scratch,"respire-legacy-help-")));
  assert.ok(beneath(scratch,root),"unexpected scratch redirection");
  try {
    const {env, paths}=isolatedEnvironment(root,executable);
    for(const {topic,args,expectation} of helpCaseList()){
      const result=spawnSync(executable,args,{cwd:root,env,encoding:"utf8",stdio:["ignore","pipe","pipe"],
        shell:false,windowsHide:true,timeout:10000,maxBuffer:256*1024});
      assert.ok(!result.error && result.status===0 && !result.signal && !result.stderr,
        "help command failed: "+(topic||"root"));
      inspectHelp(result.stdout,topic,expectation);
    }
    assert.deepEqual(readdirSync(root).sort(),Object.keys(paths).sort(),"help changed scratch layout");
    for(const path of Object.values(paths)){
      const entry=lstatSync(path);
      assert.ok(entry.isDirectory()&&!entry.isSymbolicLink()&&readdirSync(path).length===0,"help created local state");
    }
    assert.equal(await checksum(executable),expected,"CLI artifact changed while running");
    console.log("PASS legacy CLI discoverability: "+manifest.top.length+" required top-level names and "+
      helpCaseList().length+" help topics; no semantic parity claim");
  } finally{
    assert.ok(existsSync(root) && realpathSync.native(root)===root && beneath(scratch,root),
      "scratch changed; refusing cleanup");
    rmSync(root,{recursive:true});
  }
}

if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main(process.argv.slice(2)).catch(error=>{
    // Only emit errors raised with fixed application-owned messages, never CLI output.
    const msg=error?.code==="ERR_ASSERTION"?error.message:"local fixture failure";
    console.error("Legacy help inventory failed: "+msg);process.exitCode=1;
  });
}
