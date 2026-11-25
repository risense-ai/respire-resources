import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {createCipheriv, createHash, hkdfSync, randomBytes} from "node:crypto";
import {mkdir, readdir, readFile, writeFile} from "node:fs/promises";
import {isAbsolute, join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {promisify} from "node:util";

// Mirrors monorepo apps/runtime/scripts/smoke-owner-handshake.mjs and
// runtime-release-smoke-helpers.mjs. All keys and profile bytes are disposable.
export async function prepareModernReady(root, env, token, {deviceLocal = false} = {}) {
  assert(typeof deviceLocal === "boolean", "Invalid synthetic profile mode");
  assert(!deviceLocal || (!env.RSRS_ADDR && !env.RSRS_TOKEN), "Device-local fixture cannot use a remote login");
  const profile = env.RSRS_DATA_DIR;
  if ((await readdir(profile)).length || (await readdir(root)).includes("empty-models")) {
    throw Object.assign(new Error("Synthetic ready fixture already exists; refusing setup before ACL changes"),
      {code: "EEXIST"});
  }
  if (process.platform === "win32") {
    const systemRoot = env.SystemRoot ?? env.WINDIR;
    assert(systemRoot && isAbsolute(systemRoot), "Synthetic fixture requires Windows system root");
    const script = [
      "$ErrorActionPreference = 'Stop'",
      '$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User',
      '$acl = New-Object Security.AccessControl.DirectorySecurity',
      '$acl.SetOwner($owner)',
      '$acl.SetAccessRuleProtection($true, $false)',
      '$rule = [Security.AccessControl.FileSystemAccessRule]::new($owner, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")',
      '$acl.AddAccessRule($rule)',
      'Set-Acl -LiteralPath $env:RESPIRE_SYNTHETIC_ACL_DIR -AclObject $acl'
    ].join("; ");
    await promisify(execFile)(join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", script], {
        env: {SystemRoot: systemRoot, WINDIR: systemRoot, RESPIRE_SYNTHETIC_ACL_DIR: root},
        windowsHide: true, timeout: 60_000
      });
  }
  const entropy = randomBytes(18), salt = randomBytes(16), nonce = randomBytes(12);
  const superPassword = "A3-" + entropy.toString("hex");
  const kek = hkdfSync("sha256", entropy, salt, Buffer.from("onememory:kek:v4"), 32);
  const cipher = createCipheriv("aes-256-gcm", kek, nonce);
  const wrapped = Buffer.concat([cipher.update(randomBytes(32)), cipher.final(), cipher.getAuthTag()]);
  const session = Buffer.from(JSON.stringify({user: "runtime-smoke", ...(!deviceLocal && {addr: "https://smoke.invalid"}),
    vault_version: 4, kdf_salt: salt.toString("hex"), urk_nonce: nonce.toString("hex"), wrapped_urk: wrapped.toString("hex")}));
  await mkdir(join(profile, "runtime"), {recursive: true, mode: 0o700});
  await writeFile(join(profile, "session.json"), session, {flag: "wx", mode: 0o600});
  await writeFile(join(profile, "runtime", "token"), token, {flag: "wx", mode: 0o600});
  env.RSRS_M3_DIR = join(root, "empty-models");
  await mkdir(env.RSRS_M3_DIR, {mode: 0o700});
  env.RSRS_NO_AUTOSYNC = "1";
  return {superPassword, sessionSha256: createHash("sha256").update(session).digest("hex")};
}

export async function unlockModernReady(base, pid, profile, fixture, token, assertRunning) {
  const deadline = Date.now() + 30_000;
  async function poll(check) {
    while (Date.now() < deadline) {
      assertRunning();
      const result = await check();
      if (result) return result;
      await delay(50);
    }
    throw new Error("Timed out waiting for synthetic locked Runtime");
  }
  const endpoint = await poll(async () => {
    try {
      return JSON.parse(await readFile(join(profile, "runtime", "endpoint.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  });
  assert(endpoint.pid === pid && endpoint.url === base &&
    typeof endpoint.instance_id === "string" && endpoint.instance_id.trim(), "Synthetic endpoint identity mismatch");
  async function call(path, options = {}) {
    const response = await fetch(base + path, {redirect: "error", signal: AbortSignal.timeout(15_000),
      ...options, headers: {connection: "close", ...options.headers}});
    assert(response.status === 200, "Synthetic setup HTTP request failed at " + path);
    return response.json();
  }
  const locked = await poll(async () => {
    const info = await call("/api/health");
    assert(info.pid === pid && info.instance_id === endpoint.instance_id, "Synthetic locked identity mismatch");
    if (!info.startup_complete) return;
    assert(info.state === "locked" && info.store_ready === false && info.credential_state === "required",
      "Synthetic Runtime must be locked before unlock");
    assert(Number.isSafeInteger(info.generation) && info.generation > 0, "Missing synthetic unlock generation");
    return info;
  });
  const modern = await call("/v1/health");
  assert(modern.status === "degraded" && modern.instance_id === locked.instance_id,
    "Synthetic modern health must be degraded before unlock");
  const unlocked = await call("/api/runtime/unlock", {method: "POST",
    headers: {authorization: "Bearer " + token, "content-type": "application/json"},
    body: JSON.stringify({schema_version: 1, profile, session_sha256: fixture.sessionSha256,
      instance_id: locked.instance_id, generation: locked.generation,
      super_password: fixture.superPassword, login_password: null})});
  assert(unlocked.store_ready === true, "Synthetic host unlock did not open the store");
  return locked.instance_id;
}
