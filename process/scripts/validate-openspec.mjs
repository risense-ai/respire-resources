#!/usr/bin/env node
/**
 * 零外部依赖的 OpenSpec & OpenAPI 基础门禁校验脚本。
 * 校验内容：
 * 1. openspec/config.yaml 与 openspec/ROADMAP.md 存在；
 * 2. 每个非 archive 的 Change 目录包含 proposal.md、design.md、tasks.md 及至少一份 specs/<domain>/spec.md；
 * 3. 每份增量 spec.md 包含 Delta 标题、MUST/SHALL 约束及 #### Scenario:（含 GIVEN/WHEN/THEN）；
 * 4. contracts/runtime-api/openapi.yaml 声明 openapi: 3.1.0、info: 与 paths:；
 * 5. openspec/ 下非归档 Markdown 文件行数 <= 400 行。
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

function checkExists(relPath) {
  const full = path.join(root, relPath);
  if (!fs.existsSync(full)) {
    errors.push(`缺失必需文件: ${relPath}`);
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

// 1. 核心配置与路线图
checkExists("AGENTS.md");
checkExists("LESSONS.md");
checkExists("openspec/config.yaml");
checkExists("openspec/ROADMAP.md");

// 2. 校验 OpenSpec Changes
const changesDir = path.join(root, "openspec", "changes");
let changeCount = 0;

if (!fs.existsSync(changesDir)) {
  errors.push("缺失目录: openspec/changes");
} else {
  const entries = fs
    .readdirSync(changesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "archive");

  if (entries.length === 0) {
    errors.push("openspec/changes 下未找到任何 Change 目录");
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
      errors.push(`${changeRel} 缺少至少一份 specs/<domain>/spec.md`);
      continue;
    }

    for (const sf of specFiles) {
      const rel = path.relative(root, sf);
      const text = fs.readFileSync(sf, "utf8");
      if (!/^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements/m.test(text)) {
        errors.push(`${rel} 缺少标准 Delta 标题 (## ADDED/MODIFIED/REMOVED Requirements)`);
      }
      if (!/\b(MUST|SHALL)\b/.test(text)) {
        errors.push(`${rel} 缺少 RFC 2119 关键字 (MUST 或 SHALL)`);
      }
      if (!/^####\s+Scenario:/m.test(text)) {
        errors.push(`${rel} 缺少至少一个 #### Scenario: 场景块`);
      }
      if (!/\*\*GIVEN\*\*|\bGIVEN\b/.test(text) || !/\*\*WHEN\*\*|\bWHEN\b/.test(text) || !/\*\*THEN\*\*|\bTHEN\b/.test(text)) {
        errors.push(`${rel} 场景块需包含 GIVEN / WHEN / THEN`);
      }
    }
  }
}

// 3. 校验 OpenAPI 3.1 基线文件
const openapiPath = checkExists("contracts/runtime-api/openapi.yaml");
if (openapiPath) {
  const apiText = fs.readFileSync(openapiPath, "utf8");
  if (!/^openapi:\s*3\.1\.0\b/m.test(apiText)) {
    errors.push("contracts/runtime-api/openapi.yaml 必须声明 openapi: 3.1.0");
  }
  if (!/^info:/m.test(apiText)) {
    errors.push("contracts/runtime-api/openapi.yaml 缺少 info: 段落");
  }
  if (!/^paths:/m.test(apiText)) {
    errors.push("contracts/runtime-api/openapi.yaml 缺少 paths: 段落");
  }
}

// 4. 校验 openspec/ 下非归档 Markdown 行数 <= 400
const mdFiles = walkMarkdown(path.join(root, "openspec"));
for (const md of mdFiles) {
  const lines = fs.readFileSync(md, "utf8").split(/\r?\n/).length;
  if (lines > 400) {
    errors.push(`${path.relative(root, md)} 行数为 ${lines}，超过 400 行上限`);
  }
}

if (errors.length > 0) {
  console.error("OpenSpec 校验失败:");
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(
  `OpenSpec 校验通过: 已校验 ${changeCount} 个 Change 包、${mdFiles.length} 个 Markdown 文件（均 <= 400 行）及 OpenAPI 3.1 契约。`
);
