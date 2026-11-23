#!/usr/bin/env node
// Deterministic multi-agent workflow scheduler & gate CLI (modeled on ShiningRay/sebas-process, Fail-Closed).
// Exit codes:
//   0 = Success / READY card selected
//   1 = Invalid args, missing metadata, or check error (Fail-Closed)
//   2 = blocked / needs_human (waiting on Maintainer approval, manual action, or upstream dependencies)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCard, fetchAllCards as fetchAllCardsFromApi } from "./lib/cards.mjs";
import { cmdArchiveNext, cmdEvidenceRegister, cmdReleaseCheck } from "./lib/lifecycle.mjs";
import { cmdPostVerdict, cmdReviewNext, cmdVerifyMerge } from "./lib/pr-review.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function tryExec(bin, args, cwd = ROOT) {
  try {
    const out = execFileSync(bin, args, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { ok: true, out, err: "", code: 0 };
  } catch (e) {
    return {
      ok: false,
      out: String(e.stdout || "").trim(),
      err: String(e.stderr || e.message || "").trim(),
      code: typeof e.status === "number" ? e.status : 1,
    };
  }
}

function gh(args, input = null) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input: input ?? undefined,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function fetchAllCards() {
  return fetchAllCardsFromApi(gh);
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
  const worktreeCmd =
    targetDir === "respire-resources"
      ? `git worktree add ../.worktrees/${slug}/respire-resources -b feat/${slug}`
      : `git -C ../${targetDir} worktree add ../.worktrees/${slug}/${targetDir} -b feat/${slug}`;
  const allReady = ready.map((r) => {
    const tDir = r.card.meta.target_repo?.split("/")[1] || "respire";
    const s = r.card.meta.id.toLowerCase();
    return {
      card_id: r.card.meta.id,
      ref: r.card.ref,
      url: r.card.url,
      title: r.card.title,
      milestone: r.card.milestone,
      target_repo: r.card.meta.target_repo,
      worktree_command:
        tDir === "respire-resources"
          ? `git worktree add ../.worktrees/${s}/respire-resources -b feat/${s}`
          : `git -C ../${tDir} worktree add ../.worktrees/${s}/${tDir} -b feat/${s}`,
    };
  });
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
    mark_verify_command: `node process/scripts/respire-process.mjs mark-verify ${chosen.meta.id}`,
    worktree_command: worktreeCmd,
    pr_requirements: [
      `Attach Milestone: ${chosen.milestone}`,
      `Include in PR body: Fixes ${chosen.ref}`,
    ],
    all_ready: allReady,
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
    console.log(`  5. Hand off   : Run ${out.mark_verify_command} once PR & CI are ready for Verifier`);
    if (allReady.length > 1) {
      console.log(`\nParallel READY queue (${allReady.length} total):`);
      for (const item of allReady) {
        console.log(`  - ${item.card_id} | ${item.ref} | ${item.title}`);
      }
    }
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
  gh(["issue", "edit", String(card.number), "--repo", card.repo, "--add-label", "agent:in-progress", "--remove-label", "agent:ready"]);
  console.log(`Claimed ${card.meta.id} (${card.ref}) -> added agent:in-progress`);
}

function cmdMarkVerify(arg) {
  if (!arg) {
    console.error("Usage: respire-process.mjs mark-verify <CARD-XXX | owner/repo#number>");
    process.exit(1);
  }
  const { byRef, byId } = fetchAllCards();
  const card = byId.get(arg.toUpperCase()) || byRef.get(arg);
  if (!card) {
    console.error(`Card not found: ${arg}`);
    process.exit(1);
  }
  if (card.state !== "open") {
    console.error(`Refusing mark-verify on ${card.meta.id} (${card.ref}): Issue is already closed.`);
    process.exit(1);
  }
  const args = ["issue", "edit", String(card.number), "--repo", card.repo, "--add-label", "agent:verify"];
  if (card.labels.has("agent:in-progress")) args.push("--remove-label", "agent:in-progress");
  if (card.labels.has("agent:ready")) args.push("--remove-label", "agent:ready");
  gh(args);
  console.log(`Moved ${card.meta.id} (${card.ref}) -> agent:verify (ready for independent Verifier).`);
  console.log("Optional board refresh: node process/scripts/sync-project-board.mjs --apply");
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
        "You are Respire Implementer: read AGENTS.md and openspec/AGENT_EXECUTION_GUIDE.md, run `node process/scripts/respire-process.mjs next` (stop on exit 2), claim the READY card, implement strictly in English inside ../.worktrees/, pass guardrails, open a Milestone-linked PR with `Fixes <repo>#<num>`, then run `mark-verify`. Never self-verify.",
      bugfixer:
        "You are Respire Bugfixer: follow openspec/FEATURE_LIFECYCLE.md Recipe D—claim or open a Milestone bug Issue, write a failing regression test first in ../.worktrees/, apply the minimal English-only fix, pass guardrails, open a PR with `Fixes <repo>#<num>`, run `mark-verify`, and check LESSONS.md 3-strike rules.",
      verifier:
        "You are Respire read-only Verifier (new session/read-only): modify zero code/Issues; run `node process/scripts/respire-process.mjs review-next` (stop on exit 2), inspect PR diff/CI/OpenSpec/test-cases/, and publish `post-verdict <owner/repo#pr> --verdict <PASS|CONDITIONAL|REJECT> --summary \"<evidence>\"` (mark unrun checks UNTESTED).",
      triager:
        "You are Respire Triager: deduplicate Issues, draft English OpenSpec 4-file Change packages (or bug-card specs), and check DAG metadata; never apply spec:approved or modify product source code.",
      scribe:
        "You are Respire Scribe: run `node process/scripts/respire-process.mjs archive-next` (stop on exit 2), merge verified Change deltas into openspec/specs/, update ROADMAP.md and LESSONS.md in English (filing guardrail Issues on 3+ recurrences), and ensure validate-openspec.mjs exits 0.",
      "release-manager":
        "You are Respire Release Manager: given Maintainer's component version, run `node process/scripts/respire-process.mjs release-check <component> <version>`, verify green main CI, push runtime-v*/cli-v*/client2-v*, and verify Monorepo, legacy mirror, and NPM artifacts.",
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

  const targetFile =
    roleName === "bugfixer"
      ? path.join(ROOT, "openspec", "FEATURE_LIFECYCLE.md")
      : roleName
        ? path.join(rolesDir, `${roleName}.md`)
        : path.join(rolesDir, "README.md");
  if (!fs.existsSync(targetFile)) {
    console.error(`Role guide not found: ${targetFile}`);
    process.exit(1);
  }
  console.log(fs.readFileSync(targetFile, "utf8"));
}

function cmdSync(opts = {}) {
  const { bestEffort = false } = opts;
  const { cards, byRef } = fetchAllCards();
  let updated = 0;

  for (const card of cards) {
    if (card.state !== "open") continue;
    const cls = classifyCard(card, byRef);
    const shouldBeReady = cls.status === "READY";
    const hasReady = card.labels.has("agent:ready");

    if (!shouldBeReady && !hasReady) continue;
    if (shouldBeReady && hasReady) continue;
    const flag = shouldBeReady ? "--add-label" : "--remove-label";
    try {
      gh(["issue", "edit", String(card.number), "--repo", card.repo, flag, "agent:ready"]);
      console.log(`${shouldBeReady ? "Unlocked" : "Locked"} ${card.meta.id} (${card.ref}) -> ${shouldBeReady ? "+" : "-"}agent:ready`);
      updated += 1;
    } catch (err) {
      if (bestEffort) {
        console.warn(`[WARN] Skipped ${card.ref} label update (token lacks repo scope; configure RESPIRE_BOT_TOKEN): ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  console.log(`Issue DAG label sync complete (${updated} card(s) updated).`);
  const boardRes = tryExec(process.execPath, [
    path.join(ROOT, "process", "scripts", "sync-project-board.mjs"),
    "--apply",
  ]);
  if (boardRes.ok) {
    if (boardRes.out) console.log(boardRes.out);
  } else if (boardRes.code === 2 || bestEffort) {
    console.log("Skipped GitHub Project #1 sync (token lacks org project scope; configure RESPIRE_BOT_TOKEN).");
  } else {
    console.error("Project sync failed:", boardRes.err || boardRes.out);
    process.exit(1);
  }
}

function cmdComplete(args) {
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("Usage: respire-process.mjs complete <CARD-XXX | owner/repo#num> [--pr <url>]");
    process.exit(1);
  }
  const prIdx = args.indexOf("--pr");
  const prUrl = prIdx >= 0 ? args[prIdx + 1] : null;
  if (prIdx >= 0 && !prUrl) {
    console.error("Missing value after --pr");
    process.exit(1);
  }

  const { byRef, byId } = fetchAllCards();
  const card = byId.get(target.toUpperCase()) || byRef.get(target);
  if (!card) {
    console.error(`Card not found: ${target}`);
    process.exit(1);
  }

  const commentLines = [
    `Completed ${card.meta.id} (${card.ref}) under milestone \`${card.milestone}\`.`,
    prUrl ? `- Merged PR / Evidence: ${prUrl}` : "- Verified and closed via `respire-process.mjs complete`.",
  ];
  gh(["issue", "comment", String(card.number), "--repo", card.repo, "--body", commentLines.join("\n")]);

  const rmArgs = ["issue", "edit", String(card.number), "--repo", card.repo];
  let hasRemovals = false;
  for (const lbl of ["agent:in-progress", "agent:verify", "agent:ready"]) {
    if (card.labels.has(lbl)) {
      rmArgs.push("--remove-label", lbl);
      hasRemovals = true;
    }
  }
  if (hasRemovals) gh(rmArgs);

  if (card.state === "open") {
    gh(["issue", "close", String(card.number), "--repo", card.repo]);
    console.log(`Closed ${card.meta.id} (${card.ref}).`);
  } else {
    console.log(`${card.meta.id} (${card.ref}) already closed; recorded evidence.`);
  }

  cmdSync();
}

function cmdPreflight() {
  console.log(`=== Respire Environment Preflight (${process.platform}) ===`);
  let failed = false;

  const nodeVer = process.version;
  console.log(`  [OK]   node: ${nodeVer}`);

  const gitRes = tryExec("git", ["--version"]);
  if (gitRes.ok) {
    console.log(`  [OK]   ${gitRes.out}`);
  } else {
    console.error("  [FAIL] git is not installed");
    failed = true;
  }

  const ghRes = tryExec("gh", ["auth", "status"]);
  const ghText = `${ghRes.out}\n${ghRes.err}`;
  if (ghRes.ok) {
    const hasProject = /\bproject\b/.test(ghText);
    console.log(`  [OK]   gh authenticated (project scope: ${hasProject ? "yes" : "missing"})`);
  } else {
    console.error("  [FAIL] gh CLI is not authenticated. Run: gh auth login");
    failed = true;
  }

  const filterRepoRes = tryExec("git", ["filter-repo", "--version"]);
  if (filterRepoRes.ok) {
    console.log(`  [OK]   git-filter-repo: ${filterRepoRes.out}`);
  } else {
    console.log("  [WARN] git-filter-repo not found (required in M3; install via: pip install --user git-filter-repo)");
  }

  const parentDir = path.dirname(ROOT);
  const siblings = ["respire", "respire-core", "respire-runtime", "respire-cli", "respire-client2"];
  const missingClones = [];
  console.log(`Workspace root: ${parentDir}`);
  for (const name of siblings) {
    const dir = path.join(parentDir, name);
    if (fs.existsSync(path.join(dir, ".git"))) {
      console.log(`  [OK]   sibling repo present: ${name}`);
    } else {
      console.log(`  [MISS] sibling repo missing: ${name}`);
      missingClones.push(`git clone https://github.com/risense-ai/${name}.git "${dir}"`);
    }
  }
  if (missingClones.length > 0) {
    console.log("\nClone missing sibling repos before starting cross-repo work:");
    for (const cmd of missingClones) console.log(`  ${cmd}`);
  }

  const valRes = tryExec(process.execPath, [path.join(ROOT, "process", "scripts", "validate-openspec.mjs")]);
  if (valRes.ok) {
    console.log(`  [OK]   ${valRes.out}`);
  } else {
    console.error(`  [FAIL] validate-openspec.mjs failed:\n${valRes.err || valRes.out}`);
    failed = true;
  }

  if (failed) process.exit(1);
}

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case "preflight": cmdPreflight(); break;
  case "status": cmdStatus(); break;
  case "next": cmdNext(rest.includes("--json")); break;
  case "claim": cmdClaim(rest[0]); break;
  case "mark-verify": cmdMarkVerify(rest[0]); break;
  case "review-next": cmdReviewNext({ gh, root: ROOT, fetchAllCards }, rest.includes("--json")); break;
  case "post-verdict": cmdPostVerdict({ gh }, rest); break;
  case "verify-merge": cmdVerifyMerge({ gh, root: ROOT }, rest); break;
  case "evidence-register": cmdEvidenceRegister({ gh, root: ROOT, fetchAllCards, cmdSync }, rest); break;
  case "archive-next": cmdArchiveNext({ root: ROOT, fetchAllCards }, rest.includes("--json")); break;
  case "release-check": cmdReleaseCheck({ gh }, rest); break;
  case "complete": cmdComplete(rest); break;
  case "sync": cmdSync(); break;
  case "approve-milestone": cmdApproveMilestone(rest[0]); break;
  case "roles": cmdRoles(rest); break;
  default:
    console.log([
      "Respire Process CLI - Deterministic Multi-Agent Orchestrator",
      "Usage: node process/scripts/respire-process.mjs <command> [options]",
      "  preflight                                   Verify tools, gh auth & sibling clones",
      "  status                                      Summarize M1-M6 Milestones and DAG cards",
      "  next [--json]                               Pick the single next READY card (Fail-Closed)",
      "  claim <CARD-XXX | owner/repo#num>           Lock card (+agent:in-progress)",
      "  mark-verify <CARD-XXX | ref>                Move card to agent:verify for review",
      "  review-next [--json]                        Discover next open PR needing review",
      "  post-verdict <pr-ref> --verdict <V> --summary \"<text>\"   Post head-SHA verdict",
      "  verify-merge <pr-ref> [--verdict-only] [--publish-status] Pre-merge verdict gate",
      "  evidence-register --repo <r> --sha <sha> [--pr <n>]       Register post-merge Bot Evidence",
      "  archive-next [--json]                       Discover next fully closed Change to archive",
      "  release-check <runtime|cli|client2> <X.Y.Z> Pre-tag main CI & manifest gate",
      "  complete <CARD-XXX | ref> [--pr <url>]      Close card, post evidence & sync DAG",
      "  sync                                        Refresh agent:ready labels & Project #1",
      "  approve-milestone <M1..M6|all>              Maintainer milestone approval helper",
      "  roles [implementer|bugfixer|verifier|triager|scribe|release-manager] [--one-line]",
    ].join("\n"));
    if (cmd && cmd !== "help" && cmd !== "--help") process.exit(1);
}
