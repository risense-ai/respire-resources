import assert from "node:assert/strict";
import {connect, createServer} from "node:net";
import {once} from "node:events";
import {test} from "node:test";
import {connectHost, nextProbe, relay} from "./model-download-relay.mjs";

const hosts = new Set(["huggingface.co"]);
const header = "CONNECT huggingface.co:443 HTTP/1.1\r\nHost: huggingface.co:443\r\n\r\n";
test("relay admits only credential-free exact HTTPS CONNECT and validates HEAD redirect", () => {
  assert.equal(connectHost(header, hosts), "huggingface.co");
  for (const invalid of [
    header.replaceAll("huggingface.co", "huggingface.co.invalid"),
    header.replaceAll(":443", ":80"), header.replace("CONNECT", "GET"),
    header.replace("Host: huggingface.co", "Host: localhost"),
    header.replace("\r\n\r\n", "\r\nProxy-Authorization: fixture\r\n\r\n"),
    header.replace("\r\n\r\n", "\r\nContent-Length: 1\r\n\r\n")
  ]) assert.equal(connectHost(invalid, hosts), undefined);
  const pin = new URL("https://huggingface.co/example");
  assert.equal(nextProbe(pin, "https://cdn-lfs.hf.co/example").hostname, "cdn-lfs.hf.co");
  for (const invalid of ["http://huggingface.co/x", "https://127.0.0.1/x",
    "https://fixture@huggingface.co/x", "https://huggingface.co:444/x", "https://huggingface.co.invalid/x"])
    assert.throws(() => nextProbe(pin, invalid), /approved HTTPS hosts/);
});

test("owned loopback relay accounts and bounds both attempts, then closes all sockets", {timeout: 15000}, async () => {
  const clients = new Set();
  const upstream = createServer(socket => {
    clients.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => clients.delete(socket));
    socket.once("data", input => {
      assert.equal(input.toString(), "test");
      socket.write(Buffer.alloc(256 * 1024, 42));
    });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const proxy = await relay(hosts, host => {
    assert.equal(host, "huggingface.co");
    return connect(upstream.address().port, "127.0.0.1");
  });
  const port = Number(new URL(proxy.url).port);
  const dial = () => connect(port, "127.0.0.1");
  try {
    const unopened = dial();
    unopened.on("error", () => {});
    await once(unopened, "close");
    for (let i = 0; i < 2; i++) {
      proxy.begin();
      const socket = dial();
      socket.on("error", () => {});
      const closed = new Promise(resolve => socket.once("close", resolve));
      socket.write(header);
      const [response] = await once(socket, "data");
      assert.match(response.toString(), /^HTTP\/1\.1 200/);
      socket.write("test");
      let bytes = 0;
      socket.on("data", block => {
        bytes += block.length;
        if (i === 0 && bytes >= 4096) socket.destroy();
      });
      await closed;
      const receipt = proxy.report()[i];
      assert(bytes >= 4096 && bytes < 128 * 1024);
      assert(receipt.bytes >= bytes && receipt.bytes <= 128 * 1024);
      assert.equal(receipt.capped, i === 1);
    }
    assert.throws(() => proxy.begin());
  } finally {
    await proxy.close();
    for (const client of clients) client.destroy();
    await new Promise(resolve => upstream.close(resolve));
  }
  const closed = dial();
  const [error] = await once(closed, "error");
  assert.equal(error.code, "ECONNREFUSED");
});
