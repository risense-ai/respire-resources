import assert from "node:assert/strict";
import test from "node:test";
import {withRuntime} from "./targets.mjs";

test("download fixture accepts only an unprivileged integer port", async () => {
  for (const downloadMirrorPort of [0, 1023, 65536, 1234.5, "1234", "http://example.invalid"]) {
    await assert.rejects(withRuntime("unused", {syntheticReady: true}, () => {},
      {deviceLocal: true, downloadMirrorPort}), /unprivileged TCP port/);
  }
});

test("download fixture cannot be used with an ordinary or junction profile", async () => {
  for (const options of [{}, {deviceLocal: true, junction: true}]) {
    await assert.rejects(withRuntime("unused", {syntheticReady: true}, () => {},
      {...options, downloadMirrorPort: 1234}), /fresh synthetic device-local profile/);
  }
});
