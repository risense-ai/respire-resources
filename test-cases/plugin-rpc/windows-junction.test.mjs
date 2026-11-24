import assert from "node:assert/strict";
import {lstat, mkdir, mkdtemp, readFile, realpath, rm, rmdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {checkFixtureProfile, createWindowsJunction, isolatedEnv} from "../targets.mjs";
import {frame} from "./mcp.mjs";
import {minimumBytes, payload} from "./transport.mjs";

test("Windows UTF-8 junction fixture keeps the physical workspace intact on cleanup", async t => {
  assert.equal(process.platform, "win32", "Run this check on native Windows");
  const root = await mkdtemp(join(tmpdir(), "respire card018 junction "));
  t.after(() => rm(root, {recursive: true}));
  const alias = await createWindowsJunction(root);
  const physical = join(root, "physical workspace");
  const {RSRS_DATA_DIR: profile} = isolatedEnv(alias, 0, "unit-fixture-only");
  const bytes = frame(1, "tools/call", {name: "memory_remember", arguments: payload("junction")});
  try {
    assert(bytes.length - 1 > minimumBytes);
    assert((await lstat(alias)).isSymbolicLink());
    assert.equal(await realpath(alias), await realpath(physical));
    await assert.rejects(checkFixtureProfile(root), /regular files and directories/);
    await mkdir(profile);
    await writeFile(join(profile, "payload.jsonl"), bytes);
    assert.deepEqual(await readFile(join(physical, "profile", "payload.jsonl")), bytes);
  } finally {
    await rmdir(alias);
  }
  await assert.rejects(lstat(alias), {code: "ENOENT"});
  assert.deepEqual(await readFile(join(physical, "profile", "payload.jsonl")), bytes);
});
