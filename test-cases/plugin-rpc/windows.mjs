import assert from "node:assert/strict";
import {parseArgs} from "node:util";
import {withRuntime} from "../targets.mjs";
import {httpBurst, httpRoundTrip} from "./transport.mjs";
import {mcpRoundTrip} from "./mcp.mjs";

const {values} = parseArgs({options: {
  "runtime-bin": {type: "string"}, "cli-bin": {type: "string"}, "profile-fixture": {type: "string"}
}});
const runtimeBin = values["runtime-bin"];
const cliBin = values["cli-bin"];
const profile = values["profile-fixture"];

if (process.platform !== "win32" || !runtimeBin || !cliBin || !profile) {
  console.log("SKIP NATIVE WINDOWS HTTP/MCP — requires native Windows, compiled Runtime and CLI, and a sanitized offline profile fixture");
} else {
  await withRuntime(runtimeBin, {profile}, async runtime => {
    const health = await runtime.target.request({method: "GET", path: "/v1/health", public: true});
    assert(health.data.capabilities.includes("openapi.v1"));
    const httpBytes = await httpRoundTrip(runtime.target);
    console.log("PASS NATIVE WINDOWS JUNCTION HTTP UTF-8 bytes=" + httpBytes);
    await httpBurst(runtime.target);
    console.log("PASS NATIVE WINDOWS JUNCTION HTTP concurrent store/recall");
    const mcpBytes = await mcpRoundTrip(cliBin, runtime);
    console.log("PASS NATIVE WINDOWS JUNCTION MCP UTF-8 bytes=" + mcpBytes);
  }, {junction: true});
}
