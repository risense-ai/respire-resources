import assert from "node:assert/strict";
import {lstat, mkdir, mkdtemp, readFile, realpath, rm, rmdir, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {canonicalMcpEnv, checkFixtureProfile, createWindowsJunction, isolatedEnv} from "../targets.mjs";
import {frame} from "./mcp.mjs";
import {minimumBytes, payload} from "./transport.mjs";

test("Windows UTF-8 junction fixture keeps the physical workspace intact on cleanup", async t => {
  assert.equal(process.platform, "win32", "Run this check on native Windows");
  const root = await mkdtemp(join(tmpdir(), "respire card018 junction "));
  t.after(() => rm(root, {recursive: true}));
  const alias = await createWindowsJunction(root);
  const physical = join(root, "physical workspace");
  const env = isolatedEnv(alias, 0, "unit-fixture-only");
  const {RSRS_DATA_DIR: profile} = env;
  const bytes = frame(1, "tools/call", {name: "memory_remember", arguments: payload("junction")});
  try {
    assert(bytes.length - 1 > minimumBytes);
    assert((await lstat(alias)).isSymbolicLink());
    assert.equal(await realpath(alias), await realpath(physical));
    await assert.rejects(checkFixtureProfile(root), /regular files and directories/);
    await mkdir(profile);
    await writeFile(join(profile, "payload.jsonl"), bytes);
    assert.deepEqual(await readFile(join(physical, "profile", "payload.jsonl")), bytes);
    env.RSRS_M3_DIR = join(root, "empty-models");
    env.RSRS_NO_AUTOSYNC = "1";
    await mkdir(env.RSRS_M3_DIR);
    const before = {...env};
    const runtime = {env, root: alias, ownedRoot: root};
    const cliEnv = await canonicalMcpEnv(runtime);
    assert.equal(cliEnv.HOME, await realpath(physical));
    assert.equal(cliEnv.USERPROFILE, cliEnv.HOME);
    assert.equal(cliEnv.RSRS_DATA_DIR, await realpath(profile));
    assert.equal(cliEnv.RSRS_M3_DIR, env.RSRS_M3_DIR);
    assert.equal(cliEnv.RSRS_NO_AUTOSYNC, "1");
    assert.equal(cliEnv.TEMP, alias);
    assert.equal(cliEnv.RSRS_BIN_DIR, join(alias, "bin"));
    assert.deepEqual(env, before);
    assert.equal(runtime.root, alias);
    const unrelated = join(root, "unrelated directory");
    await mkdir(unrelated);
    const inner = join(profile, "inner junction");
    await symlink(unrelated, inner, "junction");
    try {
      await assert.rejects(canonicalMcpEnv(runtime), /regular files and directories/);
    } finally {
      await rmdir(inner);
    }
    await rmdir(alias);
    await symlink(unrelated, alias, "junction");
    await assert.rejects(canonicalMcpEnv(runtime), /workspace resolved outside/);
  } finally {
    await rmdir(alias);
  }
  await assert.rejects(lstat(alias), {code: "ENOENT"});
  assert.deepEqual(await readFile(join(physical, "profile", "payload.jsonl")), bytes);
});
