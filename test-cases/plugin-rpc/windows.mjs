import assert from "node:assert/strict";
import {parseArgs} from "node:util";
import {withRuntime} from "../targets.mjs";
import {httpBurst, httpRoundTrip} from "./transport.mjs";
import {mcpRoundTrip} from "./mcp.mjs";

const {values} = parseArgs({options: {
  "runtime-bin": {type: "string"}, "cli-bin": {type: "string"}, "profile-fixture": {type: "string"},
  verify: {type: "boolean"}, "synthetic-ready": {type: "boolean"}, transport: {type: "string", default: "all"}
}});
const runtimeBin = values["runtime-bin"];
const cliBin = values["cli-bin"];
const profile = values["profile-fixture"];

assert(["all", "http", "mcp"].includes(values.transport), "Transport must be all, http, or mcp");
assert(!values["synthetic-ready"] || !profile, "Synthetic ready setup cannot use a supplied profile");

if (process.platform !== "win32" || !runtimeBin || (values.transport !== "http" && !cliBin) ||
    (!profile && !values["synthetic-ready"])) {
  console.log("SKIP NATIVE WINDOWS HTTP/MCP — requires native Windows, compiled Runtime, CLI for MCP, and an offline profile or synthetic-ready");
  if (values.verify) process.exitCode = 1;
} else {
  const failures = [];
  for (const transport of values.transport === "all" ? ["http", "mcp"] : [values.transport]) {
    for (const locale of ["en", "zh"]) {
      try {
        const bytes = await withRuntime(runtimeBin, {profile, syntheticReady: values["synthetic-ready"]}, async runtime => {
          // T05-05 requires actual feature round trips; openapi.v1 is an example flag.
          const bytes = transport === "http" ? await httpRoundTrip(runtime.target, locale) :
            await mcpRoundTrip(cliBin, runtime, locale);
          if (transport === "http") await httpBurst(runtime.target);
          return bytes;
        }, {junction: true});
        console.log("PASS NATIVE WINDOWS JUNCTION " + transport.toUpperCase() + " " + locale +
          " UTF-8 bytes=" + bytes + (transport === "http" ? " concurrent store/recall" : " canonical CLI config; junction Runtime/cwd"));
      } catch (error) {
        console.error("FAIL NATIVE WINDOWS JUNCTION " + transport.toUpperCase() + " " + locale + ": " + error.message);
        failures.push(error);
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, "Native Windows feature checks failed");
}
