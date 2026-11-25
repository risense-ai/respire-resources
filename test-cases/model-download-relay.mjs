import assert from "node:assert/strict";
import {createServer, connect} from "node:net";
import {request} from "node:https";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";

export const origin = "https://huggingface.co";
export const model = "bge-small-zh-v1.5";
const revision = "75c43b069aac4d136ba6bc1122f995fedcfd2781";
const tokenizer = new URL("/Xenova/" + model + "/resolve/" + revision + "/tokenizer.json", origin);
const size = 439125;
const approved = new Set([
  "huggingface.co", "cdn-lfs.huggingface.co", "cdn-lfs.hf.co", "cdn-lfs-us-1.hf.co", "cas-bridge.xethub.hf.co"
]);

export function connectHost(header, hosts) {
  const lines = header.split("\r\n");
  const match = /^CONNECT ([a-z0-9.-]+):443 HTTP\/1\.[01]$/.exec(lines[0]);
  const host = match?.[1];
  if (!host || !hosts.has(host)) return;
  let sawHost = false;
  for (const line of lines.slice(1, -2)) {
    const target = /^Host: ([a-z0-9.-]+):443$/i.exec(line);
    // Accept only conventional headers, never credentials or body framing.
    if (target && target[1] === host && !sawHost) sawHost = true;
    else if (!/^(?:user-agent|proxy-connection|connection): [\x20-\x7e]{1,256}$/i.test(line)) return;
  }
  return host;
}

export function nextProbe(current, location) {
  let next;
  try { next = new URL(location, current); }
  catch { throw new Error("Invalid pinned tokenizer HEAD redirect"); }
  if (next.protocol !== "https:" || next.port || next.username || next.password || !approved.has(next.hostname)) {
    throw new Error("Pinned tokenizer HEAD redirects outside Runtime's approved HTTPS hosts");
  }
  return next;
}

export async function probe() {
  const hosts = new Set();
  const seen = new Set();
  const signal = AbortSignal.timeout(10000);
  let url = tokenizer;
  for (let i = 0; i < 5; i++) {
    if (seen.has(url.href)) break;
    seen.add(url.href);
    hosts.add(url.hostname);
    const [status, headers] = await new Promise((resolve, reject) => {
      const req = request(url, {
        method: "HEAD", agent: false, signal, rejectUnauthorized: true, maxHeaderSize: 8192,
        headers: {"accept-encoding": "identity"}
      }, res => { resolve([res.statusCode, res.headers]); res.destroy(); });
      req.on("error", () => reject(new Error("Exact pinned tokenizer HEAD unavailable")));
      req.end();
    });
    if (status === 200 && Number(headers["content-length"]) === size) return hosts;
    if (![301, 302, 303, 307, 308].includes(status) || !headers.location) break;
    url = nextProbe(url, headers.location);
  }
  throw new Error("Pinned tokenizer HEAD did not confirm exact length");
}

const chunk = 2048;
export async function relay(hosts, dial = host => connect({host, port: 443, highWaterMark: chunk})) {
  const sockets = new Set();
  const attempts = [];
  let active;
  // Count TLS bytes in both directions and shared across all CONNECTs per attempt.
  const limit = 128 * 1024;
  const stop = () => { for (const socket of sockets) socket.destroy(); };
  const hold = socket => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
    return socket;
  };
  const server = createServer({highWaterMark: chunk}, client => {
    if (!active || active.signal.aborted || active.capped || sockets.size >= 8 || active.tunnels >= 6) { client.destroy(); return; }
    const attempt = active;
    attempt.tunnels++;
    hold(client);
    client.setTimeout(4000, () => client.destroy());
    void handle(client, attempt).catch(() => client.destroy());
  });
  async function forward(from, to, attempt, pace) {
    while (!from.destroyed && !to.destroyed) {
      if (attempt.bytes >= limit) { attempt.capped = true; stop(); return; }
      const frame = from.read(Math.min(chunk, limit - attempt.bytes,
        from.readableLength || 1));
      if (frame === null) {
        if (from.readableEnded) return;
        await once(from, "readable", {signal: attempt.signal});
        continue;
      }
      attempt.bytes += frame.length;
      if (pace) await delay(Math.ceil(frame.length * 1000 / 16384), undefined, {signal: attempt.signal});
      if (!to.write(frame)) await once(to, "drain", {signal: attempt.signal});
    }
  }
  async function handle(client, attempt) {
    let header = "";
    while (!header.endsWith("\r\n\r\n")) {
      if (header.length >= 1024 || client.destroyed || client.readableEnded) return client.destroy();
      const b = client.read(1);
      if (b === null) { await once(client, "readable", {signal: attempt.signal}); continue; }
      header += b.toString("latin1");
    }
    const host = connectHost(header, hosts);
    if (!host || active !== attempt || attempt.signal.aborted || attempt.capped || client.readableLength) return client.destroy();
    const upstream = hold(dial(host));
    client.once("close", () => upstream.destroy());
    upstream.once("close", () => client.destroy());
    upstream.setTimeout(15000, () => upstream.destroy());
    await once(upstream, "connect", {signal: attempt.signal});
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    await Promise.all([forward(client, upstream, attempt, false), forward(upstream, client, attempt, true)]);
  }
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: "http://127.0.0.1:" + server.address().port,
    begin() {
      assert(attempts.length < 2);
      stop();
      const signal = AbortSignal.timeout(20000);
      active = {signal, bytes: 0, tunnels: 0, capped: false};
      const attempt = active;
      signal.addEventListener("abort", () => { if (active === attempt) stop(); }, {once: true});
      attempts.push(attempt);
    },
    report: () => attempts.map(({bytes, capped, tunnels}) => ({bytes, capped, tunnels})),
    async close() { stop(); await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())); }
  };
}
