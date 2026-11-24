"use strict";
async function modelsOrStorage(health) {
  const modelPage = page === "models";
  const capable = flag => health.capabilities.includes(flag);
  if (!capable("model.catalog.v2")) throw new Error("Model catalog is unavailable.");
  const button = (action,label,id) => '<button class="secondary" data-action="'+action+'" data-id="'+html(id)+'">'+label+'</button>';
  let operation;
  async function monitor(id) {
    operation = id;
    el("operation").hidden = false;
    const end = await stream(id,status=>{
      el("operation").querySelector("progress").value = status.progress_percent;
      el("op-state").textContent = status.kind.replaceAll("_"," ")+" / "+status.state+" / "+status.progress_percent+"%";
      el("cancel").disabled = status.state !== "running";
    });
    notice(end.error?.detail ?? "Operation "+end.state+".",!!end.error);
    operation = null;
    await draw();
  }
  async function draw() {
    const [catalog,library] = await Promise.all([api("/v1/models/catalog"),api("/preview/library")]);
    result(rows(catalog.models.filter(m=>modelPage || library.installed.includes(m.id)).map(m=>{
      const active = m.id === catalog.active_model_id;
      const local = library.installed.includes(m.id);
      let actions = "";
      if (local && !active) {
        if (modelPage && capable("sse.operations.v1")) actions += button("switch","Activate",m.id);
        actions += button("uninstall","Uninstall",m.id);
      } else if (!local && capable("model.managed_download") && capable("sse.operations.v1")) actions += button("downloads","Download",m.id);
      return '<div><strong>'+html(m.display_name)+'</strong><p>'+m.engines.map(e=>html(e.engine.toUpperCase()+(e.available ? " ready" : " unavailable"))).join(" / ")+'</p></div><div class="actions"><span class="pill">'+(active ? "Active" : local ? "Installed" : "Available")+'</span>'+actions+'</div>';
    })));
    return library;
  }
  el("results").addEventListener("click",event=>run(async()=>{
    const btn = event.target.closest("button");
    if (!btn) return;
    const {action,id} = btn.dataset;
    if (action === "uninstall") {
      await api("/preview/uninstall","POST",{model_id:id});
      notice("Model removed. Runtime remains online.");
      await draw();
    } else {
      const op = await api("/v1/models/"+action,"POST",{model_id:id,engine:"cpu"});
      await monitor(op.operation_id);
    }
  }));
  if (modelPage) bind("cancel",()=>api("/v1/operations/"+operation,"DELETE"));
  const library = await draw();
  const current = library.operations.find(op=>op.state === "running" && op.kind.startsWith("model_"));
  if (modelPage && current) await monitor(current.operation_id);
}
async function setup() {
  const health = await api("/v1/health");
  if (!health.capabilities.includes("openapi.v1")) throw new Error("Runtime API unavailable.");
  const list = async(query="") => api("/v1/memories?limit=12"+query);
  const light = () => api("/v1/status/light");
  const library = () => api("/preview/library");
  const showMetrics = s => metrics({"Memories":s.memory_count,"Indexed":s.indexed_count,"Diary entries":s.diary_count});
  const input = () => el("input").value;
  if (page === "models" || page === "storage") {
    if (page === "storage") {
      let archive;
      bind("export",async()=>{
        archive = await api("/v1/backups/export");
        const url = URL.createObjectURL(new Blob([archive],{type:"application/octet-stream"}));
        const link = document.createElement("a"); link.href = url; link.download = "synthetic-notebook.fixture";
        link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
        el("restore").disabled = false;
        notice("Exported "+archive.byteLength+" synthetic bytes. Restore uses this in-memory export only.");
      });
      bind("restore",async()=>{
        if (!confirm("Restore the last synthetic export in this preview session?")) return;
        const op = await api("/v1/backups/import","POST",archive);
        await stream(op.operation_id,s=>notice("Synthetic restore "+s.state+" / "+s.progress_percent+"%"));
      });
    }
    return modelsOrStorage(health);
  }
  if (page === "wizard") {
    const render = async()=>{
      const acc = await api("/v1/host/account");
      result(acc.signed_in ? '<span class="pill">Profile ready</span> <a href="'+html(scenarioURL("overview.html").href)+'">Open overview &rarr;</a>' : "<p>Ready to create a local profile.</p>");
      el("action").disabled = acc.signed_in;
    };
    bind("action",async()=>{await api("/v1/host/transactions/login","POST",{mode:"offline_keygen"}); await render();});
    return render();
  }
  if (page === "overview") { showMetrics(await light()); return result(notes((await list()).items.slice(0,6))); }
  if (page === "workspace") {
    let batch = await list();
    function draw() {
      const items = batch.items;
      const layout = el("mode").value;
      el("results").className = layout === "Cards" ? "cards" : "";
      if (items.length && layout === "Graph") result(items.map(m=>'<div class="graph"><span>'+html(m.parent_id ?? "Notebook")+'</span><i></i><span>'+html(m.title)+'</span></div>').join(""));
      else if (items.length && layout === "Tree") result([...new Set(items.map(m=>m.parent_id))].map(parent=>'<details open><summary>'+html(parent ?? "Notebook roots")+'</summary>'+notes(items.filter(m=>m.parent_id === parent))+'</details>').join(""));
      else result(notes(items));
      el("action").disabled = !batch.next_cursor;
      el("memory").replaceChildren(...items.map(m=>new Option(m.title,m.id)));
      el("edit").disabled = !items.length;
      el("delete").disabled = !items.length;
    }
    bind("edit",async()=>{
      const item = await api("/v1/memories/"+encodeURIComponent(el("memory").value));
      el("editor").hidden = false; el("title").value = item.title; el("content").value = item.content;
      el("editor").dataset.id = item.id; el("title").focus();
    });
    bind("save",async()=>{
      await api("/v1/memories/"+encodeURIComponent(el("editor").dataset.id),"PATCH",{title:el("title").value,content:el("content").value});
      el("editor").hidden = true; batch = await list(); draw(); notice("Memory updated.");
    });
    bind("dismiss",()=>{el("editor").hidden = true;});
    bind("delete",async()=>{
      if (!confirm("Soft-delete the selected synthetic memory?")) return;
      await api("/v1/memories/"+encodeURIComponent(el("memory").value),"DELETE");
      el("editor").hidden = true; batch = await list(); draw(); notice("Memory soft-deleted.");
    });
    bind("first",async()=>{batch = await list(); draw();});
    bind("action",async()=>{batch = await list("&cursor="+batch.next_cursor); draw();});
    bind("mode",draw,"change");
    return draw();
  }
  if (page === "recall" || page === "quickpanel") {
    const search = async()=>{
      const {hits} = await api("/v1/memories/recall","POST",{query:input()});
      result(notes(hits.map(hit=>hit.memory))); notice(hits.length+" matching memories.");
    };
    el("input").addEventListener("keydown",event=>{
      if (event.key === "Enter" && (page === "recall" || event.ctrlKey || event.metaKey)) { event.preventDefault(); run(search); }
    });
    if (page === "recall") { bind("action",search); return search(); }
    bind("search",search);
    bind("action",async()=>{const m = await api("/v1/memories","POST",{content:input()}); result(notes([m])); el("input").value = ""; notice("Note saved.");});
  }
  if (page === "diary") {
    const load = async()=>{
      const {entries} = await api("/v1/diary?date="+el("date").value);
      el("input").value = entries[0]?.content ?? "";
      result(entries.length ? "<small>Saved journal entry</small>" : "<small>No entry for this date.</small>");
    };
    bind("date",load,"change");
    bind("action",async()=>{await api("/v1/diary","POST",{date:el("date").value,content:input()}); await load(); notice("Entry saved.");});
    return load();
  }
  if (page === "organize") {
    let plan;
    bind("suggest",async()=>{
      const {suggestions} = await api("/v1/organize/suggestions?top=8");
      el("suggestions").innerHTML = rows(suggestions.map(s=>'<div><strong>'+html(s.target_id)+'</strong><p>'+html(s.summary)+'</p></div><button data-id="'+html(s.target_id)+'">Split note</button>'),"No suggestions in this scenario.");
    });
    el("suggestions").onclick = e=>run(async()=>{
      const button = e.target.closest("button[data-id]");
      if (!button || !confirm("Split this synthetic note into two linked parts?")) return;
      button.disabled = true;
      try {
        const op = await api("/v1/organize/split","POST",{memory_id:button.dataset.id});
        await stream(op.operation_id,s=>notice("Split "+s.state+" / "+s.progress_percent+"%"));
      } finally { button.disabled = false; }
    });
    result("<p>Preview the proposed moves to review their destinations.</p>");
    bind("action",async()=>{
      plan = await api("/v1/organize/deepen/plan","POST",{});
      result(rows(plan.moves.map(m=>html(m.memory_id)+" &rarr; "+html(m.new_parent_id)),"No moves suggested."));
      el("apply").disabled = !plan.moves.length;
    });
    bind("apply",async()=>{
      el("apply").disabled = true;
      const op = await api("/v1/organize/deepen/apply","POST",{plan_id:plan.plan_id});
      await stream(op.operation_id,s=>notice("Organization "+s.state+" / "+s.progress_percent+"%"));
    });
  }
  if (page === "session-import") {
    const lines = ["Review interview notes","Compare observation methods","Schedule the next field session"];
    result(lines.map((line,i)=>'<label><span><input type="checkbox" value="'+i+'" checked> '+line+'</span></label>').join(""));
    bind("action",async()=>{
      const selected = [...el("results").querySelectorAll("input:checked")];
      if (!selected.length) throw new Error("Select a session note.");
      for (const item of selected) {
        await api("/v1/memories","POST",{title:"Field session",content:lines[item.value]});
        item.checked = false; item.disabled = true;
      }
      el("action").disabled = !el("results").querySelector("input:not(:disabled)");
      notice(selected.length+" session notes imported.");
    });
  }
  if (page === "stats") {
    let all = [];
    async function reloadDistribution() {
      const items = [];
      let cursor = "0";
      do {
        const batch = await api("/v1/memories?limit=200&cursor="+cursor);
        items.push(...batch.items);
        cursor = batch.next_cursor;
      } while (cursor);
      all = items;
      draw();
    }
    bind("authorize",async()=>{
      await authorizeOwner();
      const [stats,log,conflicts] = await Promise.all([ownerApi("/v1/stats"),ownerApi("/v1/query-log?limit=5"),ownerApi("/v1/sync/conflicts")]);
      metrics({"Total records":stats.local_total,"Alive records":stats.local_alive,"Recorded queries":log.stats.total});
      el("audit").innerHTML = rows(conflicts.items.map(c=>'<strong>'+html(c.memory_id)+'</strong><span>'+html(c.state+" / revision "+c.revision)+'</span>'),"No pending sync conflicts.");
      const first = (await list()).items[0];
      if (first) {
        const reviews = await ownerApi("/v1/memories/"+encodeURIComponent(first.id)+"/reviews?limit=5");
        el("audit").innerHTML += '<h3>Recent review history</h3>'+rows(reviews.items.map(r=>html(r.action+" / "+r.happened_at)),"No review events for the first memory.");
      }
      await reloadDistribution();
    });
    function draw() {
      const counts = new Map();
      for (const m of all) {
        const group = el("mode").value === "Topic" ? m.category : m.parent_id ? "Child notes" : "Root notes";
        counts.set(group,(counts.get(group) ?? 0)+1);
      }
      result(rows([...counts].map(([label,count])=>'<strong>'+html(label)+'</strong><meter max="'+all.length+'" value="'+count+'"></meter><span>'+count+'</span>')));
    }
    bind("mode",draw,"change");
    showMetrics(await light());
    return reloadDistribution();
  }
  if (page === "accounts") {
    bind("sync",async()=>{
      const op = await api("/v1/sync/trigger","POST");
      await stream(op.operation_id,s=>notice("Synthetic sync "+s.state+" / "+s.progress_percent+"%"));
      await render();
    });
    const render = async()=>{
      const [acc,lib,sync] = await Promise.all([api("/v1/host/account"),library(),api("/v1/sync/status")]);
      result(rows(lib.accounts.map(id=>'<strong>'+html(id)+'</strong>'+(acc.account_id === id ? '<span class="pill">Active</span>' : '<button data-id="'+html(id)+'">Switch profile</button>')))+'<p>Pending sync items: '+sync.pending_outbox+'</p>');
    };
    el("results").onclick = e=>run(async()=>{if (e.target.dataset.id) {await api("/preview/account","POST",{id:e.target.dataset.id}); await render(); await drawSpaces();}});
    const drawSpaces = async()=>{
      const {spaces} = await api("/v1/spaces");
      el("spaces").innerHTML = rows(spaces.map(s=>'<strong>'+html(s.name)+'</strong><div class="actions"><button data-action="rename" data-id="'+html(s.id)+'">Rename</button>'+(s.active ? '<span class="pill">Active space</span>' : '<button data-action="activate" data-id="'+html(s.id)+'">Activate</button><button class="secondary" data-action="delete" data-id="'+html(s.id)+'">Delete</button>')+'</div>'));
    };
    bind("create",async()=>{await api("/v1/spaces","POST",{name:el("space-name").value}); el("space-name").value = ""; await drawSpaces(); await render();});
    el("spaces").onclick = e=>run(async()=>{
      const button = e.target.closest("button[data-action]"); if (!button) return;
      const path = "/v1/spaces/"+encodeURIComponent(button.dataset.id);
      if (button.dataset.action === "delete") {
        if (!confirm("Delete this synthetic space and its notes?")) return;
        await api(path,"DELETE");
      } else if (button.dataset.action === "rename") {
        const name = el("space-name").value;
        if (!name.trim()) throw new Error("Enter a space name before renaming.");
        await api(path,"PATCH",{name});
      } else await api(path,"PATCH",{active:true});
      await drawSpaces(); await render();
    });
    await drawSpaces();
    return render();
  }
  if (page === "grants") {
    const draw = async()=>result(rows((await ownerApi("/v1/grants")).items.map(g=>'<strong>'+html(g.label)+'</strong>'+(g.revoked ? '<span class="pill">Revoked</span>' : '<button data-id="'+html(g.id)+'">Revoke grant</button>')),"No grants issued."));
    bind("authorize",async()=>{await authorizeOwner(); await draw();});
    el("results").onclick = e=>run(async()=>{
      const button = e.target.closest("button[data-id]");
      if (button && confirm("Revoke this synthetic grant? Shared memories will be retained.")) {
        await ownerApi("/v1/grants/"+button.dataset.id,"DELETE"); await draw(); notice("Grant revoked. Shared memories retained.");
      }
    });
    return result("<p>Enable the synthetic owner session to load grant metadata.</p>");
  }
  if (page === "space-members") {
    const {spaces} = await api("/v1/spaces");
    for (const s of spaces) el("space").add(new Option(s.name,s.id,false,s.active));
    const path = () => "/v1/spaces/"+encodeURIComponent(el("space").value)+"/members";
    const draw = async()=>result(rows((await api(path())).members.map(m=>'<strong>'+html(m.display_name ?? m.member_id)+'</strong><span>'+html(m.role+" / "+m.status)+'</span>')));
    bind("space",draw,"change");
    bind("action",async()=>{await api(path(),"POST",{identifier:input(),role:el("role").value}); await draw(); notice("Synthetic invitation added to the selected space.");});
    return draw();
  }
  if (page === "injection") {
    const draw = ()=>{el("results").textContent = (el("mode").value === "Zed" ? ".rules" : ".github/copilot-instructions.md")+"\n\nRecall related notebook entries before starting a task."; notice("");};
    bind("mode",draw,"change");
    bind("action",()=>{el("results").textContent += "\n\nApplied in this synthetic session."; el("action").disabled = true;});
    el("mode").addEventListener("change",()=>{el("action").disabled = false;});
    return draw();
  }
  if (page === "settings") {
    const draw = async()=>{const config = await api("/v1/host/config"); el("mode").value = config.diary_mode; result("<p>Current mode: "+html(config.diary_mode)+"</p>");};
    bind("action",async()=>{await api("/v1/host/config","PATCH",{diary_mode:el("mode").value}); await draw(); notice("Settings saved.");});
    return draw();
  }
}
run(setup);
