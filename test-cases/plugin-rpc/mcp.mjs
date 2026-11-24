import assert from "node:assert/strict";
import {once} from "node:events";
import {stat} from "node:fs/promises";
import {isAbsolute} from "node:path";
import {createInterface} from "node:readline";
import {ownedProcess, withCleanup} from "../targets.mjs";
import {exactBytes, minimumBytes, payload, wire} from "./transport.mjs";

const protocolVersion = "2025-03-26";

export function frame(id, method, params) {
  return Buffer.concat([wire({jsonrpc: "2.0", id, method, params}), Buffer.from("\n")]);
}

export function decodeResult(line, id) {
  const reply = JSON.parse(line);
  assert.equal(reply.jsonrpc, "2.0");
  assert.equal(reply.id, id);
  assert(!Object.hasOwn(reply, "error"), "MCP JSON-RPC call failed");
  assert(Object.hasOwn(reply, "result"), "Missing MCP result");
  return reply.result;
}

function unwrap(result, command) {
  assert.equal(result.isError, false, "MCP tool failed: " + command);
  assert.equal(result.content.length, 1, "Expected one ResultEnvelope");
  assert.equal(result.content[0].type, "text");
  const envelope = JSON.parse(result.content[0].text);
  assert.equal(envelope.command, command);
  assert.equal(envelope.status, "ok", command + " did not succeed");
  return envelope;
}

export async function mcpRoundTrip(binary, {env, root}) {
  assert(isAbsolute(binary) && (await stat(binary)).isFile(), "Supply an absolute compiled CLI executable path");
  const timeout = AbortSignal.timeout(45_000);
  const runner = ownedProcess(binary, ["--client-only", "mcp"], {
    cwd: root, env, stdio: ["pipe", "pipe", "ignore"], signal: timeout
  });
  const {child} = runner;
  const output = createInterface({input: child.stdout, crlfDelay: Infinity});
  const lines = output[Symbol.asyncIterator]();
  let nextId = 0;

  async function send(bytes) {
    runner.assertRunning();
    if (!child.stdin.write(bytes)) await once(child.stdin, "drain", {signal: timeout});
  }
  async function request(method, params, minBytes = 0) {
    const id = ++nextId;
    const bytes = frame(id, method, params);
    assert(bytes.length - 1 > minBytes, "MCP message did not exceed requested byte count");
    await send(bytes);
    const {done, value} = await lines.next();
    assert(!done, "MCP closed before reply to " + method);
    return decodeResult(value, id);
  }

  const stopOnTimeout = () => output.close();
  timeout.addEventListener("abort", stopOnTimeout, {once: true});
  return withCleanup(async () => {
    const init = await request("initialize", {protocolVersion, capabilities: {}, clientInfo: {name: "card018", version: "1"}});
    assert.equal(init.protocolVersion, protocolVersion);
    assert(Object.hasOwn(init.capabilities, "tools"), "MCP tools capability missing");
    await send(frame(undefined, "notifications/initialized"));
    const {tools} = await request("tools/list");
    for (const name of ["memory_remember", "memory_recall"]) {
      assert(tools.some(tool => tool.name === name), "MCP tool missing: " + name);
    }
    const note = payload("mcp");
    const remember = {name: "memory_remember", arguments: {...note, force: true, importance: "trivial"}};
    const bytes = frame(nextId + 1, "tools/call", remember).length - 1;
    const stored = unwrap(await request("tools/call", remember, minimumBytes), "remember");
    const id = stored.summary.id;
    assert(typeof id === "string" && id, "Missing stored MCP memory ID");

    const recalled = unwrap(await request("tools/call", {
      name: "memory_recall", arguments: {query: note.title, limit: 10, related: false}
    }), "recall");
    const hit = recalled.details.find(({entry}) => entry.id === id);
    assert(hit, "Recall did not return the stored MCP memory ID");
    exactBytes(hit.entry.content, note.content);
    child.stdin.end();
    const result = await runner.closed;
    assert(!timeout.aborted && result.code === 0, "MCP did not exit cleanly");
    return bytes;
  }, async () => {
    timeout.removeEventListener("abort", stopOnTimeout);
    output.close();
    await runner.stop();
  });
}
