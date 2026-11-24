/* Shared by file previews and the loopback HTTP adapter. */
(() => {
  const scenarios = ["empty", "rich-1k", "downloading-sse", "switch-rollback-error", "multi-account"];
  const date = "2026-11-23";
  const stamp = date + "T09:30:00Z";
  const topics = ["Field research", "Design systems", "Reading notes", "Project decisions"];
  const notes = ["Interview synthesis", "Weekly observations", "Reference collection", "Working principles", "Follow-up questions"];
  const models = ["Field Mini", "Atlas Base", "Archive Small"].map((display_name, i) => ({
    id: ["field-mini", "atlas-base", "archive-small"][i], display_name, legacy: i === 2,
    engines: [{engine: "cpu", available: true, reason: null}, {engine: "gpu", available: false, reason: "No fixture accelerator"}]
  }));
  function problem(status, code, detail) {
    const title = ({400:"Bad Request",401:"Unauthorized",403:"Forbidden",404:"Not Found",409:"Conflict",415:"Unsupported Media Type",422:"Unprocessable Content"})[status];
    throw Object.assign(new Error(detail), {problem:{type:"about:blank", title, status, code, detail}});
  }
  function integer(value, min, max, field) {
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || +value < min || +value > max)
      problem(400, "invalid_parameter", "Invalid " + field);
    return Number(value);
  }
  function create(scenario, {now} = {}) {
    if (!scenarios.includes(scenario)) problem(400, "unknown_scenario", "Unknown fixture scenario.");
    const empty = scenario === "empty";
    const multi = scenario === "multi-account";
    const spaces = [{id:"studio", name:"Studio notebook", role:"owner", active:true}];
    if (multi) spaces.push({id:"archive", name:"Personal archive", role:"owner", active:false});
    const memories = Array.from({length:empty ? 0 : 1000}, (_, i) => ({
      id:"note-" + (i + 1), space_id:multi && i % 2 ? "archive" : "studio",
      title:notes[i % notes.length] + " / " + (i + 1), category:topics[i % topics.length],
      content:["Group related observations before writing the synthesis.", "Keep the reading order clear across window sizes.",
        "Record the source and the question it helped answer.", "Review the decision after the next field session."][i % 4],
      parent_id:i < 4 ? null : "note-" + (1 + i % 4), tags:["notebook"], created_at:stamp, updated_at:stamp
    }));
    let account = empty ? null : "studio";
    let transaction = "none";
    const journals = new Map([["studio", empty ? [] : [{id:"day-1", date, content:"Reviewed the field notes and collected open questions for the next session.", updated_at:stamp}]]]);
    let active = models[0].id;
    const installed = new Set([active, models[2].id]);
    const config = {language:"en", model_mirror:"local-fixture", diary_mode:"manual", proxy_url:null};
    const membersBySpace = new Map(spaces.map(s => [s.id, [{member_id:"owner", display_name:"Robin Lee", role:"owner", status:"active"}]]));
    const grantId = "00000000-0000-4000-8000-000000000001";
    const grantsBySpace = new Map(spaces.map(s => [s.id, empty ? [] : [{id:grantId,label:"Research reader",root_id:"00000000-0000-4000-8000-000000000002",created_at:stamp,revoked:false}]]));
    const deleted = new Set();
    const queries = new Map();
    const reviews = new Map();
    const scopes = ["grants:read","grants:revoke","stats:read","query-log:read","reviews:read","sync-conflicts:read"];
    const leases = new Map();
    let proofUsed = false;
    let leaseSequence = 0;
    let clock = 0;
    const currentTime = () => now ? now() : clock;
    const plans = new Map();
    const conflicts = multi ? [
      {epoch:"fixture-epoch",revision:"9007199254740993",memory_id:"note-1",state:"pending",current_head_revision:"9007199254740994"},
      {epoch:"fixture-epoch",revision:"2",memory_id:"note-3",state:"processed",resolution:"keep_local"}
    ] : [];
    function invalidate() { leases.clear(); }
    function record(item, action) {
      const entries = reviews.get(item.id) ?? [];
      entries.unshift({sequence:String(entries.length + 1),record_revision:"fixture-" + (entries.length + 1),action,happened_at:stamp});
      reviews.set(item.id,entries);
    }
    let outbox = multi ? 4 : 0;
    let seq = 0;
    const ops = new Map();
    const archives = new Map();
    function start(kind, target) {
      if ([...ops.values()].some(o => o.kind === kind && o.state === "running"))
        problem(409, "operation_in_progress", "An operation of this kind is already running.");
      const operation_id = "op-" + (++seq);
      ops.set(operation_id, {operation_id, kind, state:"running", progress_percent:0, target});
      return {operation_id, status:"running"};
    }
    if (scenario === "downloading-sse") start("model_download", models[1].id);
    function snapshot(id) {
      if (!ops.has(id)) problem(404, "operation_not_found", "Unknown operation.");
      const {target, ...status} = ops.get(id);
      return status;
    }
    function tick(id) {
      const op = ops.get(id);
      if (snapshot(id).state === "running") {
        op.progress_percent += 25;
        if (op.progress_percent === 100) {
          op.state = "completed";
          if (op.kind === "backup_import" && !spaces.some(s => s.id === op.target.space)) {
            op.state = "failed";
            op.error = {type:"about:blank",title:"Conflict",status:409,code:"space_deleted",detail:"The restore destination was deleted."};
            return snapshot(id);
          }
          if (op.kind === "model_download") installed.add(op.target);
          if (op.kind === "model_switch") {
            if (scenario === "switch-rollback-error") {
              op.state = "failed";
              op.message = "Active model unchanged.";
              op.error = {type:"about:blank", title:"Switch failed", status:409, code:"model_switch_rollback",
                detail:"Fixture index verification failed. Previous model unchanged.", retryable:false};
            } else active = op.target;
          }
          if (op.kind === "sync") outbox = 0;
          if (op.kind === "organize") {
            if (op.target.some(move => !memories.some(m => m.id === move.memory_id && !deleted.has(m.id)) || !memories.some(m => m.id === move.new_parent_id && !deleted.has(m.id)))) {
              op.state = "failed";
              op.error = {type:"about:blank",title:"Conflict",status:409,code:"stale_plan",detail:"A planned memory was removed."};
            } else for (const move of op.target) {
              const item = memories.find(m => m.id === move.memory_id);
              item.parent_id = move.new_parent_id;
              record(item,"deepen");
            }
          }
          if (op.kind === "organize_split") {
            const item = memories.find(m => m.id === op.target && !deleted.has(m.id));
            if (!item) {
              op.state = "failed";
              op.error = {type:"about:blank",title:"Conflict",status:409,code:"stale_split",detail:"The selected memory was removed."};
            } else {
              const words = item.content.split(/\s+/);
              const middle = Math.ceil(words.length / 2);
              const child = {...item,id:"split-" + (++seq),parent_id:item.id,title:item.title + " / continuation",content:words.slice(middle).join(" ")};
              item.content = words.slice(0,middle).join(" ");
              memories.push(child);
              record(item,"split");
              record(child,"create");
            }
          }
          if (op.kind === "backup_import") {
            const archive = op.target;
            for (let i = memories.length - 1; i >= 0; i--) if (memories[i].space_id === archive.space) { deleted.delete(memories[i].id); memories.splice(i,1); }
            memories.push(...structuredClone(archive.items));
            journals.set(archive.space,structuredClone(archive.diary));
          }
        }
      }
      return snapshot(id);
    }
    function request(method, address, body = {}, headers = {authorization:"Bearer synthetic-preview-only"}) {
      const url = new URL(address, "http://127.0.0.1");
      const path = url.pathname;
      const key = method + " " + path;
      const ok = (data, status = 200) => ({status, data});
      if (key === "POST /v1/auth/handshake") {
        // Synthetic single-use proof only: no signing, OS credential access, or production ownership claim.
        if (headers["x-respire-handshake-proof"] !== "synthetic-owner-proof-only" || proofUsed || !account)
          problem(401,"owner_proof_rejected","Synthetic owner proof rejected.");
        if (Object.keys(body).some(k => k !== "scopes") || !Array.isArray(body.scopes) || !body.scopes.length ||
            body.scopes.length > 6 || new Set(body.scopes).size !== body.scopes.length || body.scopes.some(s => !scopes.includes(s)))
          problem(400,"invalid_scopes","Select distinct supported fixture scopes.");
        proofUsed = true;
        const access_token = "synthetic-owner-lease-" + (++leaseSequence);
        leases.set(access_token,{scopes:[...body.scopes],expires:currentTime() + 300});
        return ok({access_token,token_type:"Bearer",expires_in:300,scopes:[...body.scopes]});
      }
      const required = path === "/v1/grants" ? "grants:read" : /^\/v1\/grants\/[^/]+$/.test(path) ? "grants:revoke" :
        path === "/v1/stats" ? "stats:read" : path === "/v1/query-log" ? "query-log:read" :
        /^\/v1\/memories\/[^/]+\/reviews$/.test(path) ? "reviews:read" : path === "/v1/sync/conflicts" ? "sync-conflicts:read" : null;
      if (required) {
        const lease = leases.get(headers.authorization?.replace(/^Bearer /,""));
        if (!lease || lease.expires <= currentTime()) problem(401,"owner_token_required","Use an unexpired synthetic owner lease.");
        if (!lease.scopes.includes(required)) problem(403,"scope_denied","The fixture lease does not allow this operation.");
      } else if (key !== "GET /v1/health" && headers.authorization !== "Bearer synthetic-preview-only") {
        problem(401,"unauthorized","Use the synthetic preview bearer.");
      }
      const spacePath = /^\/v1\/spaces\/([^/]+)(?:\/members)?$/.exec(path);
      const space = spacePath?.[1] ?? (key === "POST /v1/organize/deepen/apply" && typeof body.plan_id === "string" ? body.plan_id.replace(/^plan-/,"") : undefined) ?? url.searchParams.get("space_id") ?? body.space_id ?? account ?? spaces[0]?.id;
      if (required && space !== account) problem(403,"library_mismatch","Owner leases are bound to the active library.");
      const selected = spaces.find(s=>s.id === space);
      if (!selected && (spacePath || url.searchParams.has("space_id") || body.space_id)) problem(404,"space_not_found","Unknown fixture space.");
      const diary = journals.get(space) ?? [];
      const members = membersBySpace.get(space) ?? [];
      const grants = grantsBySpace.get(space) ?? [];
      const allItems = memories.filter(m => m.space_id === space);
      const items = allItems.filter(m => !deleted.has(m.id));
      const itemById = id => {
        const item = items.find(m => m.id === id);
        if (!item) problem(404,"memory_not_found","Unknown memory in this space.");
        return item;
      };
      const text = (value, field) => { if (typeof value !== "string" || !value.trim()) problem(400,"invalid_field","Enter " + field + "."); };
      const validateMemory = value => {
        for (const field of ["title","content","category"]) if (field in value) text(value[field],field);
        if ("tags" in value && (!Array.isArray(value.tags) || value.tags.some(t => typeof t !== "string"))) problem(400,"invalid_tags","Tags must be strings.");
        if (value.parent_id != null) itemById(value.parent_id);
      };
      const limit = () => integer(url.searchParams.get("limit") ?? 50,1,200,"limit");
      if (key === "GET /v1/health") return ok({status:"ready", instance_id:"preview", active_space_id:account ?? "studio",
        capabilities:["openapi.v1","model.catalog.v2","model.active_assets","model.managed_download","sse.operations.v1","host.transactions.v1","backups.v1","auth.handshake.v1"]});
      if (key === "GET /v1/status/light") return ok({space_id:space, memory_count:items.length, diary_count:diary.length, indexed_count:items.length, last_updated_at:items.length ? stamp : null});
      if (key === "GET /v1/memories") {
        const offset = integer(url.searchParams.get("cursor") ?? 0, 0, Number.MAX_SAFE_INTEGER, "cursor");
        const limit = integer(url.searchParams.get("limit") ?? 50, 1, 200, "limit");
        return ok({items:items.slice(offset,offset+limit), next_cursor:offset+limit < items.length ? String(offset+limit) : null});
      }
      if (key === "POST /v1/memories") {
        if (typeof body.content !== "string" || !body.content.trim()) problem(400,"invalid_content","Enter a note first.");
        if (!selected) problem(409,"no_active_space","Create a space first.");
        validateMemory(body);
        const item = {id:"draft-" + (++seq), space_id:space, title:body.title ?? "Session note", content:body.content, category:body.category ?? "Inbox", parent_id:body.parent_id ?? null, tags:body.tags ?? [], created_at:stamp, updated_at:stamp};
        memories.unshift(item);
        record(item,"create");
        return ok(item,201);
      }
      if (key === "POST /v1/memories/recall") {
        if (typeof body.query !== "string" || !body.query.trim()) problem(400,"invalid_query","Enter a search term.");
        const limit = integer(body.top_k ?? 10,1,100,"top_k");
        const hits = items.filter(m => [m.title,m.content,m.category].join(" ").toLowerCase().includes(body.query.toLowerCase())).slice(0,limit).map(memory => ({memory,score:1}));
        const entries = queries.get(space) ?? [];
        entries.unshift({id:String(entries.length + 1),recorded_at:stamp,candidate_count:hits.length,adopted_count:0,good_count:0,bad_count:0});
        queries.set(space,entries);
        return ok({hits});
      }
      const memoryPath = /^\/v1\/memories\/([^/]+)(\/reviews)?$/.exec(path);
      if (memoryPath && ["GET","PATCH","DELETE"].includes(method)) {
        const item = itemById(memoryPath[1]);
        if (memoryPath[2]) {
          if (method === "GET") return ok({items:(reviews.get(item.id) ?? []).slice(0,limit())});
          problem(404,"route_not_found","Unknown fixture route.");
        }
        if (method === "PATCH") {
          validateMemory(body);
          for (const field of ["title","content","tags"]) if (field in body) item[field] = structuredClone(body[field]);
          record(item,"update");
        }
        if (method === "DELETE") { deleted.add(item.id); record(item,"delete"); return ok(undefined,204); }
        return ok(item);
      }
      if (key === "GET /v1/organize/suggestions") return ok({suggestions:items.filter(m => m.content.split(/\s+/).length > 1).slice(0,integer(url.searchParams.get("top") ?? 50,1,200,"top")).map(m => ({kind:"split",target_id:m.id,summary:"Review this synthetic note for splitting."}))});
      if (key === "POST /v1/organize/split") {
        text(body.memory_id,"memory_id");
        const item = itemById(body.memory_id);
        if (item.content.trim().split(/\s+/).length < 2) problem(409,"cannot_split","The selected note has only one word.");
        return ok(start("organize_split",item.id),202);
      }
      if (key === "GET /v1/backups/export") {
        const archive = {format:"respire-synthetic-fixture-v1",space,items,diary};
        const encoded = JSON.stringify(archive);
        archives.set(encoded,structuredClone(archive));
        return {status:200,data:new TextEncoder().encode(encoded),media:"application/octet-stream"};
      }
      if (key === "POST /v1/backups/import") {
        if (!(body instanceof Uint8Array)) problem(415,"expected_archive","Send synthetic archive bytes.");
        const archive = archives.get(new TextDecoder().decode(body));
        if (!archive || archive.space !== space) problem(400,"invalid_archive","Only an unchanged fixture export for this space can be restored.");
        return ok(start("backup_import",structuredClone(archive)),202);
      }
      if (key === "GET /v1/grants") return ok({items:grants});
      if (method === "DELETE" && /^\/v1\/grants\/[^/]+$/.test(path)) {
        const id = path.split("/").at(-1);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) problem(400,"invalid_grant_id","Use a full grant UUID.");
        const grant = grants.find(g => g.id === id);
        if (grant) grant.revoked = true;
        return ok(undefined,204);
      }
      if (key === "GET /v1/stats") return ok({local_total:allItems.length,local_alive:items.length,remote_configured:multi,...(allItems.length ? {max_updated_at:stamp} : {})});
      if (key === "GET /v1/query-log") {
        const entries = queries.get(space) ?? [];
        return ok({items:entries.slice(0,limit()),stats:{total:entries.length,with_adopted:0,empty_candidates:entries.filter(e => !e.candidate_count).length,good_total:0,bad_total:0}});
      }
      if (key === "GET /v1/sync/conflicts") {
        const processed = url.searchParams.get("include_processed") ?? "false";
        if (!["true","false"].includes(processed) || url.searchParams.get("memory_id") === "") problem(400,"invalid_parameter","Invalid conflict filter.");
        return ok({items:conflicts.filter(c => items.some(m => m.id === c.memory_id) && (processed === "true" || c.state === "pending") && (!url.searchParams.has("memory_id") || c.memory_id === url.searchParams.get("memory_id")))});
      }
      if (key === "GET /v1/diary") return ok({entries:diary.filter(d => !url.searchParams.has("date") || d.date === url.searchParams.get("date"))});
      if (key === "POST /v1/diary") {
        if (typeof body.content !== "string" || !body.content.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) problem(400,"invalid_entry","Enter a date and text.");
        const entry = {date:body.date, content:body.content, updated_at:stamp, id:"day-" + body.date};
        journals.set(space,[entry,...diary.filter(d => d.date !== body.date)]);
        return ok(entry);
      }
      if (key === "POST /v1/organize/deepen/plan") {
        const root = body.parent_id == null ? items[0] : itemById(body.parent_id);
        const moves = items.slice(4,8).filter(m => m.id !== root.id && m.parent_id !== root.id).map(m => ({memory_id:m.id,new_parent_id:root.id,reason:"Group related research notes"}));
        const plan = {plan_id:"plan-" + space,moves};
        plans.set(plan.plan_id,structuredClone(plan));
        return ok(plan);
      }
      if (key === "POST /v1/organize/deepen/apply") {
        const plan = plans.get(body.plan_id);
        if (!plan || !plan.moves.length) problem(409,"invalid_plan","Preview an applicable plan first.");
        const op = start("organize",plan.moves);
        plans.delete(body.plan_id);
        return ok(op,202);
      }
      if (key === "GET /v1/models/catalog") return ok({active_model_id:active,models});
      if (key === "GET /v1/models/active-assets") return ok({active_model_id:active,active_paths:["fixture/" + active],locked:true});
      if (["POST /v1/models/downloads","POST /v1/models/switch"].includes(key)) {
        const model = models.find(m => m.id === body.model_id);
        if (!model || !model.engines.some(e => e.available && e.engine === (body.engine ?? "cpu"))) problem(400,"invalid_model","Select an available model and engine.");
        if (path.endsWith("switch") && !installed.has(model.id)) problem(400,"model_missing","Download the model first.");
        return ok(start(path.endsWith("switch") ? "model_switch" : "model_download",model.id),202);
      }
      const operation = /^\/v1\/operations\/([^/]+)$/.exec(path);
      if (operation && ["GET","DELETE"].includes(method)) {
        const id = operation[1];
        if (method === "GET") return ok(snapshot(id));
        if (snapshot(id).state !== "running") problem(409,"operation_finished","Operation already finished.");
        ops.get(id).state = "cancelled";
        return ok(snapshot(id),202);
      }
      if (key === "GET /v1/sync/status") return ok({state:[...ops.values()].some(o=>o.kind === "sync" && o.state === "running") ? "syncing" : "idle",pending_outbox:outbox,last_synced_at:empty ? null : stamp});
      if (key === "POST /v1/sync/trigger") return ok(start("sync"),202);
      if (key === "GET /v1/spaces") return ok({spaces:spaces.map(s => ({...s,active:s.id === space}))});
      if (key === "POST /v1/spaces") {
        text(body.name,"space name");
        const created = {id:"space-" + (++seq),name:body.name,role:"owner",active:!spaces.length};
        if (created.active) { account = created.id; invalidate(); }
        spaces.push(created);
        membersBySpace.set(created.id,[{member_id:"owner",role:"owner",status:"active"}]);
        grantsBySpace.set(created.id,[]);
        return ok(created,201);
      }
      if (spacePath && !path.endsWith("/members")) {
        if (method === "GET") return ok({...selected,active:account === selected.id});
        if (method === "PATCH") {
          if ("name" in body) text(body.name,"space name");
          if ("active" in body && typeof body.active !== "boolean") problem(400,"invalid_active","Active must be a boolean.");
          if (body.active === false && account === space) problem(409,"active_space","Activate another space first.");
          if ("name" in body) selected.name = body.name;
          if (body.active && account !== space) { account = space; invalidate(); }
          return ok({...selected,active:account === space});
        }
        if (method === "DELETE") {
          if (account === space) problem(409,"active_space","Activate another space before deleting this one.");
          spaces.splice(spaces.indexOf(selected),1);
          for (let i = memories.length - 1; i >= 0; i--) if (memories[i].space_id === space) { deleted.delete(memories[i].id); reviews.delete(memories[i].id); memories.splice(i,1); }
          journals.delete(space); membersBySpace.delete(space); grantsBySpace.delete(space); queries.delete(space);
          return ok(undefined,204);
        }
      }
      if (spacePath && path.endsWith("/members") && method === "GET") return ok({members});
      if (spacePath && path.endsWith("/members") && method === "POST") {
        if (typeof body.identifier !== "string" || !body.identifier.trim() || !["viewer","editor"].includes(body.role)) problem(400,"invalid_member","Supply an identifier and role.");
        if (members.some(m => m.member_id === body.identifier)) problem(409,"duplicate_member","Member already exists.");
        const member = {member_id:body.identifier,display_name:body.identifier,role:body.role,status:"pending"};
        members.push(member);
        return ok(member,201);
      }
      if (key === "GET /v1/host/account") return ok({signed_in:!!account,account_id:account,transaction_state:transaction});
      if (key === "POST /v1/host/transactions/login") {
        if (!["browser_oauth","offline_keygen","recovery"].includes(body.mode) || ("passphrase_present" in body && typeof body.passphrase_present !== "boolean")) problem(400,"invalid_login","Select a supported fixture login mode.");
        transaction = body.mode === "browser_oauth" ? "login_pending" : body.mode === "recovery" ? "recovery_pending" : "none";
        if (body.mode === "browser_oauth") return ok({status:"pending_browser",authorize_url:null,message:"Synthetic browser login pending; no external identity provider is contacted."});
        if (body.mode === "recovery") return ok({status:"pending_confirmation",message:"Synthetic recovery awaits confirmation; no keys are loaded."});
        if (!spaces.length) problem(409,"no_space","Create a synthetic space before setup.");
        account = spaces[0].id;
        invalidate();
        return ok({status:"completed"});
      }
      if (key === "POST /v1/host/transactions/logout") { account = null; transaction = "none"; invalidate(); return ok({status:"completed"}); }
      if (key === "GET /v1/host/config") return ok({...config});
      if (key === "PATCH /v1/host/config") {
        for (const field of ["language","model_mirror","diary_mode"]) if (field in body) text(body[field],field);
        if ("proxy_url" in body && body.proxy_url !== null && typeof body.proxy_url !== "string") problem(400,"invalid_config","Proxy must be a string or null.");
        for (const field of Object.keys(config)) if (field in body) config[field] = body[field];
        return ok({...config});
      }
      // Preview-only controls have no canonical Runtime operation.
      if (key === "GET /preview/library") return ok({installed:[...installed],operations:[...ops.keys()].map(snapshot),accounts:spaces.map(s=>s.id)});
      if (key === "POST /preview/uninstall") {
        if (body.model_id === active) problem(409,"active_model","Active model is in use.");
        if (!installed.delete(body.model_id)) problem(404,"model_missing","Model is not installed.");
        return ok({installed:[...installed]});
      }
      if (key === "POST /preview/account" && spaces.some(s => s.id === body.id)) { account = body.id; invalidate(); return ok({account}); }
      problem(404,"route_not_found","Unknown fixture route.");
    }
    return {request,tick,snapshot,advanceTime:seconds => { clock += integer(seconds,0,Number.MAX_SAFE_INTEGER,"seconds"); }};
  }
  globalThis.RespireFixture = {scenarios,create,problem};
})();
