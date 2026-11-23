#!/usr/bin/env node
// Idempotent initializer and status synchronizer for the risense-ai organization GitHub Project v2 board.
// Usage:
//   node process/scripts/sync-project-board.mjs         # Dry-run & token scope check
//   node process/scripts/sync-project-board.mjs --apply # Create/reuse Project & sync all M1-M6 Issues

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
    console.error("Current gh token lacks GitHub Project scopes (read:project / project).");
    console.error("Ask the human Maintainer to run these two commands in a terminal:");
    console.error("  1. gh auth refresh -s project,read:project");
    console.error("  2. node process/scripts/sync-project-board.mjs --apply");
    process.exit(2);
  }
  console.error("Failed to list organization projects:", listRes.err);
  process.exit(1);
}

const projects = JSON.parse(listRes.out).projects || [];
let project = projects.find((p) => p.title === PROJECT_TITLE);

if (!project) {
  if (!apply) {
    console.log(`[dry-run] Would create org Project "${PROJECT_TITLE}" under ${OWNER}`);
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
  console.log(`Created Project #${project.number}: ${project.url}`);
} else {
  console.log(`Using existing Project #${project.number}: ${project.url}`);
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
        console.log(`[dry-run] Would add ${repo}#${issue.number} (${issue.title})`);
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
  const refreshed =
    JSON.parse(
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
    ? `Project #${project.number} sync complete: added ${added}, updated status ${updated}.`
    : "Dry-run check complete. Pass --apply to execute sync."
);
