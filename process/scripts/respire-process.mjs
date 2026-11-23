#!/usr/bin/env node
// Deterministic multi-agent workflow scheduler & gate CLI (modeled on ShiningRay/sebas-process, Fail-Closed).
// Exit codes:
//   0 = Success / READY card selected
//   1 = Invalid args, missing metadata, or check error (Fail-Closed)
//   2 = blocked / needs_human (waiting on Maintainer approval, manual action, or upstream dependencies)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPOS = ["risense-ai/respire-resources", "risense-ai/respire"];
const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  ".."
);

function gh(args, input = null) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input: input ?? undefined,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function parseCardMetadata(body) {
  if (!body) return null;
  const m = body.match(/<!--\s*respire-card\s+([\s\S]*?)-->/);
  if (!m) return null;
  const meta = {};
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes(":")) continue;
    const idx = line.indexOf(":");
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      const inner = val.slice(1, -1).trim();
      val = inner ? inner.split(",").map((s) => s.trim()).filter(Boolean) : [];
    }
    meta[key] = val;
  }
  if (!meta.id || !meta.change || !meta.milestone) return null;
  if (!Array.isArray(meta.depends_on)) meta.depends_on = [];
  return meta;
}

function fetchAllCards() {
  const cards = [];
  const byRef = new Map();
  const byId = new Map();

  for (const repo of REPOS) {
    const list = JSON.parse(gh(["api", "--paginate", `repos/${repo}/issues?state=all&per_page=100`]));
    for (const iss of list) {
      if (iss.pull_request) continue;
      const meta = parseCardMetadata(iss.body);
      if (!meta) continue;
      const ref = `${repo}#${iss.number}`;
      const labels = new Set((iss.labels || []).map((l) => l.name));
      const msMatch = meta.milestone.match(/^(M\d+)/);
      const msKey = msMatch ? msMatch[1] : "M9";
      const card = {
        ref,
        repo,
        number: iss.number,
        title: iss.title,
        state: iss.state,
        url: iss.html_url,
        milestone: iss.milestone?.title || meta.milestone,
        msKey,
        labels,
        meta,
      };
      cards.push(card);
      byRef.set(ref, card);
      byId.set(meta.id, card);
    }
  }

  cards.sort((a, b) => {
    if (a.msKey !== b.msKey) return a.msKey.localeCompare(b.msKey);
    return a.meta.id.localeCompare(b.meta.id);
  });

  return { cards, byRef, byId };
}

function classifyCard(card, byRef) {
  if (card.state === "closed") return { status: "DONE", reason: "Issue closed" };
  if (card.labels.has("metadata:invalid")) return { status: "INVALID", reason: "Has metadata:invalid label" };
  if (card.labels.has("agent:in-progress")) return { status: "IN_PROGRESS", reason: "Currently claimed by an Agent" };
  if (card.labels.has("agent:verify")) return { status: "VERIFYING", reason: "Awaiting independent read-only Verifier" };

  const unmetDeps = card.meta.depends_on.filter((depRef) => {
    const dep = byRef.get(depRef);
    return !dep || dep.state !== "closed";
  });

  if (card.labels.has("needs:human")) {
    return { status: "NEEDS_HUMAN", reason: "Requires human Maintainer action/authorization", unmetDeps };
  }
  if (!card.labels.has("spec:approved")) {
    return { status: "WAITING_APPROVAL", reason: "Awaiting Maintainer approval (missing spec:approved)", unmetDeps };
  }
  if (unmetDeps.length > 0) {
    return { status: "BLOCKED", reason: `Waiting on upstream dependencies: ${unmetDeps.join(", ")}`, unmetDeps };
  }
  return { status: "READY", reason: "Approved and unblocked; ready to claim", unmetDeps: [] };
}

function cmdStatus() {
  const { cards, byRef } = fetchAllCards();
  if (cards.length === 0) {
    console.error("No orchestration Issues with respire-card metadata found.");
    process.exit(1);
  }

  const byMs = new Map();
  for (const card of cards) {
    card.cls = classifyCard(card, byRef);
    if (!byMs.has(card.msKey)) byMs.set(card.msKey, { title: card.milestone, items: [] });
    byMs.get(card.msKey).items.push(card);
  }

  console.log("=== Respire OpenSpec Milestone Overview ===");
  for (const [, group] of [...byMs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const done = group.items.filter((c) => c.cls.status === "DONE").length;
    const ready = group.items.filter((c) => c.cls.status === "READY").length;
    const inProg = group.items.filter((c) => c.cls.status === "IN_PROGRESS").length;
    console.log(`\n[${group.title}] (${done}/${group.items.length} DONE, ${ready} READY, ${inProg} IN_PROGRESS)`);
    for (const c of group.items) {
      console.log(`  - ${c.meta.id} | ${c.cls.status.padEnd(16)} | ${c.ref} | ${c.title}`);
      if (c.cls.status !== "DONE" && c.cls.status !== "READY") {
        console.log(`      Reason: ${c.cls.reason}`);
      }
    }
  }
}

function cmdNext(asJson) {
  const { cards, byRef } = fetchAllCards();
  const classified = cards.map((c) => ({ card: c, cls: classifyCard(c, byRef) }));

  const inProgress = classified.filter((x) => x.cls.status === "IN_PROGRESS");
  const ready = classified.filter((x) => x.cls.status === "READY");

  if (ready.length === 0) {
    const waitingApproval = classified.filter((x) => x.cls.status === "WAITING_APPROVAL").length;
    const needsHuman = classified.filter((x) => x.cls.status === "NEEDS_HUMAN").length;
    const blocked = classified.filter((x) => x.cls.status === "BLOCKED").length;
    const payload = {
      status: inProgress.length > 0 ? "in_progress_only" : "blocked",
      in_progress: inProgress.map((x) => ({ id: x.card.meta.id, ref: x.card.ref, url: x.card.url })),
      summary: { waiting_approval: waitingApproval, needs_human: needsHuman, blocked },
      hint:
        waitingApproval > 0
          ? "Ask Maintainer to approve target Milestone (e.g.: node process/scripts/respire-process.mjs approve-milestone M1)"
          : "Complete needs:human cards or finish active in-progress tasks first.",
    };
    if (asJson) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log("No READY cards available (Fail-Closed gate).");
      if (inProgress.length > 0) {
        console.log("Active in-progress cards:");
        for (const x of inProgress) console.log(`  - ${x.card.meta.id} (${x.card.ref}): ${x.card.url}`);
      }
      console.log(`Summary: waiting_approval=${waitingApproval}, needs_human=${needsHuman}, blocked=${blocked}`);
      console.log(`Next step: ${payload.hint}`);
    }
    process.exit(2);
  }

  const chosen = ready[0].card;
  const targetDir = chosen.meta.target_repo?.split("/")[1] || "respire";
  const slug = chosen.meta.id.toLowerCase();
  const worktreeCmd = `git -C ${targetDir} worktree add ../.worktrees/${slug}/${targetDir} -b feat/${slug}`;
  const out = {
    status: "ready",
    card_id: chosen.meta.id,
    ref: chosen.ref,
    url: chosen.url,
    title: chosen.title,
    milestone: chosen.milestone,
    change: chosen.meta.change,
    target_repo: chosen.meta.target_repo,
    spec_dir: `openspec/changes/${chosen.meta.change}`,
    claim_command: `node process/scripts/respire-process.mjs claim ${chosen.ref}`,
    worktree_command: worktreeCmd,
    pr_requirements: [
      `Attach Milestone: ${chosen.milestone}`,
      `Include in PR body: Fixes ${chosen.ref}`,
    ],
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`=== Next Recommended Card: ${out.card_id} ===`);
    console.log(`Issue      : ${out.ref} (${out.url})`);
    console.log(`Title      : ${out.title}`);
    console.log(`Milestone  : ${out.milestone}`);
    console.log(`OpenSpec   : ${out.spec_dir}`);
    console.log(`Target Repo: ${out.target_repo}`);
    console.log("\nExecution steps:");
    console.log(`  1. Claim lock : ${out.claim_command}`);
    console.log(`  2. Worktree   : ${out.worktree_command}`);
    console.log(`  3. Implement  : Follow ${out.spec_dir}/{design.md,tasks.md,specs/*/spec.md} strictly in English`);
    console.log(`  4. Open PR    : Attach Milestone "${out.milestone}" and include "Fixes ${out.ref}"`);
  }
}

function cmdClaim(arg) {
  if (!arg) {
    console.error("Usage: respire-process.mjs claim <CARD-XXX | owner/repo#number>");
    process.exit(1);
  }
  const { byRef, byId } = fetchAllCards();
  const card = byId.get(arg.toUpperCase()) || byRef.get(arg);
  if (!card) {
    console.error(`Card not found: ${arg}`);
    process.exit(1);
  }
  const cls = classifyCard(card, byRef);
  if (cls.status !== "READY") {
    console.error(`Refusing claim on ${card.meta.id} (${card.ref}); status is ${cls.status}: ${cls.reason}`);
    process.exit(2);
  }
  gh([
    "issue",
    "edit",
    String(card.number),
    "--repo",
    card.repo,
    "--add-label",
    "agent:in-progress",
    "--remove-label",
    "agent:ready",
  ]);
  console.log(`Claimed ${card.meta.id} (${card.ref}) -> added agent:in-progress`);
}

function cmdApproveMilestone(target) {
  if (!target) {
    console.error("Usage: respire-process.mjs approve-milestone <M1|M2|M3|M4|M5|M6|all>");
    process.exit(1);
  }
  const norm = target.toUpperCase();
  const { cards, byRef } = fetchAllCards();
  const matched = cards.filter((c) => c.state === "open" && (norm === "ALL" || c.msKey === norm));
  if (matched.length === 0) {
    console.error(`No open cards found matching milestone ${target}.`);
    process.exit(1);
  }

  for (const card of matched) {
    const addLabels = [];
    const removeLabels = [];
    if (!card.labels.has("spec:approved")) addLabels.push("spec:approved");
    if (card.labels.has("spec:proposed")) removeLabels.push("spec:proposed");

    const unmet = card.meta.depends_on.filter((depRef) => {
      const dep = byRef.get(depRef);
      return !dep || dep.state !== "closed";
    });
    if (
      unmet.length === 0 &&
      !card.labels.has("needs:human") &&
      !card.labels.has("agent:in-progress") &&
      !card.labels.has("agent:ready")
    ) {
      addLabels.push("agent:ready");
    }

    if (addLabels.length > 0 || removeLabels.length > 0) {
      const args = ["issue", "edit", String(card.number), "--repo", card.repo];
      for (const l of addLabels) args.push("--add-label", l);
      for (const l of removeLabels) args.push("--remove-label", l);
      gh(args);
      console.log(
        `Updated ${card.meta.id} (${card.ref}): +[${addLabels.join(",")}] -[${removeLabels.join(",")}]`
      );
    } else {
      console.log(`Skipped ${card.meta.id} (${card.ref}): labels already up to date`);
    }
  }
}

function cmdRoles(args) {
  const oneLine = args.includes("--one-line");
  const roleName = args.find((a) => !a.startsWith("--"));
  const rolesDir = path.join(ROOT, "process", "roles");

  if (oneLine) {
    const prompts = {
      implementer:
        "You are Respire Implementer: read respire-resources/AGENTS.md and openspec/AGENT_EXECUTION_GUIDE.md, run `node process/scripts/respire-process.mjs next` (stop on exit 2), claim the READY card, implement strictly in English inside ../.worktrees/, pass guardrails, and open a Milestone-linked PR with `Fixes <repo>#<num>`. Never self-verify.",
      verifier:
        "You are Respire read-only Verifier (new session/read-only): modify zero files/Issues; audit PR diff, CI checks, matching OpenSpec scenarios, and test-cases/, then emit a PASS/CONDITIONAL/REJECT verdict with concrete command evidence (mark unrun checks UNTESTED).",
      triager:
        "You are Respire Triager: deduplicate Issues, draft English OpenSpec 4-file Change packages, and check DAG metadata; never apply spec:approved or modify product source code.",
      scribe:
        "You are Respire Scribe: archive verified & merged Changes into openspec/specs/, update ROADMAP.md and LESSONS.md in English, and ensure validate-openspec.mjs exits 0.",
      "release-manager":
        "You are Respire Release Manager: given Maintainer's component version, verify green main CI, push runtime-v*/cli-v*/client2-v*, and verify Monorepo, legacy mirror, and NPM artifacts.",
    };
    if (roleName) {
      if (!prompts[roleName]) {
        console.error(`Unknown role: ${roleName}`);
        process.exit(1);
      }
      console.log(prompts[roleName]);
    } else {
      for (const [k, v] of Object.entries(prompts)) console.log(`[${k}] ${v}`);
    }
    return;
  }

  const targetFile = roleName ? path.join(rolesDir, `${roleName}.md`) : path.join(rolesDir, "README.md");
  if (!fs.existsSync(targetFile)) {
    console.error(`Role guide not found: ${targetFile}`);
    process.exit(1);
  }
  console.log(fs.readFileSync(targetFile, "utf8"));
}

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case "status":
    cmdStatus();
    break;
  case "next":
    cmdNext(rest.includes("--json"));
    break;
  case "claim":
    cmdClaim(rest[0]);
    break;
  case "approve-milestone":
    cmdApproveMilestone(rest[0]);
    break;
  case "roles":
    cmdRoles(rest);
    break;
  default:
    console.log(
      [
        "Respire Process CLI - Deterministic Multi-Agent Orchestrator",
        "Usage:",
        "  node process/scripts/respire-process.mjs status",
        "  node process/scripts/respire-process.mjs next [--json]",
        "  node process/scripts/respire-process.mjs claim <CARD-XXX | owner/repo#num>",
        "  node process/scripts/respire-process.mjs approve-milestone <M1|M2|M3|M4|M5|M6|all>",
        "  node process/scripts/respire-process.mjs roles [implementer|verifier|triager|scribe|release-manager] [--one-line]",
      ].join("\n")
    );
    if (cmd && cmd !== "help" && cmd !== "--help") process.exit(1);
}
