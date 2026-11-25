import {spawn} from "node:child_process";
import assert from "node:assert/strict";
import {once} from "node:events";
import {statSync} from "node:fs";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {dirname, isAbsolute, join} from "node:path";
import {fileURLToPath} from "node:url";

const require = createRequire(import.meta.url);
const target = process.env.RESPIRE_E2E_CLIENT2_FIXTURE ? "COMPILED CLIENT2 WEBUI + MOCK RUNTIME" : "MOCK RENDER";
const version = "1.56.1";
let manifest;
try {
  manifest = require.resolve("@playwright/test/package.json");
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
  throw new Error("Playwright run requires local @playwright/test@" + version + "; see test-cases/README.md");
}
assert.equal(require(manifest).version, version, "Unexpected @playwright/test version");
const name = process.env.RESPIRE_E2E_BROWSER ?? "chromium";
assert(["chromium", "webkit"].includes(name), "Choose chromium or webkit");
const executable = process.env.RESPIRE_E2E_BROWSER_EXECUTABLE ?? require("@playwright/test")[name].executablePath();
assert(isAbsolute(executable) && statSync(executable, {throwIfNoEntry: false})?.isFile(),
  "Local Playwright browser executable is unavailable: " + executable);

const scratch = await mkdtemp(join(tmpdir(), "respire-playwright-run-"));
try {
  console.log("RUN PLAYWRIGHT " + target + " @playwright/test@" + version + " " + name);
  const config = fileURLToPath(new URL("./playwright.config.mjs", import.meta.url));
  const cli = join(dirname(manifest), "cli.js");
  const report = join(scratch, "results.json");
  const child = spawn(process.execPath, [cli, "test", "--config", config, "--reporter=list,json"], {
    stdio: "inherit", windowsHide: true,
    env: {...process.env, TEMP: scratch, TMP: scratch, TMPDIR: scratch, PWTEST_CACHE_DIR: join(scratch, "transform"),
      PLAYWRIGHT_JSON_OUTPUT_FILE: report}
  });
  const [code] = await once(child, "close");
  process.exitCode = code ?? 1;
  if (code === 0) {
    const {stats} = JSON.parse(await readFile(report, "utf8"));
    const expected = process.env.RESPIRE_E2E_CLIENT2_FIXTURE ? 32 : 38;
    assert.equal(stats.expected, expected, "Required Playwright checks must execute and pass");
    assert.equal(stats.skipped, 38 - expected, "Only gallery-specific checks may skip in compiled mode");
    assert.equal(stats.unexpected + stats.flaky, 0, "No failed or flaky checks permitted");
  }
} finally {
  await rm(scratch, {recursive: true, maxRetries: 3, retryDelay: 100});
}
