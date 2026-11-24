import assert from "node:assert/strict";
import test from "node:test";
import {readFile,readdir,stat} from "node:fs/promises";
import {createContext,Script} from "node:vm";
import {harness} from "./http-harness.mjs";

const pages = ["wizard","overview","quickpanel","workspace","recall","diary","organize","models","storage","session-import","stats","accounts","grants","space-members","injection","settings"];
const controls = {
  wizard:["action"],overview:["metrics","results"],quickpanel:["input","action","search"],
  workspace:["memory","edit","delete","editor","title","content","save","dismiss","first","mode","action"],
  recall:["input","action"],diary:["input","date","action"],organize:["action","apply","suggest","suggestions"],
  models:["operation","op-state","cancel"],storage:["export","restore"],"session-import":["action"],
  stats:["metrics","mode","authorize","audit"],accounts:["sync","spaces","space-name","create"],
  grants:["authorize"],"space-members":["space","role","input","action"],injection:["mode","action"],settings:["mode","action"]
};
test("16 page inventories, local assets and interaction targets (static, not browser rendering)",async()=>{
  const root = new URL("../pages/",import.meta.url);
  assert.deepEqual((await readdir(root)).filter(f=>f.endsWith(".html")).sort(),pages.map(p=>p+".html").sort());
  for (const page of pages) {
    const url = new URL(page+".html",root), text = await readFile(url,"utf8");
    assert.match(text,new RegExp('data-page="'+page+'"'));
    const ids = [...text.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);
    assert.equal(ids.length,new Set(ids).size,"Duplicate IDs: "+page);
    for (const id of ["scenario","notice","results",...controls[page]]) assert.ok(ids.includes(id),page+" missing "+id);
    assert.match(text,/aria-live="polite"/);
    for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      assert.doesNotMatch(match[1],/^(?:https?:|\/\/)/,"Remote asset");
      assert.ok((await stat(new URL(match[1],url))).isFile());
    }
  }
  for (const file of ["gallery.js","screens.js"]) {
    const text = await readFile(new URL(file,root),"utf8");
    assert.doesNotThrow(()=>new Script(text,{filename:file}));
    assert.doesNotMatch(text,/\/v1\/spaces\/studio\/members/);
  }
});
test("prototype source guardrails exclude coordinator-owned browser artifacts",async()=>{
  async function inspect(dir) {
    for (const entry of await readdir(dir,{withFileTypes:true})) {
      if (entry.name === ".card017-browser-check") continue;
      const url = new URL(entry.name+(entry.isDirectory() ? "/" : ""),dir);
      if (entry.isDirectory()) { await inspect(url); continue; }
      if (!/\.(?:mjs|js|html|css|md)$/.test(entry.name)) continue;
      const text = await readFile(url,"utf8");
      assert.ok(text.split("\n").length <= 600,url.pathname+" exceeds cap");
      assert.doesNotMatch(text,/[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/);
    }
  }
  await inspect(new URL("../",import.meta.url));
});

const scripts = Promise.all(["./fixture.js","../pages/gallery.js","../pages/screens.js"].map(async file=>
    new Script(await readFile(new URL(file,import.meta.url),"utf8"),{filename:file})));
async function open(http,page,protocol = "http:",holdResponse,scenario = "multi-account") {
  const [fixture,gallery,screens] = await scripts;
  function rootNode() {
    const nodes = new Map();
    function el(id) {
      if (!nodes.has(id)) {
        const attributes = new Map();
        nodes.set(id,{disabled:false,value:page === "workspace" ? "List" : "Topic",innerHTML:"",options:[],focus(){},
          add(option){this.options.push(option); if (option.selected || this.options.length === 1) this.value = option.value;},
          replaceChildren(...options){this.options = []; options.forEach(option=>this.add(option));},
          getAttribute:key=>attributes.get(key),
          setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),
          toggleAttribute:(key,on)=>on ? attributes.set(key,"") : attributes.delete(key),
          addEventListener(event,callback){this[event] = callback;}});
      }
      return nodes.get(id);
    }
    return {el,querySelector:id=>el(id.slice(1)),cloneNode:rootNode,replaceWith(next){root = next;}};
  }
  let root = rootNode();
  const el = id => root.el(id);
  const location = new URL((protocol === "file:" ? "file:///preview" : "http://127.0.0.1:4173")+"/pages/"+page+".html?scenario="+scenario);
  const requests = [];
  const timers = [];
  const events = {addEventListener(event,callback){this[event] = callback;}};
  const document = {...events,hidden:protocol === "file:",body:{dataset:{page}},getElementById:el,
    querySelector:selector=>selector === "main" ? root : el("aside"),querySelectorAll:()=>[]};
  const window = {...events};
  const context = createContext({location,performance,URL,URLSearchParams,Uint8Array,AbortController,confirm:()=>true,document,window,
    setInterval:callback=>{window.poll = callback;},
    setTimeout:callback=>timers.push(callback),
    Option:class { constructor(label,value,_,selected) { Object.assign(this,{label,value,selected}); } },
    fetch:async(url,init)=>{
      assert.equal(protocol,"http:");
      const headers = Object.fromEntries(new Headers(init.headers));
      const response = await http.call(init.method,url.pathname+url.search,init.body && JSON.parse(init.body),headers);
      requests.push([init.method,url.pathname,response.status]);
      await holdResponse?.(url,init);
      return {...response,ok:response.status < 400,headers:new Headers(response.headers)};
    }});
  fixture.runInContext(context);
  gallery.runInContext(context);
  await screens.runInContext(context);
  assert.equal(el("notice").getAttribute("data-error"),undefined,el("notice").textContent);
  const settled = () => new Script("screenReady").runInContext(context);
  const refresh = async()=>{await new Script("refreshScope()").runInContext(context); await settled();};
  const api = async(path,method,body)=>{
    const {data} = await new Script("request").runInContext(context)(path,method,body);
    await refresh();
    return data;
  };
  const authorize = async()=>{
    assert.equal(el("authorize").disabled,false);
    await el("authorize").click();
    assert.equal(el("notice").getAttribute("data-error"),undefined,el("notice").textContent);
  };
  const revoke = () => {
    const id = el("results").innerHTML.match(/data-id="([^"]+)">Revoke grant/)[1];
    return el("results").onclick({target:{closest:()=>({dataset:{id}})}});
  };
  return {el,api,authorize,revoke,requests,refresh,settled,document,window,timers,root:()=>root};
}

test("file wizard remounts after completing a synthetic login without HTTP",async()=>{
  const wizard = await open(undefined,"wizard","file:",undefined,"empty");
  const action = wizard.el("action");
  assert.equal(wizard.root().hidden,false);
  assert.match(wizard.el("results").innerHTML,/Ready to create a local profile/);
  await action.click();
  await wizard.settled();
  assert.notEqual(wizard.el("action"),action);
  assert.equal(wizard.el("action").disabled,true);
  assert.match(wizard.el("results").innerHTML,/Profile ready/);
});

test("file sync finishes after switching away without updating the detached screen",async()=>{
  const accounts = await open(undefined,"accounts","file:");
  const sync = accounts.el("sync").click();
  await new Promise(setImmediate);
  const oldNotice = accounts.el("notice");
  assert.match(oldNotice.textContent,/running \/ 0%/);
  await accounts.api("/preview/account","POST",{id:"archive"});
  await accounts.api("/preview/account","POST",{id:"studio"});
  for (let i = 0; i < 4; i++) {
    assert.equal(accounts.timers.length,1);
    accounts.timers.shift()();
    await new Promise(setImmediate);
  }
  await sync;
  assert.equal(accounts.timers.length,0);
  assert.doesNotMatch(oldNotice.textContent,/completed/);
  const status = await accounts.api("/v1/sync/status");
  assert.equal(status.state,"idle");
  assert.equal(status.pending_outbox,0);
});

test("Grants and Statistics can each authorize and renew in HTTP and file page scripts",async()=>{
  const http = harness();
  try {
    for (const protocol of ["http:","file:"]) {
      const grants = await open(http,"grants",protocol);
      await grants.authorize();
      await grants.revoke();
      assert.match(grants.el("results").innerHTML,/Revoked/);
      await grants.authorize();
      assert.match(grants.el("results").innerHTML,/Revoked/);

      const stats = await open(http,"stats",protocol);
      await stats.authorize();
      assert.match(stats.el("metrics").innerHTML,/Total records.*500/);
      assert.match(stats.el("audit").innerHTML,/Recent review history/);
      assert.match(stats.el("audit").innerHTML,/9007199254740993/);
      assert.match(stats.el("results").innerHTML,/Field research/);
      await stats.api("/preview/account","POST",{id:"archive"});
      await stats.authorize();
      assert.match(stats.el("audit").innerHTML,/No pending sync conflicts/);
      assert.match(stats.el("results").innerHTML,/Design systems/);
      if (protocol === "http:") {
        const switched = await open(http,"grants",protocol);
        await switched.authorize();
        assert.match(switched.el("results").innerHTML,/Revoke grant/);
        await switched.revoke();
        assert.match(switched.el("results").innerHTML,/Revoked/);
        await switched.api("/preview/account","POST",{id:"studio"});
        await grants.refresh();
        await grants.authorize();
        assert.match(grants.el("results").innerHTML,/Revoked/);
        assert.equal(stats.requests.filter(([method,path,status])=>method === "POST" && path === "/v1/auth/handshake" && status === 200).length,2);
      } else {
        await grants.api("/v1/spaces/archive","PATCH",{active:true});
        await grants.authorize();
        assert.match(grants.el("results").innerHTML,/Revoke grant/);
      }
    }
  } finally { http.close(); }
});

test("HTTP page DOM replaces stale selections, caches and late responses on scope changes",async()=>{
  const http = harness();
  const call = async(method,path,body)=>{
    const response = await http.call(method,path+(path.includes("?") ? "&" : "?")+"scenario=multi-account",body);
    assert.ok(response.status < 400,response.text);
    return response.json();
  };
  const marker = "Synthetic private scope marker";
  const held = Promise.withResolvers(), release = Promise.withResolvers();
  const scopeHeld = Promise.withResolvers(), releaseScope = Promise.withResolvers();
  let delayList = false, delayScope = false;
  try {
    const space = await call("POST","/v1/spaces",{name:marker});
    await call("PATCH","/v1/spaces/"+space.id,{active:true});
    await call("POST","/v1/memories",{title:marker,content:marker,category:marker});
    const workspace = await open(http,"workspace","http:",async url=>{
      if (delayList && url.pathname === "/v1/memories") {
        delayList = false;
        held.resolve();
        await release.promise;
      }
      if (delayScope && url.pathname === "/preview/scope") {
        delayScope = false;
        scopeHeld.resolve();
        await releaseScope.promise;
      }
    });
    const overview = await open(http,"overview");
    const stats = await open(http,"stats");
    const members = await open(http,"space-members");
    await stats.authorize();
    await workspace.el("edit").click();
    assert.equal(workspace.el("title").value,marker);
    assert.match(workspace.el("results").innerHTML,new RegExp(marker));
    assert.match(overview.el("results").innerHTML,new RegExp(marker));
    assert.match(stats.el("results").innerHTML,new RegExp(marker));
    assert.notEqual(stats.el("audit").innerHTML,"");
    assert.equal(members.el("space").value,space.id);
    delayList = true;
    const lateDraw = workspace.el("first").click();
    await held.promise;
    const oldMode = workspace.el("mode");
    delayScope = true;
    const oldPoll = workspace.window.poll();
    await scopeHeld.promise;
    workspace.document.hidden = true;
    await workspace.document.visibilitychange();
    assert.equal(workspace.root().hidden,true);

    await call("POST","/preview/account",{id:"archive"});
    workspace.document.hidden = false;
    const resumed = await Promise.race([workspace.document.visibilitychange().then(()=>true),new Promise(resolve=>setImmediate(()=>resolve(false)))]);
    assert.equal(resumed,true,"Activation must sample a fresh scope while the old poll is pending");
    await workspace.settled();
    assert.equal(workspace.root().hidden,false);
    assert.notEqual(workspace.el("mode"),oldMode);
    releaseScope.resolve();
    await oldPoll;
    release.resolve();
    await lateDraw;
    await oldMode.change();
    workspace.el("mode").value = "Graph";
    await workspace.el("mode").change();
    assert.match(workspace.el("results").innerHTML,/class="graph"/);
    assert.doesNotMatch(workspace.el("results").innerHTML,new RegExp(marker));
    assert.notEqual(workspace.el("title").value,marker);
    assert.ok(workspace.el("memory").options.length);
    assert.ok(workspace.el("memory").options.every(option=>option.label !== marker));

    // A cached mode action must refresh the scope even without a focus event.
    await stats.el("mode").change();
    await stats.settled();
    assert.doesNotMatch(stats.el("results").innerHTML,new RegExp(marker));
    assert.equal(stats.el("audit").innerHTML,"");

    await call("POST","/preview/account",{id:"studio"});
    await workspace.window.focus();
    await workspace.settled();
    assert.match(workspace.el("results").innerHTML,new RegExp(marker));
    const other = await call("POST","/v1/spaces",{name:"Second private fixture"});
    await call("PATCH","/v1/spaces/"+other.id,{active:true});
    await call("POST","/v1/memories",{title:"Second private note",content:"Second private note"});
    await workspace.el("mode").change();
    await workspace.settled();
    assert.match(workspace.el("results").innerHTML,/Second private note/);
    assert.doesNotMatch(workspace.el("results").innerHTML,new RegExp(marker));

    await call("POST","/v1/host/transactions/logout");
    for (const view of [overview,stats,members]) {
      const start = view.requests.length;
      await view.window.pageshow();
      await view.settled();
      assert.match(view.el("results").innerHTML,/No active space/);
      assert.equal(view.el("notice").getAttribute("data-error"),undefined);
      assert.deepEqual(view.requests.slice(start).map(([,path])=>path),["/preview/scope","/v1/health"]);
    }
    assert.equal(stats.el("authorize").disabled,true);
    assert.equal(members.el("action").disabled,true);
    assert.deepEqual(members.el("space").options,[]);
  } finally { release.resolve(); releaseScope.resolve(); http.close(); }
});
