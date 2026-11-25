// Native integration smoke for an explicitly supplied, hash-pinned Runtime candidate.
// Node 20+. No keyring, installer, service manager, model, or actual user data.
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {createReadStream, existsSync, lstatSync, mkdirSync,
  mkdtempSync, readFileSync, realpathSync, rmSync,
  writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep, win32} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {assertDrained, assertProtocol, assertSamePath, digest, normalizedPath, syntheticSession}
  from './runtime-release-smoke-helpers.mjs';
import {PrivacyGateError, assertTargets} from './discovery-gate.mjs';


let stage = 'hosted-runner guard';
const STARTUP_MAX_STDERR = 4096;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sameInstance = ['pid', 'instance_id', 'process_start_id', 'image_sha256'];
async function binaryDigest(file) {
  const hash = createHash('sha256');
  for await (const update of createReadStream(file)) hash.update(update);
  return hash.digest('hex');
}

function canonicalPath(path, stage = 'fixture path') {
  if (process.platform !== 'win32') return realpathSync(path);
  try {
    // Rust emits verbatim drive paths in Runtime receipts. In Node 22, the
    // JavaScript walker can lstat a drive-relative root; use the OS resolver.
    return normalizedPath(realpathSync.native(normalizedPath(path)));
  } catch (error) {
    throw new Error('Windows path canonicalization failed at ' + stage + ' (' + error.code + ')');
  }
}
function below(parent, child) {
  const part = relative(parent, child);
  return !!part && !isAbsolute(part) && !part.split(sep).includes('..');
}

function fileJson(path, maxBytes = 64 * 1024) {
  const info = lstatSync(path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= maxBytes,
    'unsafe synthetic receipt');
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('invalid synthetic receipt JSON'); }
}

function secureWindowsFixtureDirectory(root) {
  if (process.platform !== 'win32') return;
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  assert.ok(systemRoot && isAbsolute(systemRoot), 'Windows system root unavailable');
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User',
    '$acl = New-Object Security.AccessControl.DirectorySecurity',
    '$acl.SetOwner($owner)',
    '$acl.SetAccessRuleProtection($true, $false)',
    '$rule = [Security.AccessControl.FileSystemAccessRule]::new($owner, "FullControl",'
      + ' "ContainerInherit,ObjectInherit", "None", "Allow")',
    '$acl.AddAccessRule($rule)',
    'Set-Acl -LiteralPath $env:RESPIRE_SYNTHETIC_ACL_DIR -AclObject $acl',
  ].join('; ');
  // Windows mkdir ignores POSIX mode. This directory was just created by the
  // harness; do not weaken Runtime's enforcement to accommodate the temp root.
  execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: {SystemRoot: systemRoot, WINDIR: systemRoot, RESPIRE_SYNTHETIC_ACL_DIR: root},
    stdio: 'ignore', windowsHide: true, timeout: 60000,
  });
}

function isolatedEnvironment(root, data, models, binary) {
  const paths = {};
  for (const name of ['home', 'config', 'local', 'roam', 'cache', 'state', 'temp']) {
    paths[name] = join(root, name);
    mkdirSync(paths[name], {mode: 0o700});
  }
  const os = {};
  for (const name of ['SystemRoot', 'WINDIR', 'SYSTEMDRIVE', 'ComSpec']) {
    if (process.platform === 'win32' && process.env[name]) os[name] = process.env[name];
  }
  const systemPath = process.platform === 'win32'
    ? [dirname(binary), join(os.SystemRoot ?? os.WINDIR ?? 'C:\\Windows', 'System32')].join(delimiter)
    : '/usr/bin:/bin';
  // Do not inherit real user paths, credential settings, sync config, proxies,
  // keyring/session bus variables, developer/test mode flags or shell argv.
  return {...os, PATH: systemPath, HOME: paths.home, USERPROFILE: paths.home,
    APPDATA: paths.roam, LOCALAPPDATA: paths.local, TEMP: paths.temp, TMP: paths.temp,
    TMPDIR: paths.temp, XDG_CONFIG_HOME: paths.config, XDG_DATA_HOME: data,
    XDG_CACHE_HOME: paths.cache, XDG_STATE_HOME: paths.state,
    RSRS_DATA_DIR: data, RSRS_BIN_DIR: dirname(binary), RSRS_M3_DIR: models,
    RSRS_NO_AUTOSYNC: '1', RSRS_CLIENT_ONLY: '0', RSRS_NO_AUTOSTART: '0'};
}

async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen({host: '127.0.0.1', port: 0, exclusive: true}, ok);
  });
  const {port} = server.address();
  await new Promise((ok, fail) => server.close(error => error ? fail(error) : ok()));
  return port;
}

async function poll(label, check, childState, time = 90000) {
  const deadline = Date.now() + time;
  while (Date.now() < deadline) {
    assert.ok(!childState(), 'Runtime exited before ' + label);
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error('Timed out waiting for ' + label);
}

function responseAt(endpoint) {
  return (path, {method = 'GET', body, headers = {}, timeout = 6000} = {}) =>
    fetch(endpoint + path, {method, redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: body === undefined ? headers : {'Content-Type': 'application/json', ...headers},
      body: body === undefined ? undefined : JSON.stringify(body)});
}

async function requireStatus(response, status, label) {
  assert.equal(response.status, status, label);
  if (status === 204) {
    assert.equal(await response.text(), '', '204 unexpectedly carried a body');
    return null;
  }
  try { return await response.json(); } catch { throw new Error('invalid JSON response: ' + label); }
}

function startupHint(error, outcome, sample) {
  const spawnCodes = new Set(['ENOENT','EACCES','EPERM','EINVAL','UNKNOWN']);
  if (error) return spawnCodes.has(error.code) ? 'spawn-' + error.code.toLowerCase() : 'spawn-other';
  if (outcome?.code != null) {
    const native = new Map([[0xc0000135,'windows-loader-dll-not-found'],[0xc0000139,'windows-loader-entrypoint-missing'],
      [0xc000007b,'windows-loader-image-format'],[0xc0000142,'windows-loader-init-failed'],
      [0xc0000005,'windows-native-access-violation']]);
    const code = native.get(outcome.code >>> 0);
    if (code) return code;
  }
  const rules = [
    [/failed to bind local runtime at/i,'runtime-listener-bind-failed'],
    [/endpoint changed before publication|endpoint instance missing|invalid endpoint instance/i,'runtime-endpoint-publish-failed'],
    [/access is denied|permission denied|os error 5\b/i,'runtime-access-denied'],
    [/thread [^\n]{0,80} panicked at/i,'runtime-panic'],
    [/rsrs-runtime:/i,'runtime-returned-error'],
  ];
  const stderr = sample.toString('utf8');
  for (const [pattern, code] of rules) if (pattern.test(stderr)) return code;
  if (outcome?.signal) return 'runtime-signalled';
  if (outcome?.code === 0) return 'runtime-exited-zero';
  if (outcome?.code === 2) return 'runtime-exited-2';
  return outcome ? 'runtime-exited-other' : 'no-classified-stderr';
}

function startupFailure(rule) {
  // Always called with a fixed classification, never an input or raw message.
  const error = new Error('native startup verification failed');
  error.startupRule = rule;
  throw error;
}

function receiptBound(info, child, endpoint, binary, sha, data) {
  const {pid, url, image_path: image, image_sha256: actual, installation_root: root} = info;
  if (pid !== child.pid) startupFailure('receipt-pid-mismatch');
  if (url !== endpoint) startupFailure('receipt-url-mismatch');
  if (actual !== sha) startupFailure('receipt-digest-mismatch');
  let canonicalImage, canonicalRoot;
  try { canonicalImage = canonicalPath(image, 'Runtime image receipt'); }
  catch { startupFailure('receipt-image-path-unresolved'); }
  try { canonicalRoot = canonicalPath(root, 'installation root receipt'); }
  catch { startupFailure('receipt-root-path-unresolved'); }
  if (canonicalImage !== binary) startupFailure('receipt-image-path-mismatch');
  if (canonicalRoot !== data) startupFailure('receipt-root-path-mismatch');
  if (typeof info.instance_id !== 'string' || !uuid.test(info.instance_id)) startupFailure('receipt-instance-invalid');
  if (typeof info.process_start_id !== 'string' || !info.process_start_id) startupFailure('receipt-birth-missing');
}

function verifyOwnedFixture(root, codex, sessions, file) {
  for (const [path, isFile] of [[codex,false],[sessions,false],[file,true]]) {
    const lexical = normalizedPath(resolve(path));
    const actual = canonicalPath(lexical, 'owned fixture component');
    const info = lstatSync(lexical);
    assert.ok(below(root, actual) && actual.toLowerCase() === lexical.toLowerCase() && !info.isSymbolicLink()
      && (isFile ? info.isFile() && info.nlink === 1 : info.isDirectory()), 'unsafe owned fixture component');
  }
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  const exe = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const check = ["$ErrorActionPreference='Stop'",
    'foreach ($p in @($env:RSRS_OWNED_CODEX,$env:RSRS_OWNED_SESSIONS,$env:RSRS_OWNED_ROLLOUT)) {',
    'if ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { exit 2 }','}'].join(';');
  execFileSync(exe, ['-NoProfile','-NonInteractive','-Command',check], {env:{SystemRoot:systemRoot,WINDIR:systemRoot,
    RSRS_OWNED_CODEX:codex,RSRS_OWNED_SESSIONS:sessions,RSRS_OWNED_ROLLOUT:file},
    stdio:'ignore', windowsHide:true, timeout:60000});
}

async function smoke(binary, sha) {
  stage = 'protected scratch setup';
  const tempBase = canonicalPath(resolve(process.env.RUNNER_TEMP));
  const root = canonicalPath(mkdtempSync(join(tempBase, 'respire-session-preview-owned-')));
  assert.ok(below(tempBase, root) && basename(root).startsWith('respire-session-preview-owned-'), 'invalid temp root');
  let child, ended, childFailure, closed, sessionBytes;
  const stderrSample = Buffer.alloc(STARTUP_MAX_STDERR);
  let stderrSize = 0, startupVerified = false;
  try {
    const data = join(root, 'data'), models = join(root, 'empty-models'), runtimeDir = join(data, 'runtime');
    secureWindowsFixtureDirectory(root);
    mkdirSync(runtimeDir, {recursive: true, mode: 0o700});
    mkdirSync(models, {mode: 0o700});
    const fixture = syntheticSession(), legacyHostToken = randomBytes(32).toString('hex');
    sessionBytes = Buffer.from(JSON.stringify(fixture.session));
    writeFileSync(join(data, 'session.json'), sessionBytes, {flag: 'wx', mode: 0o600});
    writeFileSync(join(runtimeDir, 'token'), legacyHostToken, {flag: 'wx', mode: 0o600});
    const port = await freeLoopbackPort(), endpoint = 'http://127.0.0.1:' + port;
    const call = responseAt(endpoint);
    const sandboxEnv = isolatedEnvironment(root, data, models, binary);
    const codex=join(root,'isolated-codex');
    assert.ok(below(root,codex));
    sandboxEnv.CODEX_HOME=codex;
    stage = 'spawn native Runtime';
    child = spawn(binary, ['serve', '--host', '127.0.0.1', '--port', String(port), '--data-dir', data],
      {cwd: root, env: sandboxEnv, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true});
    closed = new Promise(ok => child.once('close', (code, signal) => {
      ended = {code, signal}; ok(ended);
    }));
    child.once('error', error => { childFailure = error; });
    child.stderr?.on('data', chunk => {
      // Always drain the pipe. Retain at most the first 4 KiB of locked startup.
      if (startupVerified || stderrSize === stderrSample.length) return;
      stderrSize += chunk.copy(stderrSample, stderrSize, 0, stderrSample.length - stderrSize);
    });
    child.stderr?.on('error', () => {});
    await new Promise((ok, fail) => {
      child.once('spawn', ok);
      child.once('error', fail);
    });
    // Exit can precede close. Retain only native numeric status, never stderr as text.
    child.once('exit', (code, signal) => { ended = {code, signal}; });
    const childState = () => ended || childFailure;
    const endpointFile = join(runtimeDir, 'endpoint.json');
    // Verify our fresh, child-written endpoint before sending any HTTP at all.
    stage = 'wait for native endpoint receipt';
    const endpointInfo = await poll('isolated endpoint receipt', () => {
      if (!existsSync(endpointFile)) return null;
      try { return fileJson(endpointFile); } catch { startupFailure('endpoint-receipt-unreadable'); }
    }, childState);
    stage = 'verify native endpoint receipt identity';
    receiptBound(endpointInfo, child, endpoint, binary, sha, data);
    const health = () => call('/api/health').then(response => requireStatus(response, 200, 'legacy health'));
    stage = 'wait for scoped locked health';
    const locked = await poll('synthetic locked Runtime', async () => {
      let info;
      try { info = await health(); } catch (error) {
        if (error instanceof TypeError || error.name === 'TimeoutError') return null;
        throw error;
      }
      receiptBound(info, child, endpoint, binary, sha, data);
      try { assertProtocol(info); } catch { startupFailure('health-protocol-mismatch'); }
      assert.equal(info.store_ready, false, 'Runtime opened store without synthetic unlock');
      return info.startup_complete && info.credential_state === 'required' ? info : null;
    }, childState);
    stage = 'verify locked profile receipt';
    if (locked.state !== 'locked') startupFailure('health-not-locked');
    let lockedRoot;
    try { lockedRoot = canonicalPath(locked.data_dir, 'locked profile receipt'); }
    catch { startupFailure('health-profile-path-unresolved'); }
    if (lockedRoot !== data) startupFailure('health-profile-path-mismatch');
    startupVerified = true;
    stderrSample.fill(0);
    stderrSize = 0;
    // Synthetic v4 release unlock; never use any actual login material.
    stage = 'isolated synthetic unlock';
    const unlocked = await call('/api/runtime/unlock', {method: 'POST', timeout: 15000,
      headers: {Authorization: 'Bearer ' + legacyHostToken},
      body: {schema_version: 1, profile: data, session_sha256: digest(sessionBytes),
        instance_id: locked.instance_id, generation: locked.generation,
        super_password: fixture.superPassword, login_password: null}});
    const unlockBody = await requireStatus(unlocked, 200, 'synthetic host unlock');
    assert.equal(unlockBody.store_ready, true);
    const ready = await health();
    assert.equal(ready.state, 'ready');
    for (const key of sameInstance) assert.equal(ready[key], locked[key], 'legacy identity changed');
    let viewFailures = 0;
    const locale = process.env.CARD018_BROWSER_LOCALE;
    assert.ok(locale === 'en' || locale === 'zh', 'fixture requires explicit locale');
    try {
      const scope = Object.fromEntries(['account_id','instance_id','generation'].map(k=>[k,ready[k]]));
      assert.ok(scope.account_id && scope.instance_id && scope.generation>0,'verified Runtime scope is incomplete');
      const command = async (verb, params=[]) => {
        const id = 'session-preview-' + verb + '-' + randomBytes(12).toString('hex');
        const reply = await requireStatus(await call('/api/rpc',{method:'POST', timeout:30000,
          body:{v:1,id,method:'cli.exec',args:['--json',verb,...params],scope,operation_id:id,idempotency_key:id}}),200,'real scoped '+verb);
        assert.ok(reply.v === 1 && reply.id === id && reply.operation_id === id && reply.pid === child.pid, 'legacy RPC receipt did not match exact instance/request');
        for (const key of Object.keys(scope)) assert.equal(reply.scope?.[key],scope[key], 'legacy scope changed');
        if (reply.ok !== true || reply.exit !== 0) {
          const why = String(reply.code || reply.error || reply.envelope?.errors?.[0] || 'no code').split('\n')[0].slice(0,130);
          throw new Error('real scoped '+verb+' failed: '+why);
        }
        return reply.envelope;
      };
      const commandStatus = () => command('status');
      const revision = async () => JSON.stringify((await command('memory-revision')).summary);
      const targets = () => command('extract', ['--targets']);
      stage = 'empty provider discovery gate';
      assertTargets(await targets()); // Only checks paths, never opens histories.
      assert.ok(!existsSync(codex), 'fixture must not exist before privacy preflight');
      const before = await commandStatus(), beforeRevision = await revision();
      const cursor = join(data, 'extract-state.json');
      assert.ok(before.summary?.local_alive === 0 && !existsSync(cursor), 'fixture store not empty');
      stage = 'owned synthetic rollout setup';
      const sessions = join(codex, 'sessions');
      mkdirSync(codex, {mode: 0o700});
      mkdirSync(sessions, {mode: 0o700});
      const stamp = new Date().toISOString(), id = '11111111-aaaa-4111-8888-111111111111';
      const witness = 'Synthetic amber compass notebook requires two reference points';
      const file = join(sessions, 'rollout-card018.jsonl');
      const contents = [{timestamp:stamp,type:'session_meta',payload:{id,cwd:root,model_provider:'fixture',model:'synthetic'}},
        {timestamp:stamp,type:'user',content:witness}].map(x => JSON.stringify(x)).join('\n');
      writeFileSync(file, contents, {flag:'wx',mode:0o600});
      verifyOwnedFixture(root, codex, sessions, file);
      stage = 'single provider discovery gate';
      assertTargets(await targets(), codex);
      const groups = {id,witness,codex,file,cwd:root,scope};
      {
        const env = {...sandboxEnv, CARD018_LOCALE: locale, CARD018_RUNTIME_URL: endpoint,
          CARD018_RUNTIME_DATA: data, CARD018_RUNTIME_PID: String(child.pid),
          CARD018_RUNTIME_INSTANCE: ready.instance_id, CARD018_PREVIEW_ONLY: '1', CARD018_EXPECTED_IMPORT: JSON.stringify(groups),
          CARD018_NODE: process.execPath, CARD018_SCRATCH: dirname(fileURLToPath(import.meta.url)),
          CARD018_CHROMIUM: process.env.CARD018_CHROMIUM,
          CARD018_PLAYWRIGHT_CORE: process.env.CARD018_PLAYWRIGHT_CORE};
        const exe = join(env.CARD018_SCRATCH, 'import-real.test.exe');
        stage = 'read-only real Wails browser probe';
        const probe = spawn(exe, ['-test.v','-test.run=^TestCard018ActualDesktopImportBoundary$','-test.timeout=35s'],
          {cwd:root,env,windowsHide:true,stdio:['ignore','inherit','inherit']});
        const status = await new Promise((ok,fail)=>{probe.once('error',fail);probe.once('close',(code,signal)=>ok({code,signal}));});
        stage = 'read-only postconditions';
        assertTargets(await targets(), codex);
        verifyOwnedFixture(root, codex, sessions, file);
        assert.ok((await commandStatus()).summary?.local_alive === 0 && await revision() === beforeRevision
          && !existsSync(cursor) && digest(readFileSync(file)) === digest(contents), 'read-only postcondition failed');
        if (status.code !== 0 || status.signal) viewFailures++;
      }
    } catch (error) {
      console.error(error instanceof PrivacyGateError ? 'FAIL: discovery privacy gate' : 'FAIL: '+stage);
      viewFailures++;
    }

    stage = 'scoped Runtime drain';
    const identity = Object.fromEntries(['installation_id', 'instance_id', 'account_id', 'generation']
      .map(key => [key, ready[key]]));
    const response = await call('/api/runtime/stop', {method: 'POST', body: identity,
      headers: {'X-Respire-Lifecycle': 'coordinator-v1'}});
    const accepted = await requireStatus(response, 200, 'scoped standalone stop');
    assert.ok(accepted.ok === true && accepted.state === 'accepted', 'scoped stop not accepted');
    const result = await Promise.race([closed, delay(35000, null, {ref: false})]);
    assert.ok(result?.code === 0 && result.signal === null, 'Runtime did not cleanly exit');
    assertDrained(fileJson(join(runtimeDir, 'stop-' + ready.instance_id + '.json'), 1 << 20),
      ready, accepted.operation_id);
    assert.ok(!existsSync(join(runtimeDir, '.owner-credentials-' + ready.instance_id, 'secret')),
      'stop did not remove the retired owner credential');
    console.log('Exact owned Runtime cleanly drained.');
    assert.equal(viewFailures, 0, 'isolated Session Import preview did not pass');
  } catch (error) {
    if (!startupVerified && child) {
      if (ended) await Promise.race([closed, delay(500, null, {ref:false})]);
      const rule = error.startupRule;
      const hint = startupHint(childFailure, ended, stderrSample.subarray(0, stderrSize));
      console.error('Runtime startup classification: ' + (rule ? rule + '; ' : '') + hint);
    }
    throw error;
  } finally {
    stderrSample.fill(0);
    sessionBytes?.fill(0);
    if (child && !ended && !childFailure) {
      child.kill();
      await Promise.race([closed, delay(2500, null, {ref: false})]);
      if (!ended) {
        child.kill('SIGKILL');
        await Promise.race([closed, delay(2500, null, {ref: false})]);
      }
    }
    if (!child || ended || childFailure) {
      const onDisk = canonicalPath(root);
      assert.ok(below(tempBase, onDisk) && basename(onDisk).startsWith('respire-session-preview-owned-'),
        'synthetic cleanup target changed');
      rmSync(onDisk, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
      console.log('Owned synthetic Runtime profile removed.');
    }
  }
}

async function main(args) {
  if (process.platform !== 'win32' || process.arch !== 'x64' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.env.CARD018_HOSTED_PREVIEW_ONLY !== '1'
    || !process.env.RUNNER_TEMP) throw new Error('hosted-only guard: no process was started');
  if (args.length !== 4 || args[0] !== '--runtime' || args[2] !== '--sha256' || !/^[0-9a-f]{64}$/.test(args[3])) {
    throw new Error('Usage: node run-import-real.mjs --runtime <native-build-binary> --sha256 <expected-sha256>');
  }
  stage = 'pinned artifact verification';
  const supplied = resolve(args[1]);
  assert.ok(lstatSync(supplied).isFile() && !lstatSync(supplied).isSymbolicLink(), 'candidate must be a regular file');
  const binary = canonicalPath(supplied);
  assert.equal(await binaryDigest(binary), args[3], 'candidate Runtime digest mismatch');
  await smoke(binary, args[3]);
}

main(process.argv.slice(2)).catch(error => {
  // No response, header, fixture environment, key or child output is printed.
  console.error('FAIL: Session Import stage: '+stage);
  process.exitCode = 1;
});
