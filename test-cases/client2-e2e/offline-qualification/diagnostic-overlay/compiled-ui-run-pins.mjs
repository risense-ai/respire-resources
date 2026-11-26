import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {lstat, readFile, realpath} from "node:fs/promises";
import {isAbsolute, join} from "node:path";

const source = "4da41a593ea1663a8199b4b9a1475eb05b8620a8";
const oldLocal = "e2ec0a82463971ad15ed2be75d3d37eee78a70da8489fc4dc0871ee1d6e22b93";

async function pinned(entry, expected) {
  assert(entry && isAbsolute(entry.path) && /^[a-f0-9]{64}$/.test(entry.sha256));
  const st = await lstat(entry.path);
  assert(st.isFile() && !st.isSymbolicLink() && st.nlink === 1, "Expected a private staging file");
  const canonical = await realpath(entry.path);
  assert.equal(canonical.toLowerCase(), entry.path.toLowerCase(), "Artifact path must be canonical");
  if (expected !== undefined) assert.equal(await realpath(expected), canonical);
  const hash = createHash("sha256");
  for await (const part of createReadStream(canonical)) hash.update(part);
  assert.equal(hash.digest("hex"), entry.sha256, "Artifact digest differs from the build receipt");
  return canonical;
}

export async function hostedRunPins(path, binary, desktop) {
  assert(process.platform === "win32" && process.arch === "x64" &&
    process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted" &&
    process.env.GITHUB_RUN_ATTEMPT === "1" && isAbsolute(path), "Expected one isolated hosted Windows qualification");
  const meta = await lstat(path);
  assert(meta.isFile() && !meta.isSymbolicLink() && meta.nlink === 1 && meta.size <= 8192);
  const m = JSON.parse(await readFile(path, "utf8"));
  assert.equal(m.source, source);
  assert.equal(m.run, process.env.GITHUB_RUN_ID);
  assert.equal(m.attempt, process.env.GITHUB_RUN_ATTEMPT);
  assert.equal(m.head, process.env.CARD018_FROZEN_HEAD);
  assert.match(m.head, /^[a-f0-9]{40}$/);
  assert.notEqual(m.runtime?.sha256, oldLocal, "Do not substitute the old local equivalent build");
  await pinned(m.node, process.execPath);
  await pinned(m.runtime, binary);
  await pinned(m.desktop, desktop);
  const chromium = await pinned(m.chromium);
  assert.equal(m.chromium.revision, "1194");
  assert.equal(m.chromium.version, "141.0.7390.37");
  assert.match(m.chromium.archive_sha256, /^[a-f0-9]{64}$/);
  const playwrightEntry = await pinned(m.playwright);
  assert.equal(m.playwright.version, "1.56.1");
  assert.match(m.playwright.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  const browserConfig = JSON.parse(await readFile(join(m.playwright.root, "browsers.json"), "utf8"));
  const {revision,browserVersion} = browserConfig.browsers.find(item => item.name === "chromium") ?? {};
  assert.equal(revision, m.chromium.revision);
  assert.equal(browserVersion, m.chromium.version);
  assert.equal(await realpath(join(m.playwright.root, "index.js")), playwrightEntry);
  return {digest:m.runtime.sha256, desktopDigest:m.desktop.sha256, chromium, playwrightCore:m.playwright.root};
}
