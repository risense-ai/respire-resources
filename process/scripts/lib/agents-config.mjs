// Minimal parser and trust-allowlist helpers for .github/agents.yml (zero external deps).
import fs from "node:fs";
import path from "node:path";

/** Parse .github/agents.yml allowlist settings with Fail-Closed defaults. */
export function loadAgentsConfig(root) {
  const cfg = {
    maintainers: [],
    trusted_bots: [],
    trusted_reviewers: [],
    enforce_distinct_reviewer: false,
  };
  const filePath = path.join(root, ".github", "agents.yml");
  if (!fs.existsSync(filePath)) return cfg;

  let currentListKey = null;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const trimmed = line.trim();
    const itemMatch = trimmed.match(/^-\s+(.+)$/);
    if (itemMatch && currentListKey) {
      cfg[currentListKey].push(itemMatch[1].trim().replace(/^['"]|['"]$/g, ""));
      continue;
    }
    const kvMatch = trimmed.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kvMatch) continue;
    const [, key, rawVal] = kvMatch;
    const val = rawVal.trim();
    if (key in cfg && Array.isArray(cfg[key])) {
      currentListKey = key;
      if (val.startsWith("[") && val.endsWith("]")) {
        const inner = val.slice(1, -1).trim();
        cfg[key] = inner ? inner.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean) : [];
      }
    } else if (key === "enforce_distinct_reviewer") {
      currentListKey = null;
      cfg.enforce_distinct_reviewer = val.toLowerCase() === "true";
    } else {
      currentListKey = null;
    }
  }
  return cfg;
}

/** Return true if login is trusted to publish a PR verification verdict. */
export function isTrustedVerdictAuthor(cfg, login) {
  if (!cfg || !login) return false;
  const target = login.toLowerCase();
  const allowed = [...cfg.maintainers, ...cfg.trusted_bots, ...cfg.trusted_reviewers];
  return allowed.some((u) => u.toLowerCase() === target);
}

/** Return true if login is trusted to post immutable CI/merge Evidence markers. */
export function isTrustedEvidenceAuthor(cfg, login) {
  if (!cfg || !login) return false;
  const target = login.toLowerCase();
  const allowed = [...cfg.maintainers, ...cfg.trusted_bots];
  return allowed.some((u) => u.toLowerCase() === target);
}
