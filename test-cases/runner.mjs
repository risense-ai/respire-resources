import assert from "node:assert/strict";
import {readdir, readFile} from "node:fs/promises";
import {isAbsolute} from "node:path";
import {isDeepStrictEqual, parseArgs} from "node:util";
import {pathToFileURL} from "node:url";
import {assertBinary, checkFixtureProfile, mockTarget, withCleanup, withRuntime} from "./targets.mjs";
import {cliTarget} from "./cli-e2e/command.mjs";

const here = new URL("./scenarios/", import.meta.url);
const own = (object, key) => object != null && Object.hasOwn(object, key);

function select(value, path) {
  function walk(current, parts) {
    if (!parts.length) return current;
    const [key, ...rest] = parts;
    if (key === "*") {
      assert(Array.isArray(current), "Expected array in selector " + path);
      return current.map(item => walk(item, rest));
    }
    return own(current, key) ? walk(current[key], rest) : undefined;
  }
  return path === "$" ? value : walk(value, path.split("."));
}

function resolve(value, variables, encode = false) {
  if (typeof value === "string") {
    const lookup = name => {
      assert(own(variables, name), "Undefined variable " + name);
      return variables[name];
    };
    const exact = /^\$\{(\w+)\}$/.exec(value);
    if (exact && !encode) return lookup(exact[1]);
    return value.replace(/\$\{(\w+)\}/g, (_, name) => {
      const field = lookup(name);
      assert(["string", "number"].includes(typeof field), "Expected scalar " + name);
      return encode ? encodeURIComponent(field) : String(field);
    });
  }
  if (Array.isArray(value)) return value.map(item => resolve(item, variables));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, variables)]));
  }
  return value;
}

function check(response, expect) {
  const {status, media, data} = response;
  for (const [rule, entries] of Object.entries(expect)) {
    if (rule === "status") assert(status === entries, "HTTP status mismatch");
    else if (rule === "media") assert(media === entries, "Response media type mismatch");
    else if (rule === "exit") assert(response.exit === entries, "CLI exit code mismatch");
    else if (rule === "present") {
      for (const path of entries) {
        const actual = select(data, path);
        assert(actual !== undefined && actual !== null && actual !== "", path + " is missing");
      }
    } else {
      assert(["equal", "different", "oneOf", "includes", "excludes", "matches"].includes(rule), "Unknown assertion " + rule);
      for (const [path, expected] of Object.entries(entries)) {
        const actual = select(data, path);
        assert(actual !== undefined, path + " is missing");
        if (rule === "equal") assert(isDeepStrictEqual(actual, expected), path + " equality mismatch");
        if (rule === "different") assert(!isDeepStrictEqual(actual, expected), path + " difference mismatch");
        if (rule === "oneOf") assert(expected.includes(actual), path + " has an unexpected value");
        if (rule === "matches") {
          assert(typeof actual === "string" && typeof expected === "string" && expected.length,
            path + " matches requires nonempty string pattern and string value");
          let pattern;
          try {
            pattern = new RegExp(expected, "im");
          } catch {
            throw new Error(path + " has invalid matches pattern");
          }
          assert(pattern.test(actual), path + " does not match expected pattern");
        }
        if (rule === "includes" || rule === "excludes") {
          assert(Array.isArray(actual), path + " must be an array");
          for (const item of expected) assert(actual.includes(item) === (rule === "includes"), path + " " + rule + " mismatch");
        }
      }
    }
  }
}

const terminals = new Set(["completed", "failed", "cancelled"]);

export async function runScenario(scenario, target, inputs = {}) {
  const variables = Object.assign(Object.create(null), inputs);
  const streams = new Map();
  async function execute(step, parallel = false) {
    try {
      assert(typeof step.name === "string" && step.name, "Step has no name");
      const actions = ["request", "cli", "subscribe", "event", "parallel"].filter(key => own(step, key));
      assert.equal(actions.length, 1, "Step must have exactly one action");
      const action = actions[0];
      const keys = ["request", "event", "cli"].includes(action) ? ["name", action, "expect", "save"] : ["name", action];
      for (const key of Object.keys(step)) assert(keys.includes(key), "Unknown step field " + key);
      assert(!parallel || (action === "request" && !step.save), "Parallel steps must be requests without captures");

      if (action === "parallel") {
        assert(Array.isArray(step.parallel) && step.parallel.length > 1, "Expected multiple parallel requests");
        const results = await Promise.allSettled(step.parallel.map(child => execute(child, true)));
        const failures = results.filter(result => result.status === "rejected");
        if (failures.length) throw new Error(failures.map(result => result.reason.message).join("\n"));
        return;
      }
      if (action === "subscribe") {
        const {stream, path} = step.subscribe;
        assert(typeof stream === "string" && !streams.has(stream), "Duplicate or invalid stream name");
        streams.set(stream, await target.subscribe(resolve(path, variables, true)));
        return;
      }
      let response;
      if (action === "request") {
        const {path, ...request} = step.request;
        assert(["GET", "POST", "PATCH", "DELETE"].includes(request.method), "Invalid HTTP method");
        assert(Number.isInteger(step.expect?.status), "HTTP request needs an expected status");
        response = await target.request({...resolve(request, variables), path: resolve(path, variables, true)});
      } else if (action === "cli") {
        assert(scenario.target === "cli" && typeof target.cli === "function", "CLI needs a compiled CLI scenario");
        const {args, format} = step.cli;
        assert(Array.isArray(args) && args.length && args.every(arg => typeof arg === "string" && arg.length),
          "CLI needs a literal argument list");
        assert(["json", "text"].includes(format), "CLI output format must be json or text");
        assert(Number.isInteger(step.expect?.exit), "CLI needs an expected exit code");
        response = await target.cli({args, format});
      } else {
        const stream = streams.get(step.event.stream);
        assert(stream, "Unknown event stream " + step.event.stream);
        const name = step.event.name;
        assert(name === "progress" || terminals.has(name), "Invalid event name");
        const above = Object.entries(step.event.above ?? {});
        assert(!above.length || name === "progress", "Event thresholds apply to progress only");
        assert(above.every(([, value]) => Number.isFinite(value)), "Event thresholds must be finite numbers");
        for (;;) {
          const {done, value} = await stream.next();
          assert(!done, "Stream ended before " + name);
          if (value.event === name && above.every(([path, threshold]) => {
            const actual = select(value.data, path);
            return Number.isFinite(actual) && actual > threshold;
          })) {
            response = {data: value.data};
            break;
          }
          assert(!terminals.has(value.event), "Unexpected terminal event " + value.event);
        }
      }
      check(response, resolve(step.expect ?? {}, variables));
      for (const [name, path] of Object.entries(step.save ?? {})) {
        assert(!own(variables, name), "Duplicate capture " + name);
        const value = select(response.data, path);
        assert(value !== undefined && value !== null && value !== "", "Missing capture " + path);
        variables[name] = value;
      }
    } catch (error) {
      throw new Error(step.name + ": " + error.message, {cause: error});
    }
  }

  await withCleanup(async () => {
    assert(Array.isArray(scenario.steps) && scenario.steps.length, "Scenario has no steps");
    for (const name of scenario.inputs ?? []) {
      assert(typeof variables[name] === "string" && variables[name].trim(), "Missing required input " + name);
    }
    for (const step of scenario.steps) await execute(step);
  }, async () => {
    const results = await Promise.allSettled([...streams.values()].map(async stream => stream.return()));
    const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, failures.map(String).join("\n"));
  });
}

export async function loadScenarios(directory = here) {
  const files = (await readdir(directory)).filter(name => name.endsWith(".yaml")).sort();
  assert(files.length, "No scenario files");
  const ids = new Set();
  return Promise.all(files.map(async file => {
    const scenario = JSON.parse(await readFile(new URL(file, directory), "utf8"));
    assert(/^E2E-\d+$/.test(scenario.id) && !ids.has(scenario.id), "Invalid or duplicate scenario ID in " + file);
    assert(typeof scenario.title === "string" && scenario.title, "Missing title in " + file);
    assert(scenario.target === undefined || ["cli", "legacy-rpc"].includes(scenario.target), "Unknown target in " + file);
    ids.add(scenario.id);
    return scenario;
  }));
}

export async function main({legacyOnly = false} = {}) {
  const {values} = parseArgs({options: {
    "runtime-bin": {type: "string"}, "cli-bin": {type: "string"},
    verify: {type: "boolean"}, "synthetic-ready": {type: "boolean"},
    ...(legacyOnly ? {"profile-fixture": {type: "string"}, preflight: {type: "boolean"},
      "released-old": {type: "boolean"}} : {
      mock: {type: "boolean"}, "runtime-fixtures": {type: "string"}
    })
  }});
  const {"runtime-bin": runtimeBin, "cli-bin": cliBin, "runtime-fixtures": manifest, "released-old": releasedOld} = values;
  assert(!values["synthetic-ready"] || (!values.mock && !values.preflight),
    "Synthetic ready setup requires compiled execution, not mock or preflight");
  assert(!values["synthetic-ready"] || (!releasedOld && !values["profile-fixture"]),
    "Synthetic ready setup cannot use released-old or a supplied profile");
  assert(!(values.verify && values.preflight), "Verification cannot use preflight (no suites execute)");
  assert(!releasedOld || (runtimeBin && cliBin && values["profile-fixture"]),
    "Released-old baseline requires --runtime-bin, --cli-bin and --profile-fixture");
  assert(!(values.mock && (runtimeBin || cliBin)), "Choose one target mode");
  assert(!cliBin || runtimeBin, "CLI binary requires a compiled Runtime");
  assert(!manifest || (runtimeBin && isAbsolute(manifest)), "Runtime fixtures require a compiled Runtime and an absolute manifest path");
  if (values.preflight) {
    assert(runtimeBin && values["profile-fixture"], "Preflight requires --runtime-bin and --profile-fixture");
  }
  if (runtimeBin) await assertBinary(runtimeBin, "Runtime");
  if (cliBin) await assertBinary(cliBin, "CLI");
  const scenarios = (await loadScenarios()).filter(scenario => !legacyOnly || scenario.target);
  if (values.preflight) {
    await checkFixtureProfile(values["profile-fixture"]);
    console.log("PREFLIGHT: checked artifact paths and fixture directory entries only");
  }
  const fixtures = manifest ? JSON.parse(await readFile(manifest, "utf8")) : {};
  let failures = 0;
  let passed = 0;
  let skipped = 0;
  for (const scenario of scenarios) {
    const legacy = Boolean(scenario.target);
    const cli = scenario.target === "cli";
    const targetName = cli ? "COMPILED CLI" : legacy ? "COMPILED LEGACY RPC" : values.mock ? "MOCK FIXTURE" : "COMPILED RUNTIME";
    const label = targetName + " " + scenario.id + " " + scenario.title + (releasedOld ? " [released-old]" : "");
    const fixture = legacyOnly ? {profile: values["profile-fixture"], syntheticReady: values["synthetic-ready"]} :
      {...fixtures[scenario.id], ...(values["synthetic-ready"] ? {syntheticReady: true} : {})};
    const missing = [];
    if (!values.mock || legacy) {
      if (!runtimeBin) missing.push("absolute Runtime binary");
      if (cli && !cliBin) missing.push("absolute CLI binary");
      if (legacy && !fixture?.profile && !fixture?.syntheticReady) missing.push("synthetic profile directory");
      for (const name of scenario.inputs ?? []) {
        if (!fixture?.inputs?.[name]) missing.push("offline input " + name);
      }
    }
    if (missing.length) {
      skipped++;
      if (values.verify && !(values.mock && legacy)) failures++;
      console.log("SKIP " + label + " (requires " + missing.join(", ") + ")");
      continue;
    }
    if (values.preflight) {
      console.log("PLANNED " + label + " (not executed)");
      continue;
    }
    try {
      if (values.mock) await runScenario(scenario, mockTarget(scenario.mock), scenario.mockInputs);
      else await withRuntime(runtimeBin, fixture, runtime => runScenario(scenario,
        cli ? cliTarget(cliBin, runtime) : runtime.target, fixture?.inputs), {releasedOld});
      console.log("PASS " + label);
      passed++;
    } catch (error) {
      failures++;
      console.error("FAIL " + label + " — " + error.message);
    }
  }
  if (values.verify && !passed) failures++;
  console.log(`SUMMARY passed=${passed} skipped=${skipped} failures=${failures} preflight=${Boolean(values.preflight)}`);
  process.exitCode = failures ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
