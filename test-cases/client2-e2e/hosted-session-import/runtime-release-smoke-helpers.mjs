import assert from 'node:assert/strict';
import {createCipheriv, createHash, hkdfSync, randomBytes} from 'node:crypto';
import {win32} from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function syntheticSession() {
  // The smoke host owns this disposable v4 key; Runtime receives it only after locked startup.
  const entropy = randomBytes(18), salt = randomBytes(16), nonce = randomBytes(12);
  const superPassword = `A3-${entropy.toString('hex')}`;
  const kek = hkdfSync('sha256', entropy, salt, Buffer.from('onememory:kek:v4'), 32);
  const cipher = createCipheriv('aes-256-gcm', kek, nonce);
  const wrapped = Buffer.concat([cipher.update(randomBytes(32)), cipher.final(), cipher.getAuthTag()]);
  return {superPassword, session: {user: 'runtime-smoke', addr: 'https://smoke.invalid', vault_version: 4,
    kdf_salt: salt.toString('hex'), urk_nonce: nonce.toString('hex'), wrapped_urk: wrapped.toString('hex')}};
}
function normalizedPath(value, platform = process.platform) {
  if (platform !== 'win32') return value;
  // Node may retain the extended prefix even after resolving the same file.
  if (value.startsWith('\\\\?\\UNC\\')) value = '\\\\' + value.slice(8);
  else if (value.startsWith('\\\\?\\') && /^[A-Za-z]:\\/.test(value.slice(4))) value = value.slice(4);
  return win32.normalize(value);
}
function assertSamePath(actual, expected, platform = process.platform) {
  assert.equal(normalizedPath(actual, platform), normalizedPath(expected, platform));
}
function safePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 &&
    !/[\\:\x00-\x1f\x7f]/.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..');
}
function archiveArgs(mode, archiveFile, destination) {
  // GNU tar treats a drive-letter archive path as a remote host.
  assert.ok(safePath(archiveFile) && !archiveFile.includes('/'), 'archive must be a relative filename');
  return [mode, archiveFile, ...(destination ? ['-C', destination] : [])];
}
function archiveTool(platform, systemRoot) {
  if (platform !== 'win32') return 'tar';
  assert.ok(typeof systemRoot === 'string' && systemRoot.trim() && win32.isAbsolute(systemRoot),
    'Windows smoke requires an absolute SystemRoot; refusing PATH tar');
  // Git's GNU tar cannot interpret native Windows extraction directories.
  return win32.join(systemRoot, 'System32', 'tar.exe');
}
function assertNativeIntel({runnerArch, platform, arch, arm64, translated}) {
  assert.equal(runnerArch, 'X64', 'Intel acceptance requires an X64 runner');
  assert.equal(platform, 'darwin', 'Intel acceptance requires macOS');
  assert.equal(arch, 'x64', 'Intel acceptance requires an x64 process');
  assert.ok(['', '0'].includes(arm64), 'Intel acceptance forbids ARM64 hardware');
  assert.ok(['', '0'].includes(translated), 'Intel acceptance forbids Rosetta');
}
function assertDrained(receipt, health, operationID) {
  assertProtocol(health);
  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.protocol_version, 1);
  assert.equal(receipt.operation_id, operationID);
  for (const key of ['installation_id', 'instance_id', 'pid', 'process_start_id',
    'image_sha256', 'runtime_version', 'account_id', 'generation']) {
    assert.equal(receipt[key], health[key], `final stop identity differs: ${key}`);
  }
  assertSamePath(receipt.image_path, health.image_path);
  assert.equal(receipt.state, 'drained');
  assert.deepEqual(receipt.unfinished, []);
}
function assertProtocol(health) {
  assert.equal(health.v, 1, 'Runtime wire protocol differs from the frozen contract');
  assert.deepEqual(health.protocol_range, {minimum: 1, maximum: 1});
}
function modelRequest(health, phase, args) {
  return {v: 1, id: `smoke-model-${phase}`, operation_id: `smoke-model-${phase}-operation`,
    idempotency_key: `smoke-model-${phase}-key`,
    scope: Object.fromEntries(['account_id', 'instance_id', 'generation'].map(key => [key, health[key]])),
    method: 'cli.exec', args: ['--json', 'model', 'engine', ...args]};
}
function assertModelResponse(reply, request, health) {
  assert.equal(reply.v, 1);
  for (const key of ['id', 'operation_id', 'idempotency_key', 'scope']) {
    assert.deepEqual(reply[key], request[key], `model response differs: ${key}`);
  }
  assert.equal(reply.pid, health.pid);
  assert.equal(reply.ok, true);
  assert.equal(reply.exit, 0);
  assert.equal(reply.error, null);
  assert.equal(reply.code, null);
  assert.equal(reply.envelope?.command, 'model');
  assert.equal(reply.envelope?.status, 'ok');
  assert.deepEqual(reply.envelope?.errors, []);
  const summary = reply.envelope.summary;
  assert.equal(summary.engine, 'cpu');
  assert.equal(summary.model, 'quantized');
  assert.equal(summary.active_selection, null);
  assert.ok(Array.isArray(summary.variants));
  assert.equal(summary.variants.filter(variant => variant.name === 'quantized').length, 1);
  assert.ok(summary.variants.every(variant => variant.state === 'baseline_missing'));
  return summary;
}
function assertBadConfigResponse(reply, request, health) {
  assert.equal(reply.v, 1);
  for (const key of ['id', 'operation_id', 'idempotency_key', 'scope']) {
    assert.deepEqual(reply[key], request[key]);
  }
  assert.equal(reply.pid, health.pid);
  assert.equal(reply.ok, false);
  assert.equal(reply.exit, 1);
  assert.equal(reply.code, 'invalid_config');
  assert.equal(reply.envelope, null);
  assert.ok(typeof reply.error === 'string' && reply.error.length > 0);
}

export {archiveArgs, archiveTool, assertBadConfigResponse, assertDrained, assertModelResponse, assertNativeIntel, assertProtocol, assertSamePath, digest, modelRequest, normalizedPath, safePath, syntheticSession};
