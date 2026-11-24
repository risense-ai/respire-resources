import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, rmdir, stat, symlink} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {isAbsolute, join} from "node:path";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import "../prototypes/mock-api/fixture.js";

const terminal = new Set(["completed", "failed", "cancelled"]);
const {directory} = JSON.parse(await readFile(new URL("./fixtures/i18n/transport.json", import.meta.url), "utf8"));

function localPath(path) {
  assert(typeof path === "string" && /^\/(?:v1\/|rpc$)/.test(path) && !path.includes("\\"),
    "Requests must use local Runtime API paths");
  return path;
}

export async function* sseFrames(body) {
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
          yield {event, data: JSON.parse(data.join("\n"))};
        }
        event = undefined;
        data = [];
      } else if (line.startsWith("event:")) event = line.slice(6).replace(/^ /, "");
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  for await (const chunk of body) yield* consume(decoder.decode(chunk, {stream: true}));
  const end = decoder.decode();
  yield* consume(end + (buffer.endsWith("\r") ? "\n" : ""));
  assert(!buffer.trim() && !data.length, "Incomplete SSE frame");
}

export function httpTarget(base, headers = {}, releasedHealth) {
  const origin = new URL(base);
  assert(origin.protocol === "http:" && origin.hostname === "127.0.0.1" && origin.origin === base,
    "Expected a raw IPv4 loopback origin");
  async function send({method, path, body, public: unauthenticated}, accept) {
    const releasedRpc = releasedHealth && path === "/rpc";
    if (releasedRpc && body?.method === "cli.exec") {
      const {account_id, instance_id, generation} = releasedHealth;
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
      const frames = sseFrames(response.body);
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
    RSRS_MCP_ALLOW: "memory_remember,memory_recall"
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

export async function createWindowsJunction(root) {
  assert.equal(process.platform, "win32");
  const physical = join(root, "physical workspace");
  const alias = join(root, "junction " + directory);
  await mkdir(physical);
  await symlink(physical, alias, "junction");
  return alias;
}

export async function probeReadiness(base, pid, releasedOld = false) {
  const path = releasedOld ? "/api/health" : "/v1/health";
  const response = await fetch(base + path, {
    redirect: "error", signal: AbortSignal.timeout(1_000), headers: {connection: "close"}
  });
  const health = await response.json();
  if (response.status === 503 && (!releasedOld || health.error === "runtime_starting")) return;
  assert.equal(response.status, 200, "Unexpected health response from " + path);
  assert.equal(health.pid, pid, "Health must identify the owned Runtime PID");
  if (releasedOld) {
    assert.equal(health.server, "respire", "Unexpected legacy health server");
    assert.equal(health.v, 1, "Unexpected legacy health protocol");
    if (health.state === "starting" || (health.state === "ready" && health.startup_complete === false)) return;
    assert.equal(health.state, "ready");
    assert.equal(health.startup_complete, true, "Legacy Runtime startup must be complete");
    assert(typeof health.account_id === "string" && health.account_id &&
      typeof health.instance_id === "string" && health.instance_id &&
      Number.isSafeInteger(health.generation) && health.generation > 0, "Missing legacy Runtime scope");
  } else {
    if (health.status === "starting") return;
    assert.equal(health.status, "ready");
  }
  return health;
}

export async function withRuntime(binary, fixture, run, {releasedOld = false, junction = false} = {}) {
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
    runtime = ownedProcess(binary, ["serve", "--host", "127.0.0.1", "--port", String(port), "--data-dir", env.RSRS_DATA_DIR],
      {cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"]});
    // Inherited pipes can remain open after the direct child exits.
    runtime.child.stdout.resume();
    runtime.child.stderr.resume();
    const base = "http://127.0.0.1:" + port;
    const deadline = Date.now() + 30_000;
    let health;
    while (!health) {
      runtime.assertRunning();
      assert(Date.now() < deadline, "Timed out waiting for owned Runtime health");
      try {
        health = await probeReadiness(base, runtime.child.pid, releasedOld);
      } catch (error) {
        if (error.cause?.code !== "ECONNREFUSED") throw error;
      }
      if (!health) await delay(50);
    }
    const target = httpTarget(base, {authorization: "Bearer " + token}, releasedOld ? health : undefined);
    const result = await run({target, env, root: workspace});
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
