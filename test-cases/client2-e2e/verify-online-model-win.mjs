/**
 * T05-05 native Windows model install/uninstall acceptance adapter.
 * Run offline with an explicitly reviewed, built Runtime and pinned Go source.
 * Missing prerequisites/skip/nonzero are nonpassing, never mock evidence.
 */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {lstat, mkdtemp, mkdir, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, isAbsolute, join, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";

const testName = "TestRealRuntimeOwnedModelUninstallWindows";
const pins = [
  [ // BGE-small
    ["model_quantized.onnx", 24_010_842, "15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc"],
    ["tokenizer.json", 439_125, "48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26"],
  ],
  [ // BGE-M3
    ["model_quantized.onnx", 569_694_530, "0826f8c1ab9edf1801db86c61919d4d108e8bfc0b809ec823ad366882ff0b77d"],
    ["tokenizer.json", 17_082_821, "6710678b12670bc442b99edc952c4d996ae309a7020c1fa0096dd245c2faf790"],
  ],
];

export function requireExecutedTest(stdout) {
  const events = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  const evidence = events.filter(event => event.Test === testName);
  assert(evidence.filter(event => event.Action === "run").length === 1 &&
    evidence.filter(event => event.Action === "pass").length === 1 &&
    !evidence.some(event => event.Action === "fail" || event.Action === "skip"),
  "Product test did not execute and pass exactly once");
  assert(events.some(event => event.Action === "pass" && event.Package === "respire-client2/internal/host" && !event.Test),
    "Product package did not pass");
}

async function checkedPath(path, directory) {
  assert(isAbsolute(path), "Prerequisite path must be absolute");
  const info = await lstat(path);
  assert(!info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile()), "Prerequisite path has wrong type");
  const canonical = await realpath(path);
  assert.equal(canonical.toLowerCase(), resolve(path).toLowerCase(), "Prerequisite redirects elsewhere");
  return canonical;
}

async function checkBytes(path, length, expected) {
  const file = await checkedPath(path, false);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    assert(bytes <= length, "Input exceeds expected length");
    hash.update(chunk);
  }
  assert.equal(bytes, length, "Input size differs from pin");
  assert.equal(hash.digest("hex"), expected, "Input digest differs from pin");
}

function run(exe, args, cwd, env, timeout = 180_000) {
  const result = spawnSync(exe, args, {cwd, env, timeout, windowsHide: true, encoding: "utf8", maxBuffer: 8 << 20});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${exe} failed (${result.status ?? result.signal}); no product evidence`);
  }
  return result.stdout;
}

function cleanEnv(temp) {
  const allowed = new Set(["PATH", "SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "PATHEXT", "GOMODCACHE", "GOCACHE", "GOROOT"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
  assert(env.GOMODCACHE && isAbsolute(env.GOMODCACHE), "Set GOMODCACHE to a preloaded offline Go module cache");
  return {...env, HOME: temp, USERPROFILE: temp, APPDATA: temp, LOCALAPPDATA: temp, TEMP: temp, TMP: temp,
    GOENV: "off", GOTOOLCHAIN: "local", GOPROXY: "off", GOSUMDB: "off", GOWORK: "off", GIT_CONFIG_NOSYSTEM: "1"};
}

async function main(args) {
  assert.equal(process.platform, "win32", "T05-05 product adapter is Windows only");
  assert(process.env.CARD018_DISPOSABLE_MODEL_FIXTURE === "1", "Requires an approved disposable Windows fixture environment");
  assert.equal(args.length, 7, "Usage: node verify-online-model-win.mjs <repo> <reviewed-commit> <runtime> <sha256> <version> <small-fixtures> <m3-fixtures>");
  const [repo, commit, runtime, digest, version, small, m3] = args;
  assert(/^[0-9a-f]{40}$/.test(commit) && /^[0-9a-f]{64}$/.test(digest), "Expected full reviewed source commit and Runtime digest");
  assert(/^\d+\.\d+\.\d+(?:-dev\.\d+)?$/.test(version), "Expected an exact supported Runtime version");
  const checkout = await checkedPath(repo, true);
  const binary = await checkedPath(runtime, false);
  const binarySize = (await lstat(binary)).size;
  assert(binarySize > 0 && binarySize <= 512 << 20, "Runtime binary exceeds safe bound");
  await checkBytes(binary, binarySize, digest);
  for (const [index, value] of [small, m3].entries()) {
    const directory = await checkedPath(value, true);
    for (const [name, size, sha256] of pins[index]) await checkBytes(join(directory, name), size, sha256);
  }

  const tmp = await realpath(tmpdir());
  const scratch = await mkdtemp(join(tmp, "respire T05-05 online models "));
  try {
    const env = cleanEnv(scratch);
    const archive = join(scratch, "source.tar");
    assert.equal(run("git", ["rev-parse", "--verify", commit + "^{commit}"], checkout, env).trim(), commit,
      "Local source commit does not match exact pin");
    run("git", ["archive", "--format=tar", "--output=" + archive, commit, "apps/client2", "contracts", "packages/runtime-sdk-go"], checkout, env);
    const source = join(scratch, "source");
    await mkdir(source);
    run("tar", ["-xf", archive, "-C", source], scratch, env);
    run("go", ["generate", "."], join(source, "packages", "runtime-sdk-go"), env);
    const output = run("go", ["test", "-mod=readonly", "-json", "-count=1", "-timeout=8m", "-run", "^" + testName + "$", "./internal/host"],
      join(source, "apps", "client2"), {...env, RESPIRE_TEST_REAL_RUNTIME: binary, RESPIRE_TEST_REAL_RUNTIME_VERSION: version,
        RESPIRE_TEST_REAL_MODEL_FIXTURE: small, RESPIRE_TEST_REAL_M3_FIXTURE: m3}, 500_000);
    requireExecutedTest(output);
    console.log(JSON.stringify({scenario: "T05-05/online-models-win", source: commit, runtime_sha256: digest, version, native_test: testName, result: "pass"}));
  } finally {
    assert.equal(dirname(scratch), tmp, "Refusing cleanup outside the owned test parent");
    assert.equal(await realpath(scratch), scratch, "Refusing cleanup of redirected scratch");
    await rm(scratch, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
