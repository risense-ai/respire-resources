import assert from "node:assert/strict";
import {assertIndependentWitness, productScreenPlan} from "./compiled-product-screen-plan.mjs";

const owners = ["pid", "instance_id", "account_id", "generation"];
const approved = new Set(["overview", "quickpanel", "stats"]);

// A passive, isolated GET witness lane, not an execution-policy replacement.
// Existing Wails and browser intercepts still enforce their own read/preview allowlists.
// Nothing here changes preferences, issues a command, reads a session file or emits a PASS.
export async function observeHostedWorkspace({page, request, origin, name, locale, owned, receipt}) {
  assert(approved.has(name), "No executable witness for this screen yet");
  const plan = productScreenPlan(name, locale, origin);
  assert(Number.isSafeInteger(owned?.pid) && owned.pid > 0 &&
    typeof owned.instance_id === "string" && owned.instance_id.length > 0 &&
    typeof owned.account_id === "string" && owned.account_id.length > 0 &&
    Number.isSafeInteger(owned.generation) && owned.generation > 0 &&
    /^[0-9a-f]{40}$/.test(owned.source) && /^[0-9a-f]{64}$/.test(owned.runtimeDigest) &&
    /^[0-9a-f]{64}$/.test(owned.desktopDigest) && /^[0-9a-f]{32}$/.test(owned.issuer),
  "Missing independent owned authority or executable pins");
  for (const field of [...owners, "runtimeDigest", "desktopDigest", "issuer"]) {
    assert.equal(receipt?.[field], owned[field], "Witness does not belong to owned " + field);
  }
  assert.equal(receipt?.sourceSHA, owned.source, "Witness does not belong to pinned source");
  const expected = assertIndependentWitness(plan, receipt);
  const current = new URL(page.url());
  const target = new URL(plan.navigation);
  assert.equal(current.origin, origin);
  assert.equal(current.pathname, target.pathname);
  assert.equal(current.hash, target.hash);
  const stateURL = origin + "/api/state";
  const response = await request.get(stateURL, {maxRedirects: 0, timeout: 5000});
  assert.equal(response.url(), stateURL, "State response moved outside exact lane");
  assert.equal(response.status(), 200, "Owned state read failed");
  assert.equal(response.headers()["x-card018-issuer"], owned.issuer, "Unexpected Wails issuer");
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.result?.connected, true);
  // Application locale comes from the disposable host preferences, not query.
  assert.equal(body.result.preferences?.language, locale, "Wrong isolated host preference");
  assert.equal(body.result.health?.pid, owned.pid);
  assert.equal(body.result.health?.instance_id, owned.instance_id);
  assert.equal(body.result.health?.account_id, owned.account_id);
  assert.equal(body.result.health?.generation, owned.generation);
  assert.equal(body.result.health?.image_sha256, owned.runtimeDigest);
  assert.equal(await page.locator("html").getAttribute("lang"), locale === "zh" ? "zh-CN" : "en");
  const root = page.locator(plan.surface);
  await root.waitFor({state:"visible"});
  assert.equal(await root.count(), 1, "Ambiguous compiled screen");
  if (name === "overview") {
    const statusURL = origin + "/api/runtime-status";
    const status = await request.get(statusURL, {maxRedirects: 0, timeout: 5000});
    assert.equal(status.url(), statusURL);
    assert.equal(status.status(), 200);
    assert.equal(status.headers()["x-card018-issuer"], owned.issuer);
    const loaded = await status.json();
    assert.equal(loaded.ok, true);
    assert(Number.isSafeInteger(loaded.result?.summary?.local_alive));
    assert.equal(String(loaded.result.summary.local_alive), expected, "Runtime status does not match independent seeded count");
    // Mounted Overview paints its placeholder before its own async status call.
    await page.waitForFunction(({surface,selector,value}) => {
      const roots = document.querySelectorAll(surface);
      if (roots.length !== 1) return false;
      const elements = roots[0].querySelectorAll(selector);
      return elements.length === 1 && elements[0].innerText.trim() === value;
    }, {surface:plan.surface, selector:plan.selector, value:expected}, {timeout:4000});
  }
  const witness = plan.selector ? root.locator(plan.selector) : root.getByText(expected, {exact:true});
  await witness.waitFor({state:"visible"});
  assert.equal(await witness.count(), 1, "Ambiguous loaded-data selector");
  assert.equal((await witness.innerText()).trim(), expected, "Compiled DOM differs from independent Runtime witness");
  return Object.freeze({name, locale, observed: true});
}

