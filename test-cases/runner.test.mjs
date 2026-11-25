import assert from "node:assert/strict";
import childProcess, {execFile} from "node:child_process";
import {EventEmitter, once} from "node:events";
import {readFile, mkdir, mkdtemp, realpath, rm, rmdir, stat, writeFile} from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {join, relative, isAbsolute, sep} from "node:path";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";
import {PassThrough} from "node:stream";
import {fileURLToPath} from "node:url";
import {inspect, promisify} from "node:util";
import {harness} from "../prototypes/mock-api/http-harness.mjs";
import {loadScenarios, runScenario} from "./runner.mjs";
import {canonicalMcpEnv, httpTarget, isolatedEnv, mockTarget, ownedProcess, probeReadiness, sseFrames, startupDiagnostics, withRuntime} from "./targets.mjs";
import {exactBytes, httpBurst, httpRoundTrip, minimumBytes, payload} from "./plugin-rpc/transport.mjs";
import {decodeResult, frame, mcpRoundTrip} from "./plugin-rpc/mcp.mjs";
import {cancellationServer} from "./client2-e2e/cancellation.mjs";
import {screens, validateCatalogs, validateScreens} from "./client2-e2e/layout.mjs";

test("owned process waits for child exit and closes test-owned stdio", async t => {
  const child = {stdout: new PassThrough(), stderr: new PassThrough(), exitCode: 2, signalCode: null};
  const diagnostics = startupDiagnostics(child);
  child.stdout.write("secret=synthetic-token C:/private/fixture " + "x".repeat(100_000));
  child.stderr.write("owner credential cannot use any reparse");
  child.stderr.write(" or device; os error 10013; secret=synthetic-token");
  assert.equal(diagnostics(), "exit_code=2; signal=null; diagnostics=owner credential cannot use any reparse or device | os error 10013");
  child.stdout.end();
  child.stderr.end();
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
    let profile;
    let earlyExit = true;
    const stub = t.mock.method(childProcess, "spawn", (binary, args, options) => {
      if (args[0] !== "serve") return spawn(binary, args, options);
      profile = options.env.RSRS_DATA_DIR;
      runtime = spawn(binary, ["-e", earlyExit ?
        'console.error("secret=synthetic-token " + process.env.RSRS_DATA_DIR + " owner credential cannot use any reparse or device"); process.exitCode = 2' :
        "setInterval(() => {}, 1000)"], options);
      return runtime;
    });
    syncBuiltinESMExports();
    t.mock.method(globalThis, "fetch", async base => {
      if (earlyExit) throw new Error("fetch failed", {cause: {code: "ECONNREFUSED"}});
      await mkdir(join(profile, "runtime"), {recursive: true});
      await writeFile(join(profile, "runtime", "endpoint.json"), JSON.stringify({
        pid: runtime.pid, instance_id: "fixture", url: base.replace("/v1/health", "")
      }));
      return Response.json({status: "ready", instance_id: "fixture", capabilities: ["openapi.v1", "sse.operations.v1"]});
    });
    t.after(() => {
      stub.mock.restore();
      syncBuiltinESMExports();
    });

    await assert.rejects(withRuntime(process.execPath, undefined, async () => assert.fail("Must not run")), error => {
      assert.match(error.message, /exit_code=2; signal=null/);
      assert.match(error.message, /owner credential cannot use any reparse or device/);
      assert(!error.message.includes(profile) && !error.message.includes("secret="));
      assert.equal(error.cause, undefined);
      return true;
    });
    earlyExit = false;

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

test("explicit verification rejects missing required suites while optional discovery still skips", async () => {
  const run = (file, ...args) => promisify(execFile)(process.execPath,
    [fileURLToPath(new URL(file, import.meta.url)), ...args]);
  for (const file of ["./runner.mjs", "./cli-e2e/smoke.mjs", "./plugin-rpc/windows.mjs"]) {
    assert.match((await run(file)).stdout, /^SKIP /m);
    await assert.rejects(run(file, "--verify"), error => error.code === 1 && /^SKIP /m.test(error.stdout));
  }
  const {stdout} = await run("./runner.mjs", "--mock", "--verify");
  assert.match(stdout, /SUMMARY passed=5 skipped=2 failures=0 preflight=false/);
  await assert.rejects(run("./cli-e2e/smoke.mjs", "--verify", "--preflight"), /Verification cannot use preflight/);
});

test("readiness selects one route and requires its owned, ready health envelope", async t => {
  const base = "http://127.0.0.1:31337";
  const pid = 123;
  const scope = {account_id: "synthetic", instance_id: "fixture", generation: 1};
  const legacy = {server: "respire", v: 1, pid, state: "ready", startup_complete: true, ...scope};
  const profile = await mkdtemp(join(tmpdir(), "respire-readiness-"));
  t.after(() => rm(profile, {recursive: true}));
  await mkdir(join(profile, "runtime"));
  const endpoint = {pid, instance_id: scope.instance_id, url: base};
  const record = value => writeFile(join(profile, "runtime", "endpoint.json"), JSON.stringify(value));
  await record(endpoint);
  const modern = {status: "ready", instance_id: scope.instance_id, capabilities: ["openapi.v1", "sse.operations.v1"]};
  let reply;
  const fetch = t.mock.method(globalThis, "fetch", async () => reply);
  const probe = (status, data, releasedOld) => {
    reply = Response.json(data, {status});
    return probeReadiness(base, pid, releasedOld, profile);
  };

  await assert.rejects(probe(404, {error: "unknown runtime endpoint"}), /Unexpected health response from \/v1\/health/);
  assert.deepEqual(fetch.mock.calls.map(call => call.arguments[0]), [base + "/v1/health"]);
  await assert.rejects(probe(200, legacy), /ready/);
  assert.deepEqual(await probe(200, modern), modern);
  assert.equal(await probe(200, {...modern, status: "starting"}), undefined);
  assert.equal(await probe(503, {error: "runtime_starting"}), undefined);
  await assert.rejects(probe(200, {...modern, instance_id: " "}), /instance_id/);
  for (const capabilities of [[], ["auth.handshake.v1"], ["auth.handshake.v1", "sse.operations.v1"]]) {
    const partial = {...modern, capabilities};
    assert.deepEqual(await probe(200, partial), partial);
  }
  for (const capabilities of [undefined, null, "openapi.v1 sse.operations.v1", {},
    ["openapi.v1", "sse.operations.v1", 1], ["auth.handshake.v1", null]]) {
    await assert.rejects(probe(200, {...modern, capabilities}), /capabilities must be an array of strings/);
  }
  for (const [field, value, message] of [["pid", pid + 1, /owned Runtime PID/],
    ["instance_id", "other", /match the modern health/], ["url", "http://127.0.0.1:31338", /loopback URL/]]) {
    await record({...endpoint, [field]: value});
    await assert.rejects(probe(200, {...modern, pid}), message);
  }
  await rm(join(profile, "runtime", "endpoint.json"));
  await assert.rejects(probe(200, {...modern, pid}), {code: "ENOENT"});
  assert(fetch.mock.calls.every(call => call.arguments[0] === base + "/v1/health"));

  assert.deepEqual(await probe(200, legacy, true), legacy);
  assert.equal(fetch.mock.calls.at(-1).arguments[0], base + "/api/health");
  assert.equal(await probe(200, {...legacy, startup_complete: false}, true), undefined);
  assert.equal(await probe(503, {error: "runtime_starting"}, true), undefined);
  await assert.rejects(probe(503, {error: "legacy_host_binding_changed"}, true), /Unexpected health response/);
  await assert.rejects(probe(200, {...legacy, pid: pid + 1}, true), /owned Runtime PID/);
  await assert.rejects(probe(200, {...legacy, generation: 0}, true), /Missing legacy Runtime scope/);
  await assert.rejects(probe(200, {...legacy, state: "draining"}, true), /ready/);
});

test("RPC routing stays deliberate and only cli.exec reads the verified legacy scope", async t => {
  const base = "http://127.0.0.1:31337", pid = 123;
  const scope = {account_id: "synthetic", instance_id: "fixture", generation: 1};
  const ready = {server: "respire", v: 1, pid, state: "ready", startup_complete: true, ...scope};
  let health = ready, statusCode = 200;
  const fetch = t.mock.method(globalThis, "fetch", async url =>
    Response.json(url === base + "/api/health" ? health : {}, {status: statusCode}));
  const headers = {authorization: "Bearer synthetic-only"};
  const send = (target, body, path = "/rpc") => target.request({method: "POST", path, body});
  const cli = {v: 1, id: "cli", method: "cli.exec", args: ["status", "--json"]};
  const status = {v: 1, id: "status", method: "runtime.status", args: []};
  const catalog = {...status, id: "catalog", method: "model.catalog"};
  const legacy = httpTarget(base, headers, scope);
  const modern = httpTarget(base, headers, undefined, {pid, instance_id: scope.instance_id});

  await send(httpTarget(base), cli);
  for (const target of [legacy, modern]) {
    await send(target, status);
    await send(target, catalog);
    await send(target, cli);
  }
  await send(modern, cli, "/v1/unrelated");
  assert(fetch.mock.calls.every(({arguments: [, options]}) => options.headers.connection === "close"));
  const rpc = fetch.mock.calls.filter(({arguments: [, options]}) => options.body);
  assert.deepEqual(rpc.map(({arguments: [url, options]}) => [url, JSON.parse(options.body)]), [
    [base + "/rpc", cli],
    [base + "/api/rpc", status], [base + "/api/rpc", catalog], [base + "/api/rpc", {...cli, scope}],
    [base + "/rpc", status], [base + "/rpc", catalog], [base + "/rpc", {...cli, scope}],
    [base + "/v1/unrelated", cli]
  ]);
  assert(rpc.slice(1).every(({arguments: [, options]}) => options.headers.authorization === headers.authorization));
  assert.equal(fetch.mock.calls.filter(({arguments: [url]}) => url.endsWith("/api/health")).length, 1);
  assert.deepEqual(cli, {v: 1, id: "cli", method: "cli.exec", args: ["status", "--json"]});

  for (const change of [{pid: pid + 1}, {instance_id: "other"}, {generation: 0},
    {account_id: ""}, {server: "other"}, {v: 2}, {state: "locked"}, {startup_complete: false}]) {
    health = {...ready, ...change};
    const before = fetch.mock.callCount();
    await assert.rejects(send(modern, cli), /owned Runtime PID|owned Runtime instance|scope|server|protocol|ready/);
    assert.equal(fetch.mock.callCount(), before + 1, "Bad identity must not dispatch RPC");
  }
  health = ready;
  for (const code of [404, 503]) {
    statusCode = code;
    const before = fetch.mock.callCount();
    await assert.rejects(send(modern, cli), /Unexpected health response/);
    assert.equal(fetch.mock.callCount(), before + 1, "Bad health must not dispatch RPC");
  }
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

test("assertion diagnostics identify the rule and field without response or expected values", async () => {
  const secret = "synthetic-private-value";
  const cases = [
    [{status: secret}, {status: 200}],
    [{status: 200, media: secret}, {status: 200, media: "application/json"}],
    [{status: 200, data: {field: secret}}, {status: 200, equal: {field: "expected-private-value"}}],
    [{status: 200, data: {field: secret}}, {status: 200, different: {field: secret}}],
    [{status: 200, data: {field: secret}}, {status: 200, matches: {field: "^expected-private-value$"}}],
    [{status: 200, data: {field: secret}}, {status: 200, matches: {field: "expected-private-value["}}],
    [{status: 200, data: {field: secret}}, {status: 200, oneOf: {field: ["expected-private-value"]}}],
    [{status: 200, data: {field: [secret]}}, {status: 200, includes: {field: ["expected-private-value"]}}],
    [{status: 200, data: {field: [secret]}}, {status: 200, excludes: {field: [secret]}}]
  ];
  for (const [response, expect] of cases) {
    await assert.rejects(runScenario({steps: [{name: "Synthetic assertion",
      request: {method: "GET", path: "/v1/health"}, expect}]}, {request: async () => response}), error => {
      const diagnostic = inspect(error, {depth: 10});
      assert(!diagnostic.includes(secret) && !diagnostic.includes("expected-private-value"),
        "Assertion leaked a response or expected value");
      assert.match(error.message, /^Synthetic assertion: (HTTP status|Response media type|field)/);
      return true;
    });
  }
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
  for (const locale of ["en", "zh"]) assert(await httpRoundTrip(target, locale) > minimumBytes);
  await httpBurst(target);
});

test("MCP builds one newline-delimited UTF-8 request and rejects corrupt responses", () => {
  for (const locale of ["en", "zh"]) {
    const original = payload("mcp", locale);
    const message = frame(1, "tools/call", {name: "memory_remember", arguments: original});
    assert(message.length - 1 > minimumBytes);
    const lines = message.toString("utf8").split("\n");
    assert.equal(lines.length, 2);
    assert.equal(lines[1], "");
    exactBytes(JSON.parse(lines[0]).params.arguments.content, original.content);
    assert.throws(() => exactBytes(original.content.slice(0, -1), original.content), /byte length changed/);
    assert.throws(() => exactBytes(original.content.replace("card018", "card019"), original.content), /bytes changed/);
    assert.throws(() => decodeResult('{"jsonrpc":"2.0","id":2,"result":{}}', 1));
    assert.throws(() => decodeResult('{"jsonrpc":"2.0","id":1,"error":{"code":-32603}}', 1),
      /MCP JSON-RPC call failed/);
    assert.throws(() => decodeResult("ITEM VALUE", 1), SyntaxError);
  }
  assert.throws(() => payload("mcp", "unsupported"), /Unsupported transport locale/);
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

test("MCP config canonicalization accepts only the same isolated owned root", async t => {
  const root = await mkdtemp(join(tmpdir(), "respire card018 mcp "));
  t.after(() => rm(root, {recursive: true}));
  const env = isolatedEnv(root, 31337, "unit-fixture-only");
  await mkdir(env.RSRS_DATA_DIR);
  const before = {...env};
  const runtime = {env, root, ownedRoot: root};
  const cliEnv = await canonicalMcpEnv(runtime);
  assert.notEqual(cliEnv, env);
  assert.deepEqual(env, before);
  const canonical = await realpath(root);
  for (const [key, value] of Object.entries(env)) {
    const expected = key === "RSRS_DATA_DIR" ? join(canonical, "profile") :
      ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
        "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR"].includes(key) ?
        canonical : value;
    assert.equal(cliEnv[key], expected, key);
  }
  await assert.rejects(canonicalMcpEnv({...runtime, root: join(root, "unowned")}), /workspace must belong/);
  for (const key of ["HOME", "USERPROFILE", "RSRS_DATA_DIR", "RSRS_BIN_DIR"]) {
    await assert.rejects(canonicalMcpEnv({...runtime, env: {...env, [key]: tmpdir()}}),
      /isolated fixture environment/);
  }
  await assert.rejects(canonicalMcpEnv({...runtime, env: {...env, UNTRUSTED: "value"}}),
    /isolated fixture environment/);
  const synthetic = {...env, RSRS_M3_DIR: join(root, "empty-models"), RSRS_NO_AUTOSYNC: "1"};
  await mkdir(synthetic.RSRS_M3_DIR);
  const syntheticBefore = {...synthetic};
  const syntheticCli = await canonicalMcpEnv({...runtime, env: synthetic});
  assert.equal(syntheticCli.RSRS_M3_DIR, synthetic.RSRS_M3_DIR);
  assert.equal(syntheticCli.RSRS_NO_AUTOSYNC, "1");
  assert.deepEqual(synthetic, syntheticBefore);
  for (const extra of [{UNTRUSTED: "value"}, {RSRS_UNEXPECTED: "1"}, {RSRS_NO_AUTOSYNC: "0"},
    {RSRS_M3_DIR: tmpdir()}, {RSRS_MCP_ALLOW: env.RSRS_MCP_ALLOW + ",memory_delete"}]) {
    await assert.rejects(canonicalMcpEnv({...runtime, env: {...synthetic, ...extra}}),
      /isolated fixture environment/);
  }
  for (const key of ["RSRS_M3_DIR", "RSRS_NO_AUTOSYNC"]) {
    const partial = {...synthetic};
    delete partial[key];
    await assert.rejects(canonicalMcpEnv({...runtime, env: partial}), /isolated fixture environment/);
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

test("MCP three-tool fixture verifies full show and keeps shortened recall a strict failure", async t => {
  const root = await mkdtemp(join(tmpdir(), "respire card018 mcp tools "));
  t.after(() => rm(root, {recursive: true}));
  const env = isolatedEnv(root, 31337, "unit-fixture-only");
  await mkdir(env.RSRS_DATA_DIR);
  env.RSRS_M3_DIR = join(root, "empty-models");
  env.RSRS_NO_AUTOSYNC = "1";
  await mkdir(env.RSRS_M3_DIR);
  const runtime = {root, ownedRoot: root, env};
  const script = String.raw`
    const assert = require("node:assert/strict");
    const {createInterface} = require("node:readline");
    const mode = process.argv[1];
    const names = ["memory_remember", "memory_recall", "memory_show"];
    let entry, stage = 0;
    createInterface({input: process.stdin}).on("line", line => {
      const {id, method, params} = JSON.parse(line);
      let result;
      if (method === "initialize") result = {protocolVersion: params.protocolVersion, capabilities: {tools: {}}};
      else if (method === "notifications/initialized") return;
      else if (method === "tools/list") result = {tools: names.map(name => ({name}))};
      else {
        assert.equal(method, "tools/call");
        const {name, arguments: args} = params;
        assert.equal(name, ["memory_remember", "memory_show", "memory_recall"][stage++]);
        let envelope;
        if (name === "memory_remember") {
          assert.equal(args.importance, "important");
          entry = {...args, id: "synthetic-entry"};
          assert(Buffer.byteLength(entry.content, "utf8") > 100 * 1024);
          envelope = {command: "remember", status: "ok", summary: {id: entry.id}};
        } else if (name === "memory_show") {
          assert.deepEqual(args, {id: entry.id});
          envelope = {command: "show", status: "ok", details: {
            entry: {...entry, content: mode === "show-short" ? entry.content.slice(0, 100) : entry.content}
          }};
        } else {
          assert.equal(args.query, entry.title);
          envelope = {command: "recall", status: "ok", details: [{
            entry: {...entry, id: mode === "recall-other" ? "different-entry" : entry.id,
              content: mode === "recall-short" ? entry.content.slice(0, 100) : entry.content}
          }]};
        }
        result = {isError: false, content: [{type: "text", text: JSON.stringify(envelope)}]};
      }
      process.stdout.write(JSON.stringify({jsonrpc: "2.0", id, result}) + "\n");
    });
  `;
  const {spawn} = childProcess;
  let mode;
  const stub = t.mock.method(childProcess, "spawn", (binary, args, options) => {
    assert.deepEqual(args, ["--client-only", "mcp"]);
    assert.equal(options.cwd, root);
    assert.equal(options.env.RSRS_DATA_DIR, join(canonicalRoot, "profile"));
    assert.equal(options.env.RSRS_MCP_ALLOW, "memory_remember,memory_recall,memory_show");
    return spawn(binary, ["-e", script, mode], options);
  });
  const canonicalRoot = await realpath(root);
  syncBuiltinESMExports();
  t.after(() => { stub.mock.restore(); syncBuiltinESMExports(); });
  for (const locale of ["en", "zh"]) {
    mode = "full";
    assert(await mcpRoundTrip(process.execPath, runtime, locale) > minimumBytes);
    mode = "recall-short";
    await assert.rejects(mcpRoundTrip(process.execPath, runtime, locale),
      /MCP recall UTF-8 length mismatch; truncation semantics UNCONFIRMED/);
    mode = "recall-other";
    await assert.rejects(mcpRoundTrip(process.execPath, runtime, locale), /Recall did not return the stored MCP memory ID/);
    mode = "show-short";
    await assert.rejects(mcpRoundTrip(process.execPath, runtime, locale), /UTF-8 byte length changed/);
  }
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
