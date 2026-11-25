import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile, readdir} from "node:fs/promises";
import {isAbsolute, join} from "node:path";
import {parseArgs} from "node:util";
import {loadScenarios, runScenario} from "./runner.mjs";
import {assertBinary, withRuntime} from "./targets.mjs";
import {model, origin, probe, relay} from "./model-download-relay.mjs";

const {values} = parseArgs({options: {
  probe: {type: "boolean"}, "runtime-bin": {type: "string"}, "runtime-sha256": {type: "string"},
  "hosted-acceptance": {type: "boolean"}
}});
const binary = values["runtime-bin"];
assert(Boolean(values.probe) !== Boolean(values["hosted-acceptance"]), "Choose --probe or --hosted-acceptance");
const pinnedHash = values["runtime-sha256"];
assert(process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted",
  "The public-source probe and acceptance are opt-in on GitHub-hosted runners only");
assert(values.probe ? !binary && !pinnedHash : binary && isAbsolute(binary) && /^[0-9a-f]{64}$/i.test(pinnedHash ?? ""),
  "Acceptance requires an absolute Runtime executable and its expected SHA256");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
if (binary) {
  await assertBinary(binary, "Runtime");
  assert.equal(sha256(await readFile(binary)), pinnedHash.toLowerCase(), "Unexpected compiled Runtime artifact");
  assert.equal(sha256(await readFile(new URL("./scenarios/002-download-cancel.yaml", import.meta.url))),
    "8eca685c103b6d87badc6445de17e20b6f02124ac3ac3d6fb98e38469ac6832e", "Unexpected stock E2E002 bytes");
  console.log("Exact compiled Runtime SHA256: " + pinnedHash.toLowerCase());
}

const hosts = await probe();
console.log("PASS exact release-pinned tokenizer TLS HEAD (no body); route hosts: " + [...hosts].join(", "));
if (values.probe) process.exit(0);

const scenario = (await loadScenarios()).find(({id}) => id === "E2E-002");
assert.equal(scenario?.steps.length, 11, "Unexpected stock E2E002 shape");
const proxy = await relay(hosts);
try {
  await withRuntime(binary, {syntheticReady: true}, async ({target, env}) => {
    const request = input => target.request(input);
    const configure = await request({method: "PATCH", path: "/v1/host/config",
      body: {model_mirror: origin, proxy_url: proxy.url}});
    assert.equal(configure.status, 200, "Disposable profile must accept scoped proxy");
    assert.equal(configure.data.model_mirror, origin);
    assert.equal(configure.data.proxy_url, proxy.url);
    const operations = [];
    await runScenario(scenario, {...target, async request(input) {
      const start = input.method === "POST" && input.path === "/v1/models/downloads";
      if (start) proxy.begin();
      const reply = await request(input);
      if (start && reply.status === 202) operations.push(reply.data.operation_id);
      return reply;
    }}, {downloadModel: model});
    assert.equal(operations.length, 2);
    assert.notEqual(operations[0], operations[1]);
    for (const id of operations) {
      const status = await request({method: "GET", path: "/v1/operations/" + id});
      assert.equal(status.status, 200);
      assert.equal(status.data.operation_id, id);
      assert.equal(status.data.state, "cancelled");
    }
    let files = [];
    try {
      files = await readdir(join(env.RSRS_DATA_DIR, "models"), {withFileTypes: true, recursive: true});
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    assert(files.every(entry => entry.isDirectory()), "Cancelled attempts left a model file or staging artifact");
    const transfers = proxy.report();
    assert.equal(transfers.length, 2);
    assert(transfers.every(x => x.bytes >= 9759 && x.bytes < 128 * 1024 && !x.capped));
    console.log("PASS compiled E2E-002 stock 11/11; two distinct cancelled operations; no model files");
    console.log("Relay accounted TLS bytes per attempt: " + transfers.map(({bytes}) => bytes).join(", "));
  }, {deviceLocal: true});
} finally {
  await proxy.close();
}
