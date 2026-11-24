"use strict";
const page = document.body.dataset.page;
const el = id => document.getElementById(id);
const pages = [["wizard","Setup wizard"],["overview","Overview"],["quickpanel","Quick panel"],["workspace","Workspace"],["recall","Recall"],["diary","Diary"],["organize","Organize"],["models","Models"],["storage","Storage"],["session-import","Session import"],["stats","Statistics"],["accounts","Accounts"],["grants","Access grants"],["space-members","Members"],["injection","IDE injection"],["settings","Settings"]];
const name = new URLSearchParams(location.search).get("scenario") ??
  ({wizard:"empty",accounts:"multi-account",models:"downloading-sse"}[page] ?? "rich-1k");
const offline = location.protocol === "file:";
const fixture = offline ? RespireFixture.create(name,{now:()=>performance.now()/1000}) : null;
const headers = {Authorization:"Bearer synthetic-preview-only"};
const html = value => String(value).replace(/[&<>"']/g,c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const scenarioURL = path => {
  const url = new URL(path,location.href);
  url.searchParams.set("scenario",name);
  return url;
};
const notice = (message,error = false) => {
  el("notice").textContent = message;
  el("notice").toggleAttribute("data-error",error);
};
async function run(fn) {
  try { await fn(); }
  catch (error) { notice(error.problem?.detail ?? error.message,true); }
}
async function api(path,method = "GET",body,extraHeaders = {}) {
  const binary = body instanceof Uint8Array;
  const requestHeaders = {...headers,...(body !== undefined ? {"content-type":binary ? "application/octet-stream" : "application/json"} : {}),...extraHeaders};
  // The file preview and HTTP adapter enforce the same synthetic permission boundary.
  if (offline) return fixture.request(method,path,body,Object.fromEntries(Object.entries(requestHeaders).map(([k,v])=>[k.toLowerCase(),v]))).data;
  const response = await fetch(scenarioURL(path),{method,headers:requestHeaders,body:binary ? body : JSON.stringify(body)});
  if (response.status === 204) return;
  if (response.ok && response.headers.get("content-type") === "application/octet-stream") return new Uint8Array(await response.arrayBuffer());
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.detail),{problem:data});
  return data;
}
let ownerHeaders;
async function authorizeOwner() {
  const {challenge} = await api("/preview/owner-challenge","POST",{});
  const data = await api("/v1/auth/handshake","POST",{scopes:["grants:read","grants:revoke","stats:read","query-log:read","reviews:read","sync-conflicts:read"]},{"X-Respire-Handshake-Proof":"synthetic-owner-proof-" + challenge});
  ownerHeaders = {Authorization:"Bearer " + data.access_token};
  notice("Synthetic owner session enabled for this page only. No real credentials are used.");
}
async function ownerApi(path,method = "GET") {
  if (!ownerHeaders) throw new Error("Enable the synthetic owner session first.");
  return api(path,method,undefined,ownerHeaders);
}
async function stream(id,update) {
  if (offline) {
    let status = fixture.snapshot(id);
    update(status);
    while (status.state === "running") {
      await new Promise(resolve => setTimeout(resolve,700));
      status = fixture.tick(id);
      update(status);
    }
    return status;
  }
  const response = await fetch(scenarioURL("/v1/operations/"+id+"/events"),{headers});
  if (!response.ok) throw new Error((await response.json()).detail);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "", status;
  while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    buffer += value;
    let end;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0,end);
      buffer = buffer.slice(end+2);
      const data = frame.split("\n").find(line => line.startsWith("data: "));
      if (data) { status = JSON.parse(data.slice(6)); update(status); }
    }
  }
  if (!status || status.state === "running") throw new Error("Progress stream ended early.");
  return status;
}
function bind(id,fn,event = "click") {
  el(id).addEventListener(event,()=>run(async()=>{
    const control = el(id);
    if (control.getAttribute("aria-busy") === "true") return;
    control.setAttribute("aria-busy","true");
    try { await fn(); } finally { control.removeAttribute("aria-busy"); }
  }));
}
function rows(items,empty = "No entries in this scenario.") {
  return items.length ? items.map(item=>'<div class="row">'+item+'</div>').join("") : '<p>'+html(empty)+'</p>';
}
function notes(items) {
  return items.length ? items.map(m=>'<details><summary>'+html(m.title)+'</summary><p>'+html(m.content)+'</p><small>'+html(m.category)+'</small></details>').join("") : "<p>No matching memories.</p>";
}
const result = markup => { el("results").innerHTML = markup; };
function metrics(values) {
  el("metrics").innerHTML = Object.entries(values).map(([label,value])=>'<div class="metric"><span>'+html(label)+'</span><strong>'+html(value)+'</strong></div>').join("");
}
document.querySelector("aside").innerHTML = '<div class="brand"><span class="mark"></span>Respire</div><nav aria-label="Screens">'+
  pages.map(([id,label],i)=> (({0:"Start",3:"Notebook",7:"Library",11:"Administration"})[i] ? '<h2>'+({0:"Start",3:"Notebook",7:"Library",11:"Administration"})[i]+'</h2>' : "")+
  '<a href="'+html(scenarioURL(id+".html").href)+'" '+(page === id ? 'aria-current="page"' : "")+'>'+label+'</a>').join("")+'</nav>';
for (const scenario of RespireFixture.scenarios) el("scenario").add(new Option(scenario,scenario,false,name === scenario));
bind("scenario",()=>{const url = new URL(location.href); url.searchParams.set("scenario",el("scenario").value); location.assign(url);},"change");
for (const a of document.querySelectorAll("article a")) a.href = scenarioURL(a.href);
