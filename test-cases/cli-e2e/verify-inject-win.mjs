import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, writeFileSync
} from "node:fs";
import {dirname, join} from "node:path";
import {assertBinary, withCleanup} from "../targets.mjs";
import {cliTarget} from "./command.mjs";

const [tempPath, cli, expected] = process.argv.slice(2);
assert.equal(process.platform, "win32", "This probe attests Windows only");
assert(tempPath && /^[a-f0-9]{64}$/.test(expected), "Supply an owned temp directory, compiled CLI and its lowercase SHA-256");
await assertBinary(cli, "standalone CLI");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(hash(readFileSync(cli)), expected);

const temp = realpathSync(tempPath);
const root = realpathSync(mkdtempSync(join(temp, "synthetic-codex-")));
await withCleanup(async () => {
  const home = join(root, "home");
  const project = join(root, "synthetic checkout");
  const data = join(root, "local-runtime-data");
  const env = {};
  for (const key of ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "SYSTEMDRIVE"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"), XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"), XDG_CACHE_HOME: join(home, ".cache"),
    CODEX_HOME: join(home, ".codex"), TEMP: join(root, "tmp"), TMP: join(root, "tmp"),
    RSRS_NO_AUTOSYNC: "1", RSRS_NO_AUTOSTART: "1", RSRS_DATA_DIR: data
  });
  for (const folder of [home, project, data, env.APPDATA, env.LOCALAPPDATA, env.CODEX_HOME, env.TEMP]) {
    mkdirSync(folder, {recursive: true});
  }
  const config = join(env.CODEX_HOME, "AGENTS.md");
  const original = Buffer.from("# Synthetic Codex fixture\n\nKeep this preexisting user text.\n");
  const projectControl = join(project, "AGENTS.md");
  writeFileSync(config, original, {flag: "wx"});
  writeFileSync(projectControl, "synthetic project remains untouched\n", {flag: "wx"});
  const files = () => readdirSync(root, {recursive: true}).sort();
  const before = files();
  const target = cliTarget(cli, {target: {}, env, root: project});
  const invoke = async (...args) => {
    const {exit, data} = await target.cli({args: ["--json", "inject", "--id", "codex", ...args], format: "json"});
    assert.equal(exit, 0);
    assert.equal(data.command, "inject");
    assert.equal(data.status, "ok");
    assert.deepEqual(data.errors, []);
    return data.summary.changed;
  };

  assert.equal(await invoke(), true);
  const written = readFileSync(config);
  const document = written.toString("utf8");
  assert(document.startsWith(original.toString("utf8")));
  assert.equal((document.match(/<!-- respire:begin -->/g) ?? []).length, 1);
  assert.equal((document.match(/<!-- respire:end -->/g) ?? []).length, 1);
  assert(document.includes("rsrs ") && document.includes("recall") && document.includes("--client-only"));
  assert.equal(await invoke(), false);
  assert.deepEqual(readFileSync(config), written);
  assert.equal(await invoke("--remove"), true);
  const removed = readFileSync(config);
  // Previously shipped CLI may leave two trailing LF bytes. Report this
  // separately; do not treat it as a byte-exact undo.
  const byteExact = removed.equals(original);
  assert(byteExact || removed.equals(Buffer.concat([original, Buffer.from("\n\n")])));
  assert.equal(await invoke("--remove"), false);
  assert.deepEqual(readFileSync(config), removed);
  assert.equal(readFileSync(projectControl, "utf8"), "synthetic project remains untouched\n");
  assert(!existsSync(join(data, "runtime", "endpoint.json")));
  assert.deepEqual(files(), before);
  console.log(JSON.stringify({result: "Codex injection scope passed", cli_sha256: expected,
    remove_byte_exact: byteExact, trailing_bytes: removed.length - original.length}));
}, async () => {
  assert.equal(dirname(root), temp, "Refusing cleanup outside the owned temp directory");
  assert.equal(realpathSync(root), root, "Owned temp directory was redirected");
  rmSync(root, {recursive: true});
});
