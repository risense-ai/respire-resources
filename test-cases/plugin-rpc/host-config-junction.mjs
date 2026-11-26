import assert from "node:assert/strict";
import {lstat, realpath} from "node:fs/promises";
import {join} from "node:path";
import {withRuntime} from "../targets.mjs";
import {httpRoundTrip} from "./transport.mjs";

assert.equal(process.platform, "win32");
assert.equal(process.argv.length, 3);
console.log("PHASE startup");
const receipt = await withRuntime(process.argv[2], {syntheticReady: true}, async runtime => {
  const {target, root, ownedRoot, env} = runtime;
  assert((await lstat(root)).isSymbolicLink());
  assert.equal(await realpath(root), await realpath(join(ownedRoot, "physical workspace")));
  const marker = join(env.RSRS_DATA_DIR, "runtime", "autostart", "maintenance.json");
  const sample = () => assert.rejects(lstat(marker), {code: "ENOENT"});
  const path = "/v1/host/config";
  async function config(method, body) {
    const response = await target.request({method, path, body});
    assert.equal(response.status, 200);
    return response.data;
  }
  console.log("PHASE baseline");
  const saved = await config("GET");
  assert(["en", "zh"].includes(saved.language));
  const language = saved.language === "en" ? "zh" : "en";
  const en = await httpRoundTrip(target, "en");
  await sample();
  let zh;
  try {
    console.log("PHASE edit");
    await config("PATCH", {language});
    assert.deepEqual(await config("GET"), {...saved, language});
    await sample();
    zh = await httpRoundTrip(target, "zh");
  } finally {
    console.log("PHASE restore");
    await config("PATCH", {language: saved.language});
    assert.deepEqual(await config("GET"), saved);
    await sample();
  }
  return {en, zh};
}, {junction: true, deviceLocal: true});
console.log("PASS junction HTTP en=" + receipt.en + " zh=" + receipt.zh + " config restored samples=3");
