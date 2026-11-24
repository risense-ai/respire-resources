// Post-merge Bot Evidence registration, Scribe Change archiving discovery, and Release readiness checks.
import fs from "node:fs";
import path from "node:path";
import { isTrustedEvidenceAuthor, loadAgentsConfig } from "./agents-config.mjs";

const RELEASE_COMPONENTS = new Set(["runtime", "cli", "client2"]);
const GREEN_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/** Return true when comments already contain a trusted Evidence marker for the commit SHA. */
export function hasTrustedEvidence(comments, sha, agentsCfg = null) {
  if (!Array.isArray(comments) || !sha) return false;
  const targetSha = sha.toLowerCase();
  const markerRe = /<!--\s*respire-evidence:[^>]*\bsha=([a-f0-9]+)\b[^>]*-->/i;
  for (const c of comments) {
    const m = (c.body || "").match(markerRe);
    if (!m || m[1].toLowerCase() !== targetSha) continue;
    const author = c.user?.login || "";
    if (!agentsCfg || isTrustedEvidenceAuthor(agentsCfg, author)) return true;
  }
  return false;
}

function readFlag(args, flagName) {
  const idx = args.indexOf(flagName);
  if (idx < 0) return null;
  const val = args[idx + 1];
  if (!val || val.startsWith("--")) {
    console.error(`Missing value after ${flagName}`);
    process.exit(1);
  }
  return val;
}

function listMergedPrsForCommit(gh, repo, sha, explicitPrNum) {
  const isExactMerge = (pr) => Boolean(pr.merged_at) && pr.base?.ref === "main"
    && pr.merge_commit_sha?.toLowerCase() === sha.toLowerCase();
  if (explicitPrNum) {
    const pr = JSON.parse(gh(["api", `repos/${repo}/pulls/${explicitPrNum}`]));
    return isExactMerge(pr) ? [pr] : [];
  }
  const pulls = JSON.parse(gh(["api", `repos/${repo}/commits/${sha}/pulls`]));
  return pulls.filter(isExactMerge);
}

function registerCardEvidence(gh, card, pr, sha, runId, agentsCfg, dryRun) {
  const comments = JSON.parse(gh(["api", "--paginate", `repos/${card.repo}/issues/${card.number}/comments?per_page=100`]));
  if (hasTrustedEvidence(comments, sha, agentsCfg)) {
    console.log(`[SKIP] Evidence already recorded for ${card.meta.id} (${card.ref}) at ${sha.slice(0, 7)}.`);
    return false;
  }

  const evidenceBody = [
    `<!-- respire-evidence: pr=${pr.html_url} sha=${sha} card=${card.meta.id} run=${runId || "local"} -->`,
    `Completed ${card.meta.id} (${card.ref}) under milestone \`${card.milestone}\`.`,
    `- **Merged PR**: ${pr.html_url}`,
    `- **Commit**: \`${sha}\``,
    `- **Workflow Run**: ${runId ? `\`${runId}\`` : "manual CLI invocation"}`,
  ].join("\n");

  if (dryRun) {
    console.log(`[DRY-RUN] Would post Evidence and close ${card.meta.id} (${card.ref}) from PR ${pr.html_url}`);
    return true;
  }

  try {
    gh(["issue", "comment", String(card.number), "--repo", card.repo, "--body", evidenceBody]);
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
      console.log(`Registered Evidence and closed ${card.meta.id} (${card.ref}).`);
    } else {
      console.log(`Registered Evidence on already-closed ${card.meta.id} (${card.ref}).`);
    }
    return true;
  } catch (err) {
    if (card.repo !== pr.base?.repo?.full_name) {
      console.warn(
        `[WARN] Cross-repo write to ${card.ref} skipped (configure org secret RESPIRE_BOT_TOKEN for cross-repo closing): ${err.message}`
      );
      return false;
    }
    throw err;
  }
}

/** Completion requires one explicit directive as the first top-level PR body paragraph. */
export function matchCompletionCard(pr, repo, byRef) {
  const lines = (pr.body || "").split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  const closing = "(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)";
  const first = lines[0]?.match(new RegExp("^" + closing + ":?\\s+((?:[\\w.-]+/[\\w.-]+)?#[1-9]\\d*)\\.?[ \\t]*$", "i"));
  if (!first || (lines[1] || "").trim()) return null;
  // Be conservative about additional closing directives, including ambiguous lists.
  // Prose, titles, branch names, and everything nested under the leading block
  // are never accepted as the completion directive.
  const additional = new RegExp("^\\s*" + closing + ":?\\s+(?:[\\w.-]+/[\\w.-]+)?#", "i");
  if (lines.slice(2).some((line) => additional.test(line))) return null;
  const ref = first[1].toLowerCase();
  return byRef.get(ref.startsWith("#") ? `${repo.toLowerCase()}${ref}` : ref) || null;
}

/** Register immutable post-merge Bot Evidence, close linked Issues, and refresh DAG/Project #1. */
export function cmdEvidenceRegister({ gh, root, fetchAllCards, cmdSync }, args) {
  const repo = readFlag(args, "--repo");
  const sha = readFlag(args, "--sha");
  const explicitPr = readFlag(args, "--pr");
  const runId = readFlag(args, "--run-id");
  const dryRun = args.includes("--dry-run");

  if (!repo || !sha) {
    console.error(
      "Usage: respire-process.mjs evidence-register --repo <owner/repo> --sha <commit-sha> [--pr <num>] [--run-id <id>] [--dry-run]"
    );
    process.exit(1);
  }

  const agentsCfg = loadAgentsConfig(root);
  const prs = listMergedPrsForCommit(gh, repo, sha, explicitPr);
  if (prs.length === 0) {
    console.log(`No merged PR into main associated with ${repo}@${sha.slice(0, 7)}; skipping Evidence registration.`);
    return;
  }

  const { byRef } = fetchAllCards();
  let registered = 0;
  for (const pr of prs) {
    const card = matchCompletionCard(pr, repo, byRef);
    if (!card) {
      console.log(`Merged PR ${repo}#${pr.number} has no single explicit closing declaration for a canonical card; skipping.`);
      continue;
    }
    if (registerCardEvidence(gh, card, pr, sha, runId, agentsCfg, dryRun)) registered += 1;
  }

  if (!dryRun && registered > 0) {
    cmdSync({ bestEffort: true });
  }
}

/** Discover completed OpenSpec Change packages ready for Scribe archiving into openspec/specs/. */
export function cmdArchiveNext({ root, fetchAllCards }, asJson) {
  const changesDir = path.join(root, "openspec", "changes");
  const activeChanges = fs
    .readdirSync(changesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "archive")
    .map((d) => d.name)
    .sort();

  const { cards } = fetchAllCards();
  const byChange = new Map();
  for (const c of cards) {
    if (!byChange.has(c.meta.change)) byChange.set(c.meta.change, []);
    byChange.get(c.meta.change).push(c);
  }

  const datePrefix = new Date().toISOString().slice(0, 10);
  const ready = [];
  for (const changeId of activeChanges) {
    const changeCards = byChange.get(changeId) || [];
    if (changeCards.length === 0) continue;
    const openCards = changeCards.filter((c) => c.state !== "closed");
    if (openCards.length > 0) continue;

    const specsRoot = path.join(changesDir, changeId, "specs");
    const deltaSpecs = [];
    if (fs.existsSync(specsRoot)) {
      for (const dom of fs.readdirSync(specsRoot, { withFileTypes: true })) {
        if (dom.isDirectory() && fs.existsSync(path.join(specsRoot, dom.name, "spec.md"))) {
          deltaSpecs.push(`openspec/changes/${changeId}/specs/${dom.name}/spec.md`);
        }
      }
    }
    ready.push({
      change_id: changeId,
      change_dir: `openspec/changes/${changeId}`,
      archive_target: `openspec/changes/archive/${datePrefix}-${changeId}`,
      delta_specs: deltaSpecs,
      closed_cards: changeCards.map((c) => ({ id: c.meta.id, ref: c.ref, url: c.url })),
    });
  }

  if (ready.length === 0) {
    const payload = { status: "no_changes_ready_to_archive", active_changes: activeChanges.length };
    if (asJson) console.log(JSON.stringify(payload, null, 2));
    else console.log("No OpenSpec Changes have all linked cards closed; nothing ready for Scribe archiving.");
    process.exit(2);
  }

  const chosen = ready[0];
  const out = { status: "archive_ready", ...chosen, all_archive_ready: ready.map((r) => r.change_id) };
  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(`=== Next OpenSpec Change Ready to Archive: ${out.change_id} ===`);
  console.log(`Change Dir   : ${out.change_dir}`);
  console.log(`Archive To   : ${out.archive_target}`);
  console.log(`Closed Cards : ${out.closed_cards.map((c) => `${c.id}(${c.ref})`).join(", ")}`);
  console.log("Delta specs  :");
  for (const s of out.delta_specs) console.log(`  - ${s}`);
}

/** Deterministic pre-release readiness check for independent Monorepo component tags. */
export function cmdReleaseCheck({ gh }, args) {
  const [componentRaw, versionRaw] = args.filter((a) => !a.startsWith("--"));
  const component = componentRaw?.toLowerCase();
  if (!component || !RELEASE_COMPONENTS.has(component) || !versionRaw || !/^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/.test(versionRaw)) {
    console.error("Usage: respire-process.mjs release-check <runtime|cli|client2> <X.Y.Z>");
    process.exit(1);
  }

  const repo = "risense-ai/respire";
  const tag = `${component}-v${versionRaw}`;
  const manifestPath = component === "client2" ? "apps/client2/go.mod" : `apps/${component}/Cargo.toml`;

  let tagMissing = true;
  try {
    gh(["api", `repos/${repo}/git/ref/tags/${tag}`]);
    tagMissing = false;
  } catch {
    tagMissing = true;
  }

  const branchData = JSON.parse(gh(["api", `repos/${repo}/branches/main`]));
  const mainSha = branchData.commit.sha;
  const runs = JSON.parse(gh(["api", `repos/${repo}/commits/${mainSha}/check-runs?per_page=100`])).check_runs || [];
  const ciGate = runs.find((r) => r.name === "ci-gate");
  const failing = runs.filter((r) => r.status !== "completed" || !GREEN_CONCLUSIONS.has(r.conclusion));
  const ciGreen = Boolean(ciGate && ciGate.status === "completed" && ciGate.conclusion === "success" && failing.length === 0);

  let manifestExists = false;
  try {
    gh(["api", `repos/${repo}/contents/${manifestPath}?ref=main`]);
    manifestExists = true;
  } catch {
    manifestExists = false;
  }

  console.log(`=== Release Readiness Check: ${tag} on ${repo} ===`);
  console.log(`  [${tagMissing ? "PASS" : "FAIL"}] Tag unused: ${tag}`);
  console.log(`  [${manifestExists ? "PASS" : "FAIL"}] Component manifest present on main: ${manifestPath}`);
  console.log(`  [${ciGreen ? "PASS" : "FAIL"}] Main CI ci-gate on ${mainSha.slice(0, 7)} (${runs.length} checks, ${failing.length} non-green)`);

  if (!tagMissing || !manifestExists || !ciGreen) {
    console.error("Release gate verdict: BLOCKED");
    process.exit(1);
  }

  console.log("Release gate verdict: READY_TO_TAG");
  console.log(`Next command (inside respire clone):\n  git tag ${tag} ${mainSha} && git push origin ${tag}`);
}
