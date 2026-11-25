import assert from "node:assert/strict";
import childProcess, {execFile} from "node:child_process";
import {createDecipheriv, createHash, hkdfSync} from "node:crypto";
import {lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {writeFileSync} from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {promisify} from "node:util";
import {prepareModernReady, unlockModernReady} from "./modern-ready.mjs";
import {canonicalMcpEnv, isolatedEnv, probeReadiness, withRuntime} from "./targets.mjs";
import {loadScenarios, runScenario} from "./runner.mjs";

test("synthetic modern fixture generates a decryptable disposable session without plaintext credentials", async t => {
  const root = await mkdtemp(join(tmpdir(), "respire-synthetic-ready-"));
  t.after(() => rm(root, {recursive: true}));
  const env = isolatedEnv(root, 12345, "synthetic-token");
  await mkdir(env.RSRS_DATA_DIR);
  const fixture = await prepareModernReady(root, env, "synthetic-token");
  const bytes = await readFile(join(env.RSRS_DATA_DIR, "session.json"));
  const session = JSON.parse(bytes);
  assert.equal(session.addr, "https://smoke.invalid");
  assert.equal(session.vault_version, 4);
  assert(!bytes.includes(fixture.superPassword));
  assert.equal(fixture.sessionSha256, createHash("sha256").update(bytes).digest("hex"));
  const kek = hkdfSync("sha256", Buffer.from(fixture.superPassword.slice(3), "hex"),
    Buffer.from(session.kdf_salt, "hex"), Buffer.from("onememory:kek:v4"), 32);
  const wrapped = Buffer.from(session.wrapped_urk, "hex");
  const cipher = createDecipheriv("aes-256-gcm", kek, Buffer.from(session.urk_nonce, "hex"));
  cipher.setAuthTag(wrapped.subarray(-16));
  assert.equal(Buffer.concat([cipher.update(wrapped.subarray(0, -16)), cipher.final()]).length, 32);
  assert.equal(await readFile(join(env.RSRS_DATA_DIR, "runtime", "token"), "utf8"), "synthetic-token");
  assert.equal(env.RSRS_M3_DIR, join(root, "empty-models"));
  assert.equal(env.RSRS_NO_AUTOSYNC, "1");
  await assert.rejects(prepareModernReady(root, env, "replacement"), {code: "EEXIST"});
  assert.deepEqual(await readFile(join(env.RSRS_DATA_DIR, "session.json")), bytes);
});

test("occupied synthetic fixtures fail before ACL changes without mutating files or environment", async t => {
  const acl = t.mock.method(childProcess, "execFile", () => assert.fail("Occupied fixture must not invoke ACL setup"));
  syncBuiltinESMExports();
  t.after(() => { acl.mock.restore(); syncBuiltinESMExports(); });
  for (const occupied of ["session.json", "runtime/token", "empty-models", "unrelated-file"]) {
    const root = await mkdtemp(join(tmpdir(), "respire-occupied-ready-"));
    t.after(() => rm(root, {recursive: true}));
    const env = isolatedEnv(root, 12345, "synthetic-token");
    await mkdir(env.RSRS_DATA_DIR);
    if (occupied === "empty-models") await mkdir(join(root, occupied));
    else {
      if (occupied === "runtime/token") await mkdir(join(env.RSRS_DATA_DIR, "runtime"));
      await writeFile(join(env.RSRS_DATA_DIR, occupied), Buffer.from([0, 255, 13, 10]));
    }
    const snapshot = async () => {
      const names = ["", ...(await readdir(root, {recursive: true})).sort()];
      return Promise.all(names.map(async name => {
        const path = join(root, name), stat = await lstat(path);
        return {name, mode: stat.mode, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs,
          bytes: stat.isFile() ? await readFile(path) : null};
      }));
    };
    const before = await snapshot(), originalEnv = {...env};
    await assert.rejects(prepareModernReady(root, env, "replacement"), {
      code: "EEXIST", message: "Synthetic ready fixture already exists; refusing setup before ACL changes"
    });
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(env, originalEnv);
    assert.equal(acl.mock.callCount(), 0);
  }
});

test("synthetic unlock binds the owned endpoint, locked generation and session before strict modern readiness", async t => {
  const root = await mkdtemp(join(tmpdir(), "respire-unlock-"));
  t.after(() => rm(root, {recursive: true}));
  await mkdir(join(root, "runtime"));
  const base = "http://127.0.0.1:31337", pid = 123;
  const endpoint = {pid, instance_id: "synthetic-instance", url: base};
  const record = value => writeFile(join(root, "runtime", "endpoint.json"), JSON.stringify(value));
  await record(endpoint);
  const fixture = {superPassword: "synthetic-only", sessionSha256: "synthetic-digest"};
  const locked = {pid, instance_id: endpoint.instance_id, generation: 7, startup_complete: true,
    state: "locked", store_ready: false, credential_state: "required"};
  const modern = {instance_id: endpoint.instance_id, status: "degraded",
    capabilities: ["openapi.v1", "sse.operations.v1"]};
  let ready = false, lockedReply = locked, modernReply = modern, unlockReply = {store_ready: true};
  const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url === base + "/api/health") return Response.json(lockedReply);
    if (url === base + "/v1/health") return Response.json(ready ? {...modernReply, status: "ready"} : modernReply);
    assert.equal(url, base + "/api/runtime/unlock");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.authorization, "Bearer synthetic-token");
    assert.deepEqual(JSON.parse(options.body), {schema_version: 1, profile: root,
      session_sha256: fixture.sessionSha256, instance_id: locked.instance_id, generation: 7,
      super_password: fixture.superPassword, login_password: null});
    return Response.json(unlockReply);
  });
  const unlock = () => unlockModernReady(base, pid, root, fixture, "synthetic-token", () => {});
  await assert.rejects(probeReadiness(base, pid, false, root), /must be ready/);
  assert.equal(await unlock(), endpoint.instance_id);
  assert.deepEqual(fetch.mock.calls.slice(1).map(call => call.arguments[0]),
    [base + "/api/health", base + "/v1/health", base + "/api/runtime/unlock"]);
  ready = true;
  assert.equal((await probeReadiness(base, pid, false, root)).status, "ready");
  ready = false;
  for (const bad of [{...endpoint, pid: pid + 1}, {...endpoint, instance_id: ""},
    {...endpoint, url: "http://127.0.0.1:31338"}]) {
    await record(bad);
    const before = fetch.mock.callCount();
    await assert.rejects(unlock(), /endpoint identity mismatch/);
    assert.equal(fetch.mock.callCount(), before);
  }
  await record(endpoint);
  for (const bad of [{...locked, instance_id: "other"}, {...locked, generation: 0},
    {...locked, state: "ready"}, {...locked, store_ready: true}]) {
    lockedReply = bad;
    const before = fetch.mock.callCount();
    await assert.rejects(unlock(), /identity mismatch|generation|must be locked/);
    assert.equal(fetch.mock.callCount(), before + 1);
  }
  lockedReply = locked;
  modernReply = {...modern, status: "ready"};
  await assert.rejects(unlock(), /must be degraded/);
  modernReply = modern;
  unlockReply = {store_ready: false};
  await assert.rejects(unlock(), /did not open the store/);
  await rm(join(root, "runtime", "endpoint.json"));
  await assert.rejects(probeReadiness(base, pid, false, root), /must be ready/);
});

test("synthetic setup is opt-in and cannot modify released or supplied profiles", async () => {
  for (const options of [{releasedOld: true}, {}]) {
    await assert.rejects(withRuntime(process.execPath,
      {syntheticReady: true, ...(options.releasedOld ? {} : {profile: "unread-profile"})},
      () => assert.fail("must not run"), options), /cannot use released-old or a supplied profile/);
  }
  const run = promisify(execFile);
  for (const args of [["--released-old"], ["--profile-fixture", "unread-profile"]]) {
    await assert.rejects(run(process.execPath, ["test-cases/cli-e2e/smoke.mjs", "--synthetic-ready", ...args]),
      /cannot use released-old or a supplied profile/);
  }
  await assert.rejects(run(process.execPath, ["test-cases/plugin-rpc/windows.mjs", "--synthetic-ready",
    "--profile-fixture", "unread-profile"]), /cannot use a supplied profile/);
  for (const [file, flag] of [["runner.mjs", "--mock"], ["cli-e2e/smoke.mjs", "--preflight"]]) {
    await assert.rejects(run(process.execPath, ["test-cases/" + file, "--synthetic-ready", flag]),
      /requires compiled execution/);
  }
});

test("owned synthetic startup unlocks before running scenarios and cleans up failed unlocks", async t => {
  const {spawn} = childProcess;
  let child, profile, base, ready, unlockSucceeds = true;
  const stub = t.mock.method(childProcess, "spawn", (binary, args, options) => {
    if (args[0] !== "serve") return spawn(binary, args, options);
    child = spawn(binary, ["-e", "setInterval(() => {}, 1000)"], options);
    profile = options.env.RSRS_DATA_DIR;
    base = "http://127.0.0.1:" + options.env.RSRS_RPC_PORT;
    writeFileSync(join(profile, "runtime", "endpoint.json"), JSON.stringify({
      pid: child.pid, instance_id: "owned-synthetic", url: base
    }));
    ready = false;
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    stub.mock.restore();
    syncBuiltinESMExports();
  });
  const routes = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    routes.push(url.slice(base.length));
    if (url === base + "/api/health") return Response.json({pid: child.pid, instance_id: "owned-synthetic",
      generation: 1, startup_complete: true, state: ready ? "ready" : "locked", store_ready: ready,
      credential_state: ready ? "available" : "required", account_id: "synthetic", server: "respire", v: 1});
    if (url === base + "/api/runtime/unlock") {
      const body = JSON.parse(options.body);
      assert.equal(body.profile, profile);
      const session = await readFile(join(profile, "session.json"));
      assert.equal(body.session_sha256, createHash("sha256").update(session).digest("hex"));
      ready = unlockSucceeds;
      return Response.json({store_ready: ready});
    }
    if (url === base + "/rpc") {
      assert(ready, "Legacy dispatch must follow strict modern readiness");
      const body = JSON.parse(options.body);
      assert(options.headers.authorization.startsWith("Bearer e2e-"), "Legacy RPC must retain authentication");
      if (body.method === "cli.exec") assert.deepEqual(body.scope,
        {account_id: "synthetic", instance_id: "owned-synthetic", generation: 1});
      else assert(!Object.hasOwn(body, "scope"), "Only cli.exec needs legacy scope");
      return Response.json({v: 1, id: body.id, ok: true, exit: 0,
        envelope: {command: body.method === "cli.exec" ? "status" : body.method, status: "ok"}});
    }
    assert.equal(url, base + "/v1/health");
    return Response.json({status: ready ? "ready" : "degraded", instance_id: "owned-synthetic",
      capabilities: ["auth.handshake.v1"]});
  });
  const result = await withRuntime(process.execPath, {syntheticReady: true}, async context => {
    assert(ready);
    const before = {...context.env};
    const cliEnv = await canonicalMcpEnv(context);
    assert.equal(cliEnv.RSRS_M3_DIR, join(context.ownedRoot, "empty-models"));
    assert.equal(cliEnv.RSRS_NO_AUTOSYNC, "1");
    assert.deepEqual(context.env, before);
    assert.equal((await context.target.request({method: "GET", path: "/v1/health", public: true})).data.status, "ready");
    await runScenario((await loadScenarios()).find(scenario => scenario.id === "E2E-007"), context.target);
    return "synthetic scenario executed";
  });
  assert.equal(result, "synthetic scenario executed");
  assert.deepEqual(routes, ["/api/health", "/v1/health", "/api/runtime/unlock", "/v1/health", "/v1/health",
    "/rpc", "/rpc", "/api/health", "/rpc"]);
  await assert.rejects(readFile(join(profile, "session.json")), {code: "ENOENT"});
  unlockSucceeds = false;
  await assert.rejects(withRuntime(process.execPath, {syntheticReady: true}, () => assert.fail("must not run")),
    /Synthetic host unlock did not open the store/);
  await assert.rejects(readFile(join(profile, "session.json")), {code: "ENOENT"});
});
