import assert from "node:assert/strict";
import {test} from "node:test";
import {requireExecutedTest} from "./verify-online-model-win.mjs";

const operation = "TestRealRuntimeOwnedModelUninstallWindows";
const pkg = "respire-client2/internal/host";
const run = {Action: "run", Test: operation, Package: pkg};
const passed = {Action: "pass", Test: operation, Package: pkg};
const packagePassed = {Action: "pass", Package: pkg};
const lines = (...events) => events.map(event => JSON.stringify(event)).join("\n");

test("requires exact Go product execution and package completion", () => {
  assert.doesNotThrow(() => requireExecutedTest(lines(run, passed, packagePassed)));
  assert.throws(() => requireExecutedTest(lines(packagePassed)));
  assert.throws(() => requireExecutedTest(lines(run, {...passed, Action: "skip"}, packagePassed)));
  assert.throws(() => requireExecutedTest(lines(run, passed, {...passed, Action: "fail"}, packagePassed)));
  assert.throws(() => requireExecutedTest(lines(run, run, passed, packagePassed)));
  assert.throws(() => requireExecutedTest(lines(run, passed)));
});
