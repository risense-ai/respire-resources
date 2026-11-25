import {realpathSync} from 'node:fs';
import {normalizedPath} from './runtime-release-smoke-helpers.mjs';

const providers = new Set(['aside','claude','codex','openclaw','droid','amp','gemini','kimi','qwen','codebuff',
  'roo-code','kilo-code','cline','aider','kiro','opencode','kilo-cli','hermes','goose','crush','zed','senpi',
  'oh-my-pi','gajae-code','kodu','cursor-cli']);

export class PrivacyGateError extends Error {}
export function sameResolvedWindowsPath(actual, expected) {
  return typeof actual === 'string' &&
    normalizedPath(realpathSync.native(normalizedPath(actual))).toLowerCase() === normalizedPath(expected).toLowerCase();
}

export function assertTargets(envelope, expectedRoot) {
  const rows = envelope?.details, summary = envelope?.summary;
  try {
    if (envelope.status !== 'ok' || !Array.isArray(rows) || rows.length !== providers.size ||
      summary?.count !== providers.size || summary?.installed !== (expectedRoot ? 1 : 0) ||
      new Set(rows.map(row => row.id)).size !== providers.size) throw new PrivacyGateError();
    for (const row of rows) {
      const installed = !!expectedRoot && row.id === 'codex';
      if (!providers.has(row.id) || row.installed !== installed || !Array.isArray(row.roots) ||
        row.roots.length !== Number(installed) ||
        (installed && !sameResolvedWindowsPath(row.roots[0], expectedRoot))) throw new PrivacyGateError();
    }
  } catch { throw new PrivacyGateError(); }
}
