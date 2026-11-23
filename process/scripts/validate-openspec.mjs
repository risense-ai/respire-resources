#!/usr/bin/env node
// Zero-dependency OpenSpec, OpenAPI 3.1, and Zero-CJK policy validator.
// Verifies:
// 1. openspec/config.yaml, openspec/ROADMAP.md, AGENTS.md, and LESSONS.md exist;
// 2. Every non-archive Change directory contains proposal.md, design.md, tasks.md, and >= 1 specs/<domain>/spec.md;
// 3. Each delta spec.md contains a Delta heading, MUST/SHALL keywords, and >= 1 Scenario (with GIVEN/WHEN/THEN);
// 4. contracts/runtime-api/openapi.yaml declares openapi: 3.1.0, info:, and paths:;
// 5. Non-archive Markdown files under openspec/ are <= 400 lines;
// 6. Zero CJK characters anywhere in tracked/text files outside dedicated UI i18n paths.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

const CJK_REGEX = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
const I18N_EXEMPT_REGEXES = [
  /(^|\/)i18n(\/|\.js$|\.ts$|\.json$)/,
  /(^|\/)locales\//,
  /_zh(-CN|-TW)?\.(json|js|ts)$/,
  /\.zh(-CN|-TW)?\.(json|js|ts)$/,
  /^test-cases\/fixtures\/i18n\//,
];
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".yml",
  ".yaml",
  ".mjs",
  ".js",
  ".ts",
  ".json",
  ".html",
  ".css",
  ".sh",
  ".ps1",
  ".txt",
  ".toml",
  ".rs",
  ".go",
]);

function checkExists(relPath) {
  const full = path.join(root, relPath);
  if (!fs.existsSync(full)) {
    errors.push(`Missing required file: ${relPath}`);
    return null;
  }
  return full;
}

function walkMarkdown(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "archive") continue;
      walkMarkdown(full, results);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

function walkAllTextFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".worktrees") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAllTextFiles(full, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (TEXT_EXTENSIONS.has(ext) || entry.name === ".gitattributes" || entry.name === ".gitignore") {
        results.push(full);
      }
    }
  }
  return results;
}

function isExemptI18nPath(relUnix) {
  return I18N_EXEMPT_REGEXES.some((re) => re.test(relUnix));
}

// 1. Core governance files
checkExists("AGENTS.md");
checkExists("LESSONS.md");
checkExists("openspec/config.yaml");
checkExists("openspec/ROADMAP.md");

// 2. OpenSpec Changes validation
const changesDir = path.join(root, "openspec", "changes");
let changeCount = 0;

if (!fs.existsSync(changesDir)) {
  errors.push("Missing directory: openspec/changes");
} else {
  const entries = fs
    .readdirSync(changesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "archive");

  if (entries.length === 0) {
    errors.push("No active Change directories found under openspec/changes");
  }

  for (const dir of entries) {
    changeCount += 1;
    const changeRel = path.join("openspec", "changes", dir.name);
    for (const reqFile of ["proposal.md", "design.md", "tasks.md"]) {
      checkExists(path.join(changeRel, reqFile));
    }

    const specsRoot = path.join(root, changeRel, "specs");
    const specFiles = [];
    if (fs.existsSync(specsRoot)) {
      for (const domain of fs.readdirSync(specsRoot, { withFileTypes: true })) {
        if (domain.isDirectory()) {
          const candidate = path.join(specsRoot, domain.name, "spec.md");
          if (fs.existsSync(candidate)) specFiles.push(candidate);
        }
      }
    }

    if (specFiles.length === 0) {
      errors.push(`${changeRel} is missing at least one specs/<domain>/spec.md`);
      continue;
    }

    for (const sf of specFiles) {
      const rel = path.relative(root, sf);
      const text = fs.readFileSync(sf, "utf8");
      if (!/^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements/m.test(text)) {
        errors.push(`${rel} is missing a Delta heading (## ADDED/MODIFIED/REMOVED Requirements)`);
      }
      if (!/\b(MUST|SHALL)\b/.test(text)) {
        errors.push(`${rel} is missing RFC 2119 requirement keyword (MUST or SHALL)`);
      }
      if (!/^####\s+Scenario:/m.test(text)) {
        errors.push(`${rel} is missing at least one #### Scenario: block`);
      }
      if (
        !/\*\*GIVEN\*\*|\bGIVEN\b/.test(text) ||
        !/\*\*WHEN\*\*|\bWHEN\b/.test(text) ||
        !/\*\*THEN\*\*|\bTHEN\b/.test(text)
      ) {
        errors.push(`${rel} scenario blocks must include GIVEN / WHEN / THEN`);
      }
    }
  }
}

// 3. OpenAPI 3.1 baseline check
const openapiPath = checkExists("contracts/runtime-api/openapi.yaml");
if (openapiPath) {
  const apiText = fs.readFileSync(openapiPath, "utf8");
  if (!/^openapi:\s*3\.1\.0\b/m.test(apiText)) {
    errors.push("contracts/runtime-api/openapi.yaml must declare openapi: 3.1.0");
  }
  if (!/^info:/m.test(apiText)) {
    errors.push("contracts/runtime-api/openapi.yaml is missing info: section");
  }
  if (!/^paths:/m.test(apiText)) {
    errors.push("contracts/runtime-api/openapi.yaml is missing paths: section");
  }
}

// 4. Non-archive OpenSpec Markdown <= 400 lines
const mdFiles = walkMarkdown(path.join(root, "openspec"));
for (const md of mdFiles) {
  const lines = fs.readFileSync(md, "utf8").split(/\r?\n/).length;
  if (lines > 400) {
    errors.push(`${path.relative(root, md)} has ${lines} lines (limit: 400)`);
  }
}

// 5. Strict Zero-CJK scan outside UI i18n paths
const textFiles = walkAllTextFiles(root);
for (const file of textFiles) {
  const relUnix = path.relative(root, file).replace(/\\/g, "/");
  if (isExemptI18nPath(relUnix)) continue;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (CJK_REGEX.test(lines[i])) {
      errors.push(`Non-i18n CJK text forbidden: ${relUnix}:${i + 1}`);
      break;
    }
  }
}

if (errors.length > 0) {
  console.error("OpenSpec validation failed:");
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(
  `OpenSpec validation passed: ${changeCount} Change packages, ${mdFiles.length} OpenSpec Markdown files (<= 400 lines), OpenAPI 3.1 valid, and 0 non-i18n CJK violations across ${textFiles.length} scanned files.`
);
