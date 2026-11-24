import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";

const {defineConfig} = createRequire(import.meta.url)("@playwright/test");
const browserName = process.env.RESPIRE_E2E_BROWSER ?? "chromium";
const executablePath = process.env.RESPIRE_E2E_BROWSER_EXECUTABLE;

export default defineConfig({
  testMatch: "layout.spec.mjs",
  outputDir: join(tmpdir(), "respire-playwright-" + randomUUID()),
  reporter: "list",
  timeout: 30_000,
  use: {serviceWorkers: "block", launchOptions: {executablePath}},
  projects: ["en", "zh"].map(locale => ({
    name: locale, use: {locale, browserName}
  }))
});
