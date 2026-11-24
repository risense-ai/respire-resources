import assert from "node:assert/strict";
import childProcess, {execFile} from "node:child_process";
import {EventEmitter, once} from "node:events";
import {readFile, mkdir, mkdtemp, realpath, rm, rmdir, stat, writeFile} from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {join, relative, isAbsolute, sep} from "node:path";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {harness} from "../prototypes/mock-api/http-harness.mjs";
import {loadScenarios, runScenario} from "./runner.mjs";
import {httpTarget, isolatedEnv, mockTarget, ownedProcess, probeReadiness, sseFrames, withRuntime} from "./targets.mjs";
import {exactBytes, httpBurst, httpRoundTrip, minimumBytes, payload} from "./plugin-rpc/transport.mjs";
import {decodeResult, frame} from "./plugin-rpc/mcp.mjs";
import {cancellationServer} from "./client2-e2e/cancellation.mjs";
import {screens, validateCatalogs, validateScreens} from "./client2-e2e/layout.mjs";

test("owned process waits for child exit and closes test-owned stdio", async t => {
  const root = await mkdtemp(join(tmpdir(), "respire-process-"));
  const owner = ownedProcess(process.execPath, ["-e", 'console.log("ready"); setInterval(() => {}, 1000)'], {
    cwd: root, env: isolatedEnv(root, 0, "unit-fixture-only"), stdio: ["pipe", "pipe", "pipe"]
  });
  t.after(async () => {
    await owner.stop();
    await rm(root, {recursive: true, maxRetries: 3, retryDelay: 100});
  });
  const [ready] = await once(owner.child.stdout, "data", {signal: AbortSignal.timeout(3000)});
  assert.match(String(ready), /ready/);
  await owner.stop();
  assert((await owner.closed).signal || owner.child.exitCode !== null);
  assert(owner.child.stdio.every(stream => stream.destroyed));
});

test("Windows Runtime cleanup retries a sharing lock and reports a persistent lock with the assertion",
  {skip: process.platform !== "win32"}, async t => {
    const {spawn} = childProcess;
    let runtime;
    const stub = t.mock.method(childProcess, "spawn", (binary, args, options) => {
      if (args[0] !== "serve") return spawn(binary, args, options);
      runtime = spawn(binary, ["-e", "setInterval(() => {}, 1000)"], options);
      return runtime;
    });
    syncBuiltinESMExports();
    t.mock.method(globalThis, "fetch", async () => Response.json({pid: runtime.pid, status: "ready"}));
    t.after(() => {
      stub.mock.restore();
      syncBuiltinESMExports();
    });

    for (const persistent of [false, true]) {
      let root;
      let holder;
      let release;
      const assertion = new Error("synthetic functional assertion");
      try {
        const result = withRuntime(process.execPath, undefined, async context => {
          root = context.root;
          const locked = join(root, "locked");
          await mkdir(locked);
          holder = ownedProcess(process.execPath, ["-e", 'console.log("locked"); setInterval(() => {}, 1000)'], {
            cwd: locked, env: context.env, stdio: ["ignore", "pipe", "ignore"]
          });
          await once(holder.child.stdout, "data", {signal: AbortSignal.timeout(3000)});
          await assert.rejects(rmdir(locked), {code: "EBUSY"});
          if (persistent) throw assertion;
          release = delay(200).then(() => holder.stop());
          return "functional result";
        });
        if (persistent) {
          await assert.rejects(result, error => {
            assert(error instanceof AggregateError);
            assert.equal(error.errors[0], assertion);
            assert.equal(error.errors[1].cause.code, "EBUSY");
            assert(error.message.includes(assertion.message) && error.message.includes(root));
            return true;
          });
          assert((await stat(join(root, "locked"))).isDirectory());
        } else {
          assert.equal(await result, "functional result");
          await assert.rejects(stat(root), {code: "ENOENT"});
        }
      } finally {
        if (release) await release;
        else await holder?.stop();
        if (root) await rm(root, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
      }
    }
  });

test("legacy preflight checks synthetic inputs and reports plans without starting targets", async t => {
  const root = await mkdtemp(join(tmpdir(), "respire-preflight-"));
  t.after(() => rm(root, {recursive: true}));
  const profile = join(root, "profile");
  const nested = join(profile, "synthetic");
  const artifact = join(root, "test-artifact.txt");
  await mkdir(nested, {recursive: true});
  await writeFile(artifact, "Offline path validation test artifact");
  await writeFile(join(nested, "note.txt"), "Synthetic preflight record");
  const smoke = fileURLToPath(new URL("./cli-e2e/smoke.mjs", import.meta.url));
  const preflight = (...args) => promisify(execFile)(process.execPath, [smoke, "--preflight", ...args], {cwd: root});
  const runtime = ["--runtime-bin", artifact, "--profile-fixture", profile];

  await assert.rejects(preflight(), /Preflight requires --runtime-bin and --profile-fixture/);
  await assert.rejects(preflight(...runtime, "--released-old"), /Released-old baseline requires --runtime-bin, --cli-bin and --profile-fixture/);
  assert.match((await preflight(...runtime, "--cli-bin", artifact, "--released-old")).stdout,
    /^PLANNED COMPILED LEGACY RPC E2E-007 .* \[released-old\] \(not executed\)$/m);
  const {stdout} = await preflight(...runtime, "--cli-bin", artifact);
  assert.match(stdout, /^PLANNED COMPILED CLI E2E-006 .* \(not executed\)$/m);
  assert.match(stdout, /^PLANNED COMPILED LEGACY RPC E2E-007 .* \(not executed\)$/m);
  assert.doesNotMatch(stdout, /^PASS /m);
  assert.match((await preflight(...runtime)).stdout, /^SKIP COMPILED CLI E2E-006 .*absolute CLI binary/m);

  await assert.rejects(preflight("--runtime-bin", artifact, "--profile-fixture", artifact),
    /Fixture profile must be an absolute directory/);
});

test("readiness selects one route and requires its owned, ready health envelope", async t => {
  const base = "http://127.0.0.1:31337";
  const pid = 123;
  const scope = {account_id: "synthetic", instance_id: "fixture", generation: 1};
  const legacy = {server: "respire", v: 1, pid, state: "ready", startup_complete: true, ...scope};
  let reply;
  const fetch = t.mock.method(globalThis, "fetch", async () => reply);
  const probe = (status, data, releasedOld) => {
    reply = Response.json(data, {status});
    return probeReadiness(base, pid, releasedOld);
  };

  await assert.rejects(probe(404, {error: "unknown runtime endpoint"}), /Unexpected health response from \/v1\/health/);
  assert.deepEqual(fetch.mock.calls.map(call => call.arguments[0]), [base + "/v1/health"]);
  await assert.rejects(probe(200, legacy), /ready/);
  assert.deepEqual(await probe(200, {pid, status: "ready"}), {pid, status: "ready"});

  assert.deepEqual(await probe(200, legacy, true), legacy);
  assert.equal(fetch.mock.calls.at(-1).arguments[0], base + "/api/health");
  assert.equal(await probe(200, {...legacy, startup_complete: false}, true), undefined);
  assert.equal(await probe(503, {error: "runtime_starting"}, true), undefined);
  await assert.rejects(probe(503, {error: "legacy_host_binding_changed"}, true), /Unexpected health response/);
  await assert.rejects(probe(200, {...legacy, pid: pid + 1}, true), /owned Runtime PID/);
  await assert.rejects(probe(200, {...legacy, generation: 0}, true), /Missing legacy Runtime scope/);
  await assert.rejects(probe(200, {...legacy, state: "draining"}, true), /ready/);
});

test("released RPC uses the historical route and scopes only CLI dispatch", async t => {
  const base = "http://127.0.0.1:31337";
  const scope = {account_id: "synthetic", instance_id: "fixture", generation: 1};
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  const send = (target, body) => target.request({method: "POST", path: "/rpc", body});
  const cli = {v: 1, id: "cli", method: "cli.exec", args: ["status", "--json"]};
  const status = {v: 1, id: "status", method: "runtime.status", args: []};
  const legacy = httpTarget(base, {}, scope);

  await send(httpTarget(base), cli);
  await send(legacy, cli);
  await send(legacy, status);
  assert(fetch.mock.calls.every(({arguments: [, options]}) => options.headers.connection === "close"));
  assert.deepEqual(fetch.mock.calls.map(({arguments: [url, options]}) => [url, JSON.parse(options.body)]), [
    [base + "/rpc", cli],
    [base + "/api/rpc", {...cli, scope}],
    [base + "/api/rpc", status]
  ]);
});

for (const scenario of await loadScenarios()) {
  if (scenario.target) continue;
  test("Mock fixture " + scenario.id + " " + scenario.title, async () => {
    await runScenario(scenario, mockTarget(scenario.mock), scenario.mockInputs);
  });
}

test("rejects prose assertions, unresolved references and missing declared fixture inputs", async () => {
  const target = mockTarget("empty");
  await assert.rejects(runScenario({steps: [{name: "bad", assert: ["some claim"]}]}, target), /exactly one action/);
  await assert.rejects(runScenario({steps: [{name: "bad", request: {
    method: "GET", path: "/v1/operations/\${missing}"
  }, expect: {status: 200}}]}, target), /Undefined variable missing/);
  await assert.rejects(runScenario({inputs: ["model"], steps: [{}]}, target), /Missing required input model/);
});

test("SSE parser handles split CRLF and UTF-8 and rejects incomplete events", async () => {
  const data = {state: "cancelled", message: payload("sse").content.slice(0, 200)};
  const bytes = Buffer.from("event: cancelled\r\ndata: " + JSON.stringify(data) + "\r\n\r\n");
  assert.deepEqual(await Array.fromAsync(sseFrames((function* () {
    for (const byte of bytes) yield Uint8Array.of(byte);
  })())), [{event: "cancelled", data}]);
  assert.deepEqual(await Array.fromAsync(sseFrames([Buffer.from("event: completed\rdata: {}\r\r")])),
    [{event: "completed", data: {}}]);
  await assert.rejects(Array.fromAsync(sseFrames([Buffer.from("event: completed\ndata: {}")])), /Incomplete SSE/);
});

test("CARD-017 HTTP adapter round-trips a large nested UTF-8 note in process", async t => {
  const app = harness();
  t.after(app.close);
  const target = {async request({method, path, body}) {
    const response = await app.call(method, path, body);
    return {status: response.status, data: response.json()};
  }};
  assert(await httpRoundTrip(target) > minimumBytes);
  await httpBurst(target);
});

test("MCP builds one newline-delimited UTF-8 request and rejects corrupt responses", () => {
  const original = payload("mcp");
  const message = frame(1, "tools/call", {name: "memory_remember", arguments: original});
  assert(message.length - 1 > minimumBytes);
  const lines = message.toString("utf8").split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[1], "");
  exactBytes(JSON.parse(lines[0]).params.arguments.content, original.content);
  assert.throws(() => exactBytes(original.content.slice(0, -1), original.content), /byte length changed/);
  assert.throws(() => exactBytes(original.content.replace("card018", "card019"), original.content), /bytes changed/);
  assert.throws(() => decodeResult('{"jsonrpc":"2.0","id":2,"result":{}}', 1));
  assert.throws(() => decodeResult('{"jsonrpc":"2.0","id":1,"error":{"code":-32603}}', 1));
});

test("isolated home, profile and binary directories resolve under a normal UTF-8 temp directory", async t => {
  const {directory} = JSON.parse(await readFile(new URL("./fixtures/i18n/transport.json", import.meta.url), "utf8"));
  const root = await mkdtemp(join(tmpdir(), "respire card018 "));
  t.after(() => rm(root, {recursive: true, force: true}));
  const workspace = join(root, directory);
  await mkdir(workspace);
  const env = isolatedEnv(workspace, 31337, "unit-fixture-only");
  const realRoot = await realpath(root);
  for (const key of ["HOME", "USERPROFILE", "TEMP", "RSRS_DATA_DIR", "RSRS_BIN_DIR"]) {
    await mkdir(env[key], {recursive: true});
    const child = relative(realRoot, await realpath(env[key]));
    assert(child.startsWith(directory + sep) || child === directory);
    assert(!isAbsolute(child));
  }
});

test("gallery cancellation holds the SSE stream open until DELETE and then closes with cancelled", async t => {
  t.mock.timers.enable({apis: ["setInterval"]});
  const app = cancellationServer();
  app.address = () => ({port: 4173});
  t.after(() => app.emit("close"));
  function request(method, path) {
    const res = Object.assign(new EventEmitter(), {chunks: [], ended: false});
    res.writeHead = (status, headers) => Object.assign(res, {status, headers});
    res.write = chunk => res.chunks.push(Buffer.from(chunk));
    res.end = chunk => {
      if (chunk !== undefined) res.write(chunk);
      res.ended = true;
      res.emit("close");
    };
    app.emit("request", {
      method, url: path + "?scenario=downloading-sse",
      headers: {host: "127.0.0.1:4173", authorization: "Bearer synthetic-preview-only"}
    }, res);
    return res;
  }
  const operation = "/v1/operations/op-1";
  const stream = request("GET", operation + "/events");
  const frames = () => Array.fromAsync(sseFrames(stream.chunks));
  assert.equal(stream.status, 200);
  assert.equal(stream.headers["Content-Type"], "text/event-stream");
  t.mock.timers.tick(10_000);
  assert.equal(stream.ended, false);
  let seen = await frames();
  assert.deepEqual(seen.map(({event, data}) => [event, data.state, data.progress_percent]), [["progress", "running", 0]]);
  const response = request("DELETE", operation);
  assert.equal(response.status, 202);
  const snapshot = JSON.parse(Buffer.concat(response.chunks));
  assert.equal(snapshot.state, "cancelled");
  assert.equal(stream.ended, true);
  seen = await frames();
  assert.deepEqual(seen.slice(1), [{event: "cancelled", data: snapshot}]);
});

test("bilingual layout fixtures match all 16 gallery headings and have complete catalogs", async () => {
  validateScreens();
  for (const [name, [heading]] of Object.entries(screens.en)) {
    const page = await readFile(new URL("../prototypes/pages/" + name + ".html", import.meta.url), "utf8");
    assert(page.includes("<h1>" + heading + "</h1>"));
  }
  validateCatalogs({page: {heading: screens.en.models[0]}}, {page: {heading: screens.zh.models[0]}});
  assert.throws(() => validateCatalogs({page: {heading: "Models"}}, {page: {title: "Models"}}), /keys differ/);
  assert.throws(() => validateCatalogs({page: {heading: "Models"}}, {page: {heading: ""}}), /Invalid translation/);
  assert.throws(() => validateCatalogs({page: {heading: "Models"}}, {page: {heading: "Models"}}, ["page.title"]),
    /Missing required translation/);
});
