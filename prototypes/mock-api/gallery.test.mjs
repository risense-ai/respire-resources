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

test("Grants and Statistics can each authorize and renew in HTTP and file page scripts",async()=>{
  const [fixture,gallery,screens] = await Promise.all(["./fixture.js","../pages/gallery.js","../pages/screens.js"].map(async file=>
    new Script(await readFile(new URL(file,import.meta.url),"utf8"),{filename:file})));
  const http = harness();
  async function open(page,protocol) {
    const nodes = new Map();
    function el(id) {
      if (!nodes.has(id)) {
        const attributes = new Map();
        nodes.set(id,{disabled:false,value:"Topic",add(){},getAttribute:key=>attributes.get(key),
          setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),
          toggleAttribute:(key,on)=>on ? attributes.set(key,"") : attributes.delete(key),
          addEventListener(event,callback){this[event] = callback;}});
      }
      return nodes.get(id);
    }
    const location = new URL((protocol === "file:" ? "file:///preview" : "http://127.0.0.1:4173")+"/pages/"+page+".html?scenario=multi-account");
    const requests = [];
    const context = createContext({location,performance,URL,URLSearchParams,Uint8Array,confirm:()=>true,Option:class {},
      document:{body:{dataset:{page}},getElementById:el,querySelector:()=>el("aside"),querySelectorAll:()=>[]},
      fetch:async(url,init)=>{
        assert.equal(protocol,"http:");
        const headers = Object.fromEntries(new Headers(init.headers));
        const response = await http.call(init.method,url.pathname+url.search,init.body && JSON.parse(init.body),headers);
        requests.push([init.method,url.pathname,response.status]);
        return {...response,ok:response.status < 400,headers:new Headers(response.headers)};
      }});
    fixture.runInContext(context);
    gallery.runInContext(context);
    await screens.runInContext(context);
    assert.equal(el("notice").getAttribute("data-error"),undefined,el("notice").textContent);
    const api = (path,method,body) => new Script("api").runInContext(context)(path,method,body);
    const authorize = async()=>{
      assert.equal(el("authorize").disabled,false);
      await el("authorize").click();
      assert.equal(el("notice").getAttribute("data-error"),undefined,el("notice").textContent);
    };
    const revoke = () => {
      const id = el("results").innerHTML.match(/data-id="([^"]+)">Revoke grant/)[1];
      return el("results").onclick({target:{closest:()=>({dataset:{id}})}});
    };
    return {el,api,authorize,revoke,requests};
  }
  try {
    for (const protocol of ["http:","file:"]) {
      const grants = await open("grants",protocol);
      await grants.authorize();
      await grants.revoke();
      assert.match(grants.el("results").innerHTML,/Revoked/);
      await grants.authorize();
      assert.match(grants.el("results").innerHTML,/Revoked/);

      const stats = await open("stats",protocol);
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
        const switched = await open("grants",protocol);
        await switched.authorize();
        assert.match(switched.el("results").innerHTML,/Revoke grant/);
        await switched.revoke();
        assert.match(switched.el("results").innerHTML,/Revoked/);
        await switched.api("/preview/account","POST",{id:"studio"});
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
