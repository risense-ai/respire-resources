import http from "node:http";
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import "./fixture.js";

const {create, scenarios, problem} = globalThis.RespireFixture;
export function server({interval = 700} = {}) {
  const fixtures = new Map(scenarios.map(name => [name, create(name,{now:()=>performance.now()/1000})]));
  const jobs = new Map();
  const timers = new Set();
  function watch(name, id) {
    const key = name + "/" + id;
    if (jobs.has(key)) return jobs.get(key);
    const fixture = fixtures.get(name);
    const listeners = new Set();
    jobs.set(key,listeners);
    const timer = setInterval(() => {
      const status = fixture.tick(id);
      for (const send of listeners) send(status);
      if (status.state !== "running") {
        clearInterval(timer);
        timers.delete(timer);
        jobs.delete(key);
      }
    },interval);
    timers.add(timer);
    return listeners;
  }
  const app = http.createServer(async (req,res) => {
    try {
      const host = "127.0.0.1:" + app.address().port;
      if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== "http://" + host))
        problem(403,"origin_denied","Use the loopback preview origin.");
      const url = new URL(req.url,"http://" + host);
      const path = url.pathname;
      res.setHeader("Cache-Control","no-store");
      res.setHeader("X-Content-Type-Options","nosniff");
      if (req.method === "GET" && path === "/") {
        res.writeHead(302,{Location:"/pages/overview.html"}).end();
        return;
      }
      if (req.method === "GET" && /^\/(pages\/[a-z-]+\.(html|js)|tokens\/[a-z-]+\.css|mock-api\/fixture\.js)$/.test(path)) {
        const data = await readFile(new URL(".." + path,import.meta.url));
        const type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html";
        res.writeHead(200,{"Content-Type":type + "; charset=utf-8"}).end(data);
        return;
      }
      const name = url.searchParams.get("scenario") ?? req.headers["x-mock-scenario"] ?? "rich-1k";
      if (!fixtures.has(name)) problem(400,"unknown_scenario","Unknown fixture scenario.");
      const fixture = fixtures.get(name);
      const events = /^\/v1\/operations\/([^/]+)\/events$/.exec(path);
      if (req.method === "GET" && events) {
        const id = events[1];
        const initial = fixture.request("GET","/v1/operations/" + id,{},req.headers).data;
        res.writeHead(200,{"Content-Type":"text/event-stream"});
        const send = status => {
          const event = status.state === "running" ? "progress" : status.state;
          res.write("event: " + event + "\ndata: " + JSON.stringify(status) + "\n\n");
          if (event !== "progress") res.end();
        };
        send(initial);
        if (initial.state === "running") {
          const listeners = watch(name,id);
          listeners.add(send);
          res.once("close",()=>listeners.delete(send));
        }
        return;
      }
      let body = {};
      if (["PATCH","POST"].includes(req.method)) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        const binary = path === "/v1/backups/import";
        const optional = ["/v1/host/transactions/logout","/v1/sync/trigger"].includes(path);
        const expected = binary ? "application/octet-stream" : "application/json";
        if ((bytes.length || !optional) && req.headers["content-type"]?.split(";")[0] !== expected) problem(415,"unsupported_media","Send " + expected + ".");
        if (binary) body = bytes;
        else if (bytes.length || !optional) {
          try { body = JSON.parse(bytes.toString()); }
          catch { problem(400,"invalid_json","Malformed JSON body."); }
          if (!body || typeof body !== "object" || Array.isArray(body)) problem(400,"invalid_body","Expected a JSON object.");
        }
      }
      const {status,data,media} = fixture.request(req.method,req.url,body,req.headers);
      if (data?.operation_id && data.status === "running") watch(name,data.operation_id);
      if (status === 204) res.writeHead(status).end();
      else if (media) {
        res.writeHead(status,{"Content-Type":media});
        res.write(data);
        res.end();
      } else res.writeHead(status,{"Content-Type":"application/json"}).end(JSON.stringify(data));
    } catch (error) {
      const issue = error.problem ?? {type:"about:blank",title:error.code === "ENOENT" ? "Not Found" : "Internal Error",
        status:error.code === "ENOENT" ? 404 : 500,code:"preview_error",detail:error.message};
      if (issue.status === 401) res.setHeader("WWW-Authenticate","Bearer");
      res.writeHead(issue.status,{"Content-Type":"application/problem+json"}).end(JSON.stringify(issue));
    }
  });
  app.on("close",()=>{for (const timer of timers) clearInterval(timer);});
  return app;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.argv[2] ?? 4173);
  const app = server().listen(port,"127.0.0.1",()=>console.log("Preview: http://127.0.0.1:" + app.address().port));
}
