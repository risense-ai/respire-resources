"use strict";
const page = document.body.dataset.page;
const el = id => document.getElementById(id);
const pages = [["wizard","Setup wizard"],["overview","Overview"],["quickpanel","Quick panel"],["workspace","Workspace"],["recall","Recall"],["diary","Diary"],["organize","Organize"],["models","Models"],["storage","Storage"],["session-import","Session import"],["stats","Statistics"],["accounts","Accounts"],["grants","Access grants"],["space-members","Members"],["injection","IDE injection"],["settings","Settings"]];
const name = new URLSearchParams(location.search).get("scenario") ??
  ({wizard:"empty",accounts:"multi-account",models:"downloading-sse"}[page] ?? "rich-1k");
const offline = location.protocol === "file:";
const fixture = offline ? RespireFixture.create(name,{now:()=>performance.now()/1000}) : null;
const fileTicks = new Map();
const headers = {Authorization:"Bearer synthetic-preview-only"};
const html = value => String(value).replace(/[&<>"']/g,c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const scenarioURL = path => {
  const url = new URL(path,location.href);
  url.searchParams.set("scenario",name);
  return url;
};
async function request(path,method = "GET",body,extraHeaders = {},signal) {
  const binary = body instanceof Uint8Array;
  const requestHeaders = {...headers,...(body !== undefined ? {"content-type":binary ? "application/octet-stream" : "application/json"} : {}),...extraHeaders};
  // The file preview and HTTP adapter enforce the same synthetic permission boundary.
  if (offline) {
    const {data} = fixture.request(method,path,body,Object.fromEntries(Object.entries(requestHeaders).map(([k,v])=>[k.toLowerCase(),v])));
    return {data,generation:String(fixture.scope().generation)};
  }
  const response = await fetch(scenarioURL(path),{method,headers:requestHeaders,body:binary ? body : JSON.stringify(body),signal});
  const data = response.status === 204 ? undefined : response.headers.get("content-type") === "application/octet-stream"
    ? new Uint8Array(await response.arrayBuffer()) : await response.json();
  if (!response.ok) throw Object.assign(new Error(data.detail),{problem:data});
  return {data,generation:response.headers.get("x-preview-scope")};
}
function nextFileTick(id) {
  // A remounted file screen can watch the same operation without advancing it twice.
  if (!fileTicks.has(id)) fileTicks.set(id,new Promise(resolve=>setTimeout(()=>{
    fileTicks.delete(id);
    resolve(fixture.tick(id));
  },700)));
  return fileTicks.get(id);
}
async function stream(id,update,scopeHeaders,signal) {
  if (offline) {
    const channel = fixture.operationChannel(id,{authorization:headers.Authorization,...scopeHeaders});
    let status = channel.initial;
    update(status);
    while (status.state === "running") {
      status = await nextFileTick(id);
      if (!signal.aborted && channel.canRead()) update(status);
    }
    signal.throwIfAborted();
    if (!channel.canRead()) throw new Error("Progress stream ended early.");
    return status;
  }
  const response = await fetch(scenarioURL("/v1/operations/"+id+"/events"),{headers:{...headers,...scopeHeaders},signal});
  if (!response.ok) {
    const data = await response.json();
    throw Object.assign(new Error(data.detail),{problem:data});
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "", status;
  while (true) {
    const {done,value} = await reader.read();
    signal.throwIfAborted();
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
  if (!status || status.state === "running") {
    root.hidden = true;
    await refreshScope(true);
    signal.throwIfAborted();
    throw new Error("Progress stream ended early.");
  }
  return status;
}
function rows(items,empty = "No entries in this scenario.") {
  return items.length ? items.map(item=>'<div class="row">'+item+'</div>').join("") : '<p>'+html(empty)+'</p>';
}
function notes(items) {
  return items.length ? items.map(m=>'<details><summary>'+html(m.title)+'</summary><p>'+html(m.content)+'</p><small>'+html(m.category)+'</small></details>').join("") : "<p>No matching memories.</p>";
}
document.querySelector("aside").innerHTML = '<div class="brand"><span class="mark"></span>Respire</div><nav aria-label="Screens">'+
  pages.map(([id,label],i)=> (({0:"Start",3:"Notebook",7:"Library",11:"Administration"})[i] ? '<h2>'+({0:"Start",3:"Notebook",7:"Library",11:"Administration"})[i]+'</h2>' : "")+
  '<a href="'+html(scenarioURL(id+".html").href)+'" '+(page === id ? 'aria-current="page"' : "")+'>'+label+'</a>').join("")+'</nav>';
for (const scenario of RespireFixture.scenarios) el("scenario").add(new Option(scenario,scenario,name === scenario,name === scenario));
for (const a of document.querySelectorAll("article a")) a.href = scenarioURL(a.href);

let root = document.querySelector("main");
const template = root.cloneNode(true);
let generation, lifetime, checking, latestProbe, screenReady;
function refreshScope(force = false) {
  if (checking && !force) return latestProbe;
  checking = true;
  const probe = request("/preview/scope").then(({data:scope})=>{
    // A probe started before a known scope change may have sampled the old scope.
    if (latestProbe !== probe) return latestProbe;
    if (generation !== scope.generation) {
      lifetime?.abort();
      if (lifetime) {
        const next = template.cloneNode(true);
        root.replaceWith(next);
        root = next;
      }
      generation = scope.generation;
      lifetime = new AbortController();
      screenReady = mount(scope,root,lifetime.signal);
    }
    root.hidden = !offline && document.hidden;
  },error=>{
    if (latestProbe !== probe) return latestProbe;
    throw error;
  }).finally(()=>{ if (latestProbe === probe) checking = false; });
  return latestProbe = probe;
}

function setNotice(root,message,error = false) {
  const node = root.querySelector("#notice");
  node.textContent = message;
  node.toggleAttribute("data-error",error);
}
function mount(scope,root,signal) {
  const el = id => root.querySelector("#"+id);
  const notice = (message,error) => setNotice(root,message,error);
  const scopeHeaders = {"x-preview-scope":String(scope.generation)};
  async function run(fn, check = true) {
    try {
      if (check && !offline) await refreshScope(true);
      if (!signal.aborted) await fn();
    } catch (error) {
      if (!signal.aborted && error.problem?.code === "preview_scope_changed") {
        root.hidden = true;
        try { await refreshScope(true); }
        catch (probeError) { notice(probeError.message,true); }
      } else if (!signal.aborted) notice(error.problem?.detail ?? error.message,true);
    }
  }
  async function api(path,method,body,extraHeaders) {
    signal.throwIfAborted();
    const response = await request(path,method,body,{...extraHeaders,...scopeHeaders},signal);
    signal.throwIfAborted();
    if (response.generation !== scopeHeaders["x-preview-scope"]) {
      root.hidden = true;
      await refreshScope(true);
      signal.throwIfAborted();
    }
    return response.data;
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
  function bind(id,fn,event = "click") {
    const control = el(id);
    control.addEventListener(event,()=>run(async()=>{
      if (control.getAttribute("aria-busy") === "true") return;
      control.setAttribute("aria-busy","true");
      try { await fn(); } finally { control.removeAttribute("aria-busy"); }
    }));
  }
  bind("scenario",()=>{const url = new URL(location.href); url.searchParams.set("scenario",el("scenario").value); location.assign(url);},"change");
  const result = markup => { el("results").innerHTML = markup; };
  const metrics = values => {
    el("metrics").innerHTML = Object.entries(values).map(([label,value])=>'<div class="metric"><span>'+html(label)+'</span><strong>'+html(value)+'</strong></div>').join("");
  };
  return run(()=>setup({el,notice,run,api,bind,result,metrics,scope,authorizeOwner,ownerApi,
    stream:(id,update)=>stream(id,update,scopeHeaders,signal)}),false);
}
function checkScope(force = false) {
  if (document.hidden) { root.hidden = true; return; }
  return refreshScope(force).catch(error=>setNotice(root,error.message,true));
}
function startPreview() {
  if (offline) return refreshScope().then(()=>screenReady);
  const reactivate = () => { root.hidden = true; return checkScope(true); };
  document.addEventListener("visibilitychange",reactivate);
  window.addEventListener("focus",reactivate);
  window.addEventListener("pageshow",reactivate);
  window.addEventListener("pagehide",()=>{root.hidden = true;});
  setInterval(()=>checkScope(),1000);
  return checkScope()?.then(()=>screenReady);
}
