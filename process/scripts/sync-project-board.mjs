#!/usr/bin/env node
// 幂等初始化并同步 risense-ai 组织级 GitHub Project v2 看板（Respire Transformation）。
// 用法：
//   node process/scripts/sync-project-board.mjs         # 仅检测权限与预览
//   node process/scripts/sync-project-board.mjs --apply # 建板并同步全部 M1-M6 Issues

import { execFileSync } from "node:child_process";

const OWNER = "risense-ai";
const PROJECT_TITLE = "Respire Transformation (001-006)";
const REPOS = ["risense-ai/respire-resources", "risense-ai/respire"];
const apply = process.argv.includes("--apply");

function runGh(args, allowFail = false) {
  try {
    const out = execFileSync("gh", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { ok: true, out: out.trim(), err: "" };
  } catch (e) {
    if (allowFail) {
      return {
        ok: false,
        out: String(e.stdout || "").trim(),
        err: String(e.stderr || e.message || "").trim(),
      };
    }
    throw e;
  }
}

const listRes = runGh(["project", "list", "--owner", OWNER, "--format", "json"], true);
if (!listRes.ok) {
  if (/read:project|missing required scopes/i.test(listRes.err)) {
    console.error("当前 gh Token 缺少 GitHub Project 权限（read:project / project）。");
    console.error("请人类 Maintainer 在终端执行以下两条命令完成一次授权与同步：");
    console.error("  1. gh auth refresh -s project,read:project");
    console.error("  2. node process/scripts/sync-project-board.mjs --apply");
    process.exit(2);
  }
  console.error("查询组织 Project 失败:", listRes.err);
  process.exit(1);
}

const projects = JSON.parse(listRes.out).projects || [];
let project = projects.find((p) => p.title === PROJECT_TITLE);

if (!project) {
  if (!apply) {
    console.log(`[dry-run] 将在 ${OWNER} 创建 Project: "${PROJECT_TITLE}"`);
    process.exit(0);
  }
  const created = runGh([
    "project",
    "create",
    "--owner",
    OWNER,
    "--title",
    PROJECT_TITLE,
    "--format",
    "json",
  ]);
  project = JSON.parse(created.out);
  console.log(`已创建 Project #${project.number}: ${project.url}`);
} else {
  console.log(`已存在 Project #${project.number}: ${project.url}`);
}

const itemsRes = runGh([
  "project",
  "item-list",
  String(project.number),
  "--owner",
  OWNER,
  "--limit",
  "200",
  "--format",
  "json",
]);
const existingUrls = new Set(
  (JSON.parse(itemsRes.out).items || []).map((it) => it.content?.url).filter(Boolean)
);

const fieldsRes = runGh([
  "project",
  "field-list",
  String(project.number),
  "--owner",
  OWNER,
  "--format",
  "json",
]);
const statusField = (JSON.parse(fieldsRes.out).fields || []).find((f) => f.name === "Status");
const statusOptByName = new Map(
  (statusField?.options || []).map((o) => [o.name.toLowerCase(), o.id])
);

function targetStatusName(issue) {
  if (issue.state === "closed") return "Done";
  const labels = new Set((issue.labels || []).map((l) => l.name));
  if (labels.has("agent:in-progress") || labels.has("agent:verify")) return "In Progress";
  return "Todo";
}

let added = 0;
let updated = 0;

for (const repo of REPOS) {
  const issuesJson = runGh(["api", "--paginate", `repos/${repo}/issues?state=all&per_page=100`]).out;
  const issues = JSON.parse(issuesJson).filter(
    (i) => !i.pull_request && /<!--\s*respire-card\b/.test(i.body || "")
  );

  for (const issue of issues) {
    if (!existingUrls.has(issue.html_url)) {
      if (!apply) {
        console.log(`[dry-run] 将添加 ${repo}#${issue.number} (${issue.title})`);
      } else {
        runGh([
          "project",
          "item-add",
          String(project.number),
          "--owner",
          OWNER,
          "--url",
          issue.html_url,
        ]);
        added += 1;
      }
    }
  }
}

if (apply && statusField && project.id) {
  const refreshed = JSON.parse(
    runGh([
      "project",
      "item-list",
      String(project.number),
      "--owner",
      OWNER,
      "--limit",
      "200",
      "--format",
      "json",
    ]).out
  ).items || [];

  const allIssuesByUrl = new Map();
  for (const repo of REPOS) {
    const issues = JSON.parse(
      runGh(["api", "--paginate", `repos/${repo}/issues?state=all&per_page=100`]).out
    );
    for (const iss of issues) {
      if (!iss.pull_request) allIssuesByUrl.set(iss.html_url, iss);
    }
  }

  for (const item of refreshed) {
    const iss = allIssuesByUrl.get(item.content?.url);
    if (!iss) continue;
    const wantName = targetStatusName(iss);
    const wantOptId = statusOptByName.get(wantName.toLowerCase());
    if (!wantOptId || item.status === wantName) continue;
    runGh([
      "project",
      "item-edit",
      "--id",
      item.id,
      "--project-id",
      project.id,
      "--field-id",
      statusField.id,
      "--single-select-option-id",
      wantOptId,
    ]);
    updated += 1;
  }
}

console.log(
  apply
    ? `Project #${project.number} 同步完成: 新增 ${added} 条卡片，更新状态 ${updated} 条。`
    : "Dry-run 检查完成。使用 --apply 参数可执行同步。"
);
