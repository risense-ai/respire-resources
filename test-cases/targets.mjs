import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, rmdir, stat, symlink} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {isAbsolute, join} from "node:path";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import "../prototypes/mock-api/fixture.js";
import {prepareModernReady, unlockModernReady} from "./modern-ready.mjs";

const terminal = new Set(["completed", "failed", "cancelled"]);
const {directory} = JSON.parse(await readFile(new URL("./fixtures/i18n/transport.json", import.meta.url), "utf8"));

function localPath(path) {
  assert(typeof path === "string" && /^\/(?:v1\/|rpc$)/.test(path) && !path.includes("\\"),
    "Requests must use local Runtime API paths");
  return path;
}

function compiledEvent(event, text) {
  const value = JSON.parse(text);
  // JSON.parse alone silently accepts duplicate keys. Reject them before
  // interpreting an event's identity, state or failure details.
  const objects = [];
  for (const match of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\]]/g)) {
    const token = match[0];
    if (token === "{" || token === "[") objects.push(token === "{" ? new Set() : null);
    else if (token === "}" || token === "]") objects.pop();
    else if (/^\s*:/.test(text.slice(match.index + token.length))) {
      const keys = objects.at(-1);
      const key = JSON.parse(token);
      assert(keys && !keys.has(key), "Duplicate compiled SSE JSON key");
      keys.add(key);
    }
  }
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  assert(object(value) && Object.keys(value).length === 2 && Object.hasOwn(value, "event") &&
    value.event === event && Object.hasOwn(value, "data") && object(value.data),
  "Invalid compiled SSE operation envelope");
  const {data} = value;
  assert(typeof data.operation_id === "string" && data.operation_id.trim() &&
    typeof data.kind === "string" && data.kind.trim() &&
    (event === "progress" ? ["pending", "running"].includes(data.state) : data.state === event),
  "Invalid compiled SSE operation status");
  if (event === "failed") assert(object(data.error) &&
    typeof data.error.type === "string" && data.error.type.trim() &&
    typeof data.error.title === "string" && data.error.title.trim() &&
    Number.isInteger(data.error.status) && data.error.status >= 400 && data.error.status <= 599,
  "Invalid compiled SSE operation error");
  return data;
}

export async function* sseFrames(body, {compiled = false} = {}) {
  const decoder = new TextDecoder("utf-8", {fatal: true});
  let buffer = "";
  let event;
  let data = [];
  function* lines(text) {
    buffer += text;
    let match;
    while ((match = /^([^\r\n]*)(\r\n|\n|\r(?!$))/.exec(buffer))) {
      buffer = buffer.slice(match[0].length);
      yield match[1];
    }
  }
  function* consume(text) {
    for (const line of lines(text)) {
      if (!line) {
        if (data.length) {
          assert(event === "progress" || terminal.has(event), "Invalid operation event " + event);
          const text = data.join("\n");
          yield {event, data: compiled ? compiledEvent(event, text) : JSON.parse(text)};
        }
        if (compiled) assert(event === undefined || data.length, "Compiled SSE operation event lacks data");
        event = undefined;
        data = [];
      } else if (line.startsWith("event:")) {
        if (compiled) assert(event === undefined, "Duplicate compiled SSE event field");
        event = line.slice(6).replace(/^ /, "");
      }
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  for await (const chunk of body) yield* consume(decoder.decode(chunk, {stream: true}));
  const end = decoder.decode();
  yield* consume(end + (buffer.endsWith("\r") ? "\n" : ""));
  assert(!buffer.trim() && !data.length && (!compiled || event === undefined), "Incomplete SSE frame");
}

export function httpTarget(base, headers = {}, releasedHealth, ownedIdentity) {
  const origin = new URL(base);
  assert(origin.protocol === "http:" && origin.hostname === "127.0.0.1" && origin.origin === base,
    "Expected a raw IPv4 loopback origin");
  async function send({method, path, body, public: unauthenticated}, accept) {
    const releasedRpc = releasedHealth && path === "/rpc";
    if (path === "/rpc" && body?.method === "cli.exec" && (releasedHealth || ownedIdentity)) {
      // Modern readiness and endpoint ownership must precede this legacy scope read.
      const health = releasedHealth ?? await probeReadiness(base, ownedIdentity.pid, true);
      assert(health && (!ownedIdentity || health.instance_id === ownedIdentity.instance_id),
        "Legacy CLI scope must match the ready owned Runtime instance");
      const {account_id, instance_id, generation} = health;
      body = {...body, scope: {account_id, instance_id, generation}};
    }
    return fetch(base + (releasedRpc ? "/api/rpc" : localPath(path)), {
      method, redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: {...(unauthenticated ? {} : headers), accept, connection: "close", ...(body === undefined ? {} : {"content-type": "application/json"})},
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }
  return {
    async request(spec) {
      const response = await send(spec, "application/json, application/problem+json");
      const media = response.headers.get("content-type")?.split(";")[0];
      const text = await response.text();
      return {status: response.status, media, data: text ? JSON.parse(text) : undefined};
    },
    async subscribe(path) {
      const response = await send({method: "GET", path}, "text/event-stream");
      if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0] !== "text/event-stream") {
        await response.body?.cancel();
        throw new Error("Expected HTTP 200 text/event-stream, received " + response.status);
      }
      const frames = sseFrames(response.body, {compiled: true});
      return {
        next: () => frames.next(),
        async return() {
          await frames.return();
          if (!response.body.locked) await response.body.cancel();
        }
      };
    }
  };
}

export function mockTarget(seed) {
  const fixture = globalThis.RespireFixture.create(seed);
  const headers = {authorization: "Bearer synthetic-preview-only"};
  return {
    async request({method, path, body, public: unauthenticated}) {
      try {
        const response = fixture.request(method, localPath(path), body ?? {}, unauthenticated ? {} : headers);
        return {...response, media: response.media ?? (response.status === 204 ? undefined : "application/json")};
      } catch (error) {
        if (!error.problem) throw error;
        return {status: error.problem.status, media: "application/problem+json", data: error.problem};
      }
    },
    async subscribe(path) {
      const match = /^\/v1\/operations\/([^/]+)\/events$/.exec(localPath(path));
      assert(match, "Expected an operation stream path");
      const id = match[1];
      const {initial, canRead} = fixture.operationChannel(id, headers);
      async function* frames() {
        let data = initial;
        while (canRead()) {
          yield {event: terminal.has(data.state) ? data.state : "progress", data};
          if (terminal.has(data.state)) return;
          data = fixture.tick(id);
        }
      }
      return frames();
    }
  };
}

const inherited = /^(SystemRoot|WINDIR|ComSpec|PATH|PATHEXT|SystemDrive|LANG|LC_ALL)$/i;

export function isolatedEnv(root, port, token) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => inherited.test(key))),
    HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root, XDG_DATA_HOME: root,
    XDG_CACHE_HOME: root, XDG_CONFIG_HOME: root, XDG_RUNTIME_DIR: root,
    TEMP: root, TMP: root, TMPDIR: root,
    RSRS_DATA_DIR: join(root, "profile"), RSRS_BIN_DIR: join(root, "bin"),
    RSRS_RPC_PORT: String(port), RSRS_RPC_TOKEN: token,
    RSRS_MCP_ALLOW: "memory_remember,memory_recall,memory_show"
  };
}

export async function withCleanup(run, cleanup) {
  const failures = [];
  try {
    return await run();
  } catch (error) {
    failures.push(error);
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (error) {
      if (!failures.length) throw error;
      failures.push(error);
      throw new AggregateError(failures, failures.map(failure => String(failure)).join("\n"));
    }
  }
}

export function ownedProcess(binary, args, options) {
  const child = spawn(binary, args, {...options, shell: false, windowsHide: true});
  let failure;
  const closed = new Promise(resolve => {
    child.on("error", error => { failure = error; });
    child.once("close", (code, signal) => resolve({code, signal}));
  });
  return {
    child, closed,
    assertRunning() {
      if (failure) throw failure;
      assert(child.exitCode === null && child.signalCode === null, "Owned test process exited early");
    },
    async stop() {
      const timer = new AbortController();
      try {
        child.stdin?.destroy();
        if (child.pid && !child.killed && child.exitCode === null && child.signalCode === null) child.kill();
        await Promise.race([closed, delay(5_000, undefined, {signal: timer.signal}).then(() => {
          throw new Error("Timed out waiting for the owned process and its inherited stdio to close", {cause: failure});
        })]);
      } finally {
        timer.abort();
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
      }
    }
  };
}

export async function assertBinary(binary, name) {
  assert(isAbsolute(binary) && (await stat(binary)).isFile(), "Supply an absolute compiled " + name + " executable path");
}

async function assertFixtureDirectory(profile) {
  assert(isAbsolute(profile) && (await lstat(profile)).isDirectory(),
    "Fixture profile must be an absolute directory with sanitized offline data");
}

function assertFixtureEntry(item) {
  assert(item.isDirectory() || item.isFile(), "Fixture profiles must contain regular files and directories");
}

export async function checkFixtureProfile(profile) {
  await assertFixtureDirectory(profile);
  for (const entry of await readdir(profile, {recursive: true, withFileTypes: true})) assertFixtureEntry(entry);
}

export async function canonicalMcpEnv({env, root, ownedRoot}) {
  assert(isAbsolute(ownedRoot) && (await lstat(ownedRoot)).isDirectory(),
    "MCP requires the owned synthetic temp root");
  assert(root === ownedRoot || root === join(ownedRoot, "junction " + directory),
    "MCP workspace must belong to the owned synthetic temp root");
  const expectedEnv = isolatedEnv(root, env.RSRS_RPC_PORT, env.RSRS_RPC_TOKEN);
  const synthetic = Object.hasOwn(env, "RSRS_M3_DIR") || Object.hasOwn(env, "RSRS_NO_AUTOSYNC");
  if (synthetic) {
    expectedEnv.RSRS_M3_DIR = join(ownedRoot, "empty-models");
    expectedEnv.RSRS_NO_AUTOSYNC = "1";
  }
  assert(Object.keys(env).length === Object.keys(expectedEnv).length &&
    Object.entries(expectedEnv).every(([key, value]) => Object.hasOwn(env, key) && env[key] === value),
    "MCP requires the isolated fixture environment");
  const physical = root === ownedRoot ? ownedRoot : join(ownedRoot, "physical workspace");
  const canonical = await realpath(physical);
  assert(await realpath(root) === canonical, "MCP workspace resolved outside its owned synthetic directory");
  await checkFixtureProfile(physical);
  if (synthetic) {
    await checkFixtureProfile(expectedEnv.RSRS_M3_DIR);
    assert(await realpath(expectedEnv.RSRS_M3_DIR) === join(await realpath(ownedRoot), "empty-models"),
      "MCP models directory must match the owned synthetic root");
  }
  const cliEnv = {...env};
  // CLI startup rejects linked config roots; Runtime and cwd retain the actual junction.
  for (const key of ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
    "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR", "RSRS_DATA_DIR"]) {
    const expected = key === "RSRS_DATA_DIR" ? join(canonical, "profile") : canonical;
    const resolved = await realpath(env[key]);
    assert(resolved === expected, "MCP config directory must match the same owned synthetic root");
    cliEnv[key] = resolved;
  }
  return cliEnv;
}

export async function createWindowsJunction(root) {
  assert.equal(process.platform, "win32");
  const physical = join(root, "physical workspace");
  const alias = join(root, "junction " + directory);
  try {
    await mkdir(physical);
    await symlink(physical, alias, "junction");
  } catch (error) {
    throw new Error("Owned synthetic junction creation failed; code=" + error.code);
  }
  return alias;
}

export function startupDiagnostics(child) {
  const allowed = [
    "another Windows user can replace credential directory entries",
    "Windows credential or directory has a different owner",
    "Windows credential ACL inherits permissions",
    "Windows credential ACL is not protected owner-only access",
    "owner credential cannot use any reparse or device",
    "endpoint path contains a reparse point",
    "endpoint path contains a symlink",
    "runtime authorization path contains a symlink",
    "owner credential requires a fixed local disk directory",
    "os error 10013", "os error 5", "os error 123"
  ];
  const found = new Set();
  for (const stream of [child.stdout, child.stderr]) {
    let tail = "";
    stream.setEncoding("utf8");
    stream.on("data", chunk => {
      // Only fixed fragments escape; paths, credentials and arbitrary log text never do.
      const text = tail + chunk;
      for (const fragment of allowed) if (text.includes(fragment)) found.add(fragment);
      tail = text.slice(-128);
    });
  }
  return () => "exit_code=" + child.exitCode + "; signal=" + child.signalCode +
    "; diagnostics=" + (Array.from(found).join(" | ") || "none allowlisted");
}

export async function probeReadiness(base, pid, releasedOld = false, profile) {
  const path = releasedOld ? "/api/health" : "/v1/health";
  const response = await fetch(base + path, {
    redirect: "error", signal: AbortSignal.timeout(1_000), headers: {connection: "close"}
  });
  const health = await response.json();
  if (response.status === 503 && (!releasedOld || health.error === "runtime_starting")) return;
  assert(response.status === 200, "Unexpected health response from " + path);
  if (releasedOld) {
    assert(health.pid === pid, "Health must identify the owned Runtime PID");
    assert(health.server === "respire", "Unexpected legacy health server");
    assert(health.v === 1, "Unexpected legacy health protocol");
    if (health.state === "starting" || (health.state === "ready" && health.startup_complete === false)) return;
    assert(health.state === "ready", "Legacy Runtime state must be ready");
    assert(health.startup_complete === true, "Legacy Runtime startup must be complete");
    assert(typeof health.account_id === "string" && health.account_id &&
      typeof health.instance_id === "string" && health.instance_id &&
      Number.isSafeInteger(health.generation) && health.generation > 0, "Missing legacy Runtime scope");
  } else {
    if (health.status === "starting") return;
    assert(health.status === "ready", "Modern Runtime status must be ready");
    assert(typeof health.instance_id === "string" && health.instance_id.trim(), "Missing modern Runtime instance_id");
    assert(Array.isArray(health.capabilities) &&
      health.capabilities.every(value => typeof value === "string"),
    "Modern Runtime capabilities must be an array of strings");
    assert(typeof profile === "string" && isAbsolute(profile), "Missing owned Runtime profile for identity check");
    const endpoint = JSON.parse(await readFile(join(profile, "runtime", "endpoint.json"), "utf8"));
    assert(endpoint.pid === pid, "Endpoint record must identify the owned Runtime PID");
    assert(endpoint.instance_id === health.instance_id, "Endpoint record must match the modern health instance_id");
    assert(endpoint.url === base, "Endpoint record must match the owned loopback URL");
  }
  return health;
}

export async function withRuntime(binary, fixture, run, {releasedOld = false, junction = false, deviceLocal = false, downloadMirrorPort} = {}) {
  assert(!deviceLocal || (fixture?.syntheticReady === true && !releasedOld && !fixture.profile),
    "Device-local setup requires an owned synthetic ready fixture");
  assert(!fixture?.syntheticReady || (!releasedOld && !fixture.profile),
    "Synthetic ready setup cannot use released-old or a supplied profile");
  if (downloadMirrorPort !== undefined) {
    assert(fixture?.syntheticReady === true && deviceLocal && !junction && !releasedOld && !fixture.profile,
      "Download fixture requires a fresh synthetic device-local profile");
    assert(Number.isInteger(downloadMirrorPort) && downloadMirrorPort > 1023 && downloadMirrorPort <= 65535,
      "Download fixture requires an unprivileged TCP port");
  }
  await assertBinary(binary, "Runtime");
  if (fixture?.profile) await assertFixtureDirectory(fixture.profile);

  const reserve = createServer().listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const port = reserve.address().port;
  await new Promise((resolve, reject) => reserve.close(error => error ? reject(error) : resolve()));
  const root = await mkdtemp(join(tmpdir(), "respire " + directory + " "));
  let runtime;
  let alias;
  return withCleanup(async () => {
    const token = "e2e-" + randomUUID();
    if (junction) alias = await createWindowsJunction(root);
    const workspace = alias ?? root;
    const env = isolatedEnv(workspace, port, token);
    if (releasedOld) env.RSRS_NO_AUTOSYNC = "1";
    if (fixture?.profile) {
      await cp(fixture.profile, env.RSRS_DATA_DIR, {
        recursive: true,
        async filter(path) {
          assertFixtureEntry(await lstat(path));
          return true;
        }
      });
    } else await mkdir(env.RSRS_DATA_DIR);
    const synthetic = fixture?.syntheticReady ? await prepareModernReady(root, env, token, {deviceLocal}) : undefined;
    if (synthetic) console.log("FIXTURE SYNTHETIC MODERN READY: disposable Vault v4 session, local host unlock, no user configuration");
    if (downloadMirrorPort !== undefined) {
      env.RSRS_E2E_LOOPBACK_MIRROR = "http://127.0.0.1:" + downloadMirrorPort;
    }
    runtime = ownedProcess(binary, ["serve", "--host", "127.0.0.1", "--port", String(port), "--data-dir", env.RSRS_DATA_DIR],
      {cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"]});
    const diagnostics = startupDiagnostics(runtime.child);
    const base = "http://127.0.0.1:" + port;
    const deadline = Date.now() + 30_000;
    let health;
    try {
      const unlockedInstance = synthetic ? await unlockModernReady(base, runtime.child.pid, env.RSRS_DATA_DIR,
        synthetic, token, () => runtime.assertRunning()) : undefined;
      while (!health) {
        runtime.assertRunning();
        assert(Date.now() < deadline, "Timed out waiting for owned Runtime health");
        try {
          health = await probeReadiness(base, runtime.child.pid, releasedOld, env.RSRS_DATA_DIR);
        } catch (error) {
          if (error.cause?.code !== "ECONNREFUSED") throw error;
        }
        if (!health) await delay(50);
      }
      if (synthetic) assert(health.instance_id === unlockedInstance, "Runtime instance changed after synthetic unlock");
      runtime.assertRunning();
    } catch (error) {
      await Promise.race([runtime.closed, delay(250)]);
      const reason = error instanceof assert.AssertionError ? error.message.split("\n")[0] :
        error.code ?? error.cause?.code ?? error.name;
      throw new Error("Owned Runtime startup failed (" + (junction ? "junction" : "regular directory") +
        "; " + diagnostics() + "; failure=" + reason + ")");
    }
    console.log("READY OWNED Runtime pid=" + runtime.child.pid + " instance_id=" + health.instance_id +
      " url=" + base + (releasedOld ? " legacy health PID/scope matched" : " endpoint PID/instance/URL matched"));
    const target = httpTarget(base, {authorization: "Bearer " + token}, releasedOld ? health : undefined,
      releasedOld ? undefined : {pid: runtime.child.pid, instance_id: health.instance_id});
    const result = await run({target, env, root: workspace, ownedRoot: root});
    runtime.assertRunning();
    return result;
  }, async () => {
    try {
      await runtime?.stop();
      if (alias) await rmdir(alias);
      await rm(root, {recursive: true, force: true, maxRetries: process.platform === "win32" ? 3 : 0, retryDelay: 100});
    } catch (error) {
      throw new Error("Cleanup failed for owned test root " + root + " (remaining files retained): " + error.message,
        {cause: error});
    }
  });
}
