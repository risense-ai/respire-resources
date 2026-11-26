// Self-dispatching PR review discovery, allowlist-checked verdict parsing, and pre-merge gating.
import { isTrustedVerdictAuthor, loadAgentsConfig } from "./agents-config.mjs";

const PR_REPOS = ["risense-ai/respire-resources", "risense-ai/respire", "risense-ai/respire-core"];
const VALID_VERDICTS = new Set(["PASS", "CONDITIONAL", "REJECT"]);
const GREEN_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/** Parse a PR reference formatted as owner/repo#123 or a GitHub PR URL. */
export function parsePrRef(arg) {
  if (!arg) return null;
  const hashMatch = arg.trim().match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/);
  if (hashMatch) return { repo: hashMatch[1], number: Number(hashMatch[2]) };
  const urlMatch = arg.trim().match(/^https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)/i);
  if (urlMatch) return { repo: urlMatch[1], number: Number(urlMatch[2]) };
  return null;
}

/** Query GitHub check-runs and commit status for a given PR head SHA (excluding verdict-gate itself). */
export function getHeadCiStatus(gh, repo, sha) {
  const checksData = JSON.parse(gh(["api", `repos/${repo}/commits/${sha}/check-runs?per_page=100`]));
  const statusData = JSON.parse(gh(["api", `repos/${repo}/commits/${sha}/status`]));
  const runs = (checksData.check_runs || []).filter((run) => run.name !== "verdict-gate");
  const statuses = (statusData.statuses || []).filter((s) => s.context !== "verdict-gate");
  const totalChecks = runs.length + statuses.length;

  let pendingCount = 0;
  const failedNames = [];
  for (const run of runs) {
    if (run.status !== "completed") {
      pendingCount += 1;
    } else if (!GREEN_CONCLUSIONS.has(run.conclusion)) {
      failedNames.push(`${run.name}:${run.conclusion}`);
    }
  }
  for (const st of statuses) {
    if (st.state === "pending") {
      pendingCount += 1;
    } else if (st.state === "failure" || st.state === "error") {
      failedNames.push(`${st.context}:${st.state}`);
    }
  }

  if (failedNames.length > 0) {
    return { status: "fail", summary: `${failedNames.length} failed (${failedNames.slice(0, 3).join(", ")})`, total_checks: totalChecks };
  }
  if (pendingCount > 0) {
    return { status: "pending", summary: `${pendingCount} check(s) pending`, total_checks: totalChecks };
  }
  if (totalChecks > 0) {
    return { status: "pass", summary: `all ${totalChecks} check(s) passed`, total_checks: totalChecks };
  }
  return { status: "none", summary: "no CI checks reported on head SHA", total_checks: 0 };
}

/** Find the newest trusted <!-- respire-verdict: ... head=<sha> --> marker comment on a PR. */
export function getLatestVerdict(gh, repo, prNumber, headSha, agentsCfg = null) {
  const comments = JSON.parse(gh(["api", "--paginate", `repos/${repo}/issues/${prNumber}/comments?per_page=100`]));
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    const c = comments[i];
    const m = (c.body || "").match(/<!--\s*respire-verdict:\s*(PASS|CONDITIONAL|REJECT)\s+head=([a-f0-9]+)\s*-->/i);
    if (!m) continue;
    const author = c.user?.login || "unknown";
    if (agentsCfg && !isTrustedVerdictAuthor(agentsCfg, author)) continue;
    return {
      verdict: m[1].toUpperCase(),
      head_sha: m[2].toLowerCase(),
      matches_head: m[2].toLowerCase() === headSha.toLowerCase(),
      author,
      url: c.html_url,
      created_at: c.created_at,
    };
  }
  return null;
}

/** Match an open or merged PR against an orchestration card by cross-repo ref, local ref, or CARD-XXX ID. */
export function matchLinkedCard(pr, repo, byRef, byId) {
  const text = `${pr.title}\n${pr.body || ""}\n${pr.head?.ref || ""}`;
  const crossRefMatch = text.match(/risense-ai\/(respire-resources|respire)#(\d+)/i);
  if (crossRefMatch) {
    const card = byRef.get(`risense-ai/${crossRefMatch[1].toLowerCase()}#${crossRefMatch[2]}`);
    if (card) return card;
  }
  const localRefMatch = text.match(/(?:fixes|closes|resolves)\s+#(\d+)/i);
  if (localRefMatch) {
    const card = byRef.get(`${repo}#${localRefMatch[1]}`);
    if (card) return card;
  }
  const cardIdMatch = text.match(/\b(CARD-\d+)\b/i);
  if (cardIdMatch) {
    const card = byId.get(cardIdMatch[1].toUpperCase());
    if (card) return card;
  }
  return null;
}

function buildReviewItem(gh, pr, repo, byRef, byId, agentsCfg) {
  const headSha = pr.head.sha;
  const card = matchLinkedCard(pr, repo, byRef, byId);
  const ci = getHeadCiStatus(gh, repo, headSha);
  const verdict = getLatestVerdict(gh, repo, pr.number, headSha, agentsCfg);
  const repoDir = repo.split("/")[1];
  const prRef = `${repo}#${pr.number}`;
  const checkoutCmd =
    repoDir === "respire-resources"
      ? `gh pr checkout ${pr.number}`
      : `gh pr checkout ${pr.number} --repo ${repo}`;

  return {
    pr_ref: prRef,
    repo,
    number: pr.number,
    url: pr.html_url,
    title: pr.title,
    head_sha: headSha,
    head_branch: pr.head.ref,
    base_branch: pr.base.ref,
    ci_status: ci.status,
    ci_summary: ci.summary,
    previous_verdict: verdict,
    has_fresh_verdict: Boolean(verdict && verdict.matches_head),
    linked_card: card
      ? {
          id: card.meta.id,
          ref: card.ref,
          milestone: card.milestone,
          ms_key: card.msKey,
          change: card.meta.change,
          has_verify_label: card.labels.has("agent:verify"),
          spec_dir: `openspec/changes/${card.meta.change}`,
        }
      : null,
    inspect_commands: [
      `gh pr view ${pr.number} --repo ${repo}`,
      `gh pr diff ${pr.number} --repo ${repo}`,
      `gh pr checks ${pr.number} --repo ${repo}`,
      checkoutCmd,
    ],
    verdict_command: `node process/scripts/respire-process.mjs post-verdict ${prRef} --verdict <PASS|CONDITIONAL|REJECT> --summary "<findings>"`,
  };
}

function sortPendingReviews(items) {
  const ciRank = { pass: 0, pending: 1, none: 2, fail: 3 };
  return items.sort((a, b) => {
    const aVerify = a.linked_card?.has_verify_label ? 0 : 1;
    const bVerify = b.linked_card?.has_verify_label ? 0 : 1;
    if (aVerify !== bVerify) return aVerify - bVerify;
    const aCi = ciRank[a.ci_status] ?? 9;
    const bCi = ciRank[b.ci_status] ?? 9;
    if (aCi !== bCi) return aCi - bCi;
    const aMs = a.linked_card?.ms_key || "M9";
    const bMs = b.linked_card?.ms_key || "M9";
    if (aMs !== bMs) return aMs.localeCompare(bMs);
    return a.pr_ref.localeCompare(b.pr_ref);
  });
}

/** Discover the next open non-draft PR awaiting an independent review on its head SHA. */
export function cmdReviewNext({ gh, root, fetchAllCards }, asJson) {
  const agentsCfg = root ? loadAgentsConfig(root) : null;
  const { cards, byRef, byId } = fetchAllCards();
  const pendingReviews = [];
  const verdicted = [];
  const matchedCardIds = new Set();

  for (const repo of PR_REPOS) {
    const pulls = JSON.parse(gh(["api", "--paginate", `repos/${repo}/pulls?state=open&per_page=100`]));
    for (const pr of pulls) {
      if (pr.draft) continue;
      const item = buildReviewItem(gh, pr, repo, byRef, byId, agentsCfg);
      if (item.linked_card) matchedCardIds.add(item.linked_card.id);
      if (item.has_fresh_verdict) verdicted.push(item);
      else pendingReviews.push(item);
    }
  }

  sortPendingReviews(pendingReviews);
  const orphanVerifyCards = cards
    .filter((c) => c.state === "open" && c.labels.has("agent:verify") && !matchedCardIds.has(c.meta.id))
    .map((c) => ({ id: c.meta.id, ref: c.ref, url: c.url, title: c.title }));

  if (pendingReviews.length === 0) {
    const payload = {
      status: "no_pending_reviews",
      scanned_repos: PR_REPOS,
      verdicted_open_prs: verdicted.map((v) => ({
        pr_ref: v.pr_ref,
        url: v.url,
        verdict: v.previous_verdict?.verdict,
        head_sha: v.head_sha,
      })),
      orphan_verify_cards: orphanVerifyCards,
    };
    if (asJson) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log("No open PRs awaiting independent review.");
      if (verdicted.length > 0) {
        console.log("Open PRs already verdicted on current head SHA (awaiting Maintainer merge):");
        for (const v of verdicted) console.log(`  - ${v.pr_ref} [${v.previous_verdict?.verdict}] ${v.url}`);
      }
      if (orphanVerifyCards.length > 0) {
        console.log("Cards labeled agent:verify without a matched open PR:");
        for (const o of orphanVerifyCards) console.log(`  - ${o.id} (${o.ref}): ${o.url}`);
      }
    }
    process.exit(2);
  }

  const chosen = pendingReviews[0];
  const out = {
    status: "review_needed",
    ...chosen,
    all_pending_reviews: pendingReviews.map((p) => ({
      pr_ref: p.pr_ref,
      url: p.url,
      ci_status: p.ci_status,
      card_id: p.linked_card?.id || null,
      title: p.title,
    })),
    orphan_verify_cards: orphanVerifyCards,
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(`=== Next PR Requiring Independent Review: ${out.pr_ref} ===`);
  console.log(`Title     : ${out.title}`);
  console.log(`URL       : ${out.url}`);
  console.log(`Branch    : ${out.head_branch} -> ${out.base_branch} (head=${out.head_sha})`);
  console.log(`CI Status : ${out.ci_status} (${out.ci_summary})`);
  console.log(
    out.linked_card
      ? `Card/Spec : ${out.linked_card.id} (${out.linked_card.ref}) -> ${out.linked_card.spec_dir}`
      : "Card/Spec : none linked (inspect commit/PR description for scope)"
  );
  if (out.previous_verdict) {
    console.log(`Prev Verdict: ${out.previous_verdict.verdict} on older commit ${out.previous_verdict.head_sha}`);
  }
  console.log("\nRead-only inspection commands:");
  for (const cmd of out.inspect_commands) console.log(`  ${cmd}`);
  console.log(`\nPublish verdict on current head SHA:\n  ${out.verdict_command}`);
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

/** Post a structured PASS/CONDITIONAL/REJECT verdict comment anchored to the PR head SHA. */
export function cmdPostVerdict({ gh }, args) {
  const target = args.find((a) => !a.startsWith("--") && parsePrRef(a));
  const prRef = parsePrRef(target);
  const verdict = readFlag(args, "--verdict")?.toUpperCase();
  const summary = readFlag(args, "--summary");
  if (!prRef || !verdict || !VALID_VERDICTS.has(verdict) || !summary) {
    console.error(
      'Usage: respire-process.mjs post-verdict <owner/repo#pr | pr-url> --verdict <PASS|CONDITIONAL|REJECT> --summary "<findings>"'
    );
    process.exit(1);
  }

  const pr = JSON.parse(gh(["api", `repos/${prRef.repo}/pulls/${prRef.number}`]));
  if (pr.state !== "open") {
    console.error(`Refusing post-verdict on ${prRef.repo}#${prRef.number}: PR state is ${pr.state}.`);
    process.exit(1);
  }

  const headSha = pr.head.sha;
  const body = [
    `<!-- respire-verdict: ${verdict} head=${headSha} -->`,
    "### Independent Verifier Verdict",
    `- **Verdict**: \`${verdict}\``,
    `- **Head SHA**: \`${headSha}\``,
    `- **Summary & Evidence**: ${summary}`,
  ].join("\n");

  gh(["pr", "comment", String(prRef.number), "--repo", prRef.repo, "--body", body]);
  console.log(`Posted ${verdict} verdict on ${prRef.repo}#${prRef.number} (head=${headSha}).`);
}

function publishVerdictCommitStatus(gh, repo, sha, state, description) {
  const clipped = description.slice(0, 140);
  try {
    gh([
      "api",
      "-X",
      "POST",
      `repos/${repo}/statuses/${sha}`,
      "-f",
      `state=${state}`,
      "-f",
      "context=verdict-gate",
      "-f",
      `description=${clipped}`,
    ]);
    console.log(`Published commit status verdict-gate=${state} on ${repo}@${sha.slice(0, 7)}`);
  } catch (err) {
    console.warn(`[WARN] Could not publish commit status verdict-gate (fork or read-only token): ${err.message}`);
  }
}

/** Fail-closed pre-merge check requiring open non-draft PR, optional CI checks, and matching trusted verdict. */
export function cmdVerifyMerge({ gh, root }, args) {
  const verdictOnly = args.includes("--verdict-only");
  const publishStatus = args.includes("--publish-status");
  const target = args.find((a) => !a.startsWith("--"));
  const prRef = parsePrRef(target);
  if (!prRef) {
    console.error(
      "Usage: respire-process.mjs verify-merge <owner/repo#pr | pr-url> [--verdict-only] [--publish-status]"
    );
    process.exit(1);
  }

  const agentsCfg = root ? loadAgentsConfig(root) : null;
  const pr = JSON.parse(gh(["api", `repos/${prRef.repo}/pulls/${prRef.number}`]));
  const headSha = pr.head.sha;
  const prAuthor = pr.user?.login || "";
  const ci = verdictOnly ? { status: "pass", summary: "skipped (--verdict-only)" } : getHeadCiStatus(gh, prRef.repo, headSha);
  const verdict = getLatestVerdict(gh, prRef.repo, prRef.number, headSha, agentsCfg);

  const openOk = pr.state === "open" && !pr.draft;
  const ciOk = ci.status === "pass";
  const distinctOk = !agentsCfg?.enforce_distinct_reviewer || !verdict || verdict.author.toLowerCase() !== prAuthor.toLowerCase();
  const verdictOk = Boolean(
    verdict && verdict.matches_head && distinctOk && (verdict.verdict === "PASS" || verdict.verdict === "CONDITIONAL")
  );

  console.log(`=== Merge Gate Check: ${prRef.repo}#${prRef.number} ===`);
  console.log(`  [${openOk ? "PASS" : "FAIL"}] PR state: ${pr.state}${pr.draft ? " (draft)" : ""}`);
  if (!verdictOnly) {
    console.log(`  [${ciOk ? "PASS" : ci.status === "pending" ? "WAIT" : "FAIL"}] CI checks (${headSha.slice(0, 7)}): ${ci.summary}`);
  }

  let statusState = "pending";
  let statusDesc = `Awaiting Verifier verdict via post-verdict on ${headSha.slice(0, 7)}`;
  if (verdictOk) {
    console.log(`  [PASS] Trusted Verifier verdict: ${verdict.verdict} on ${headSha.slice(0, 7)} by ${verdict.author}`);
    if (openOk && ciOk) {
      statusState = "success";
      statusDesc = `Verified (${verdict.verdict}) on ${headSha.slice(0, 7)} by ${verdict.author}`;
    } else if (!openOk) {
      statusState = "pending";
      statusDesc = pr.draft ? "PR is still in draft" : `PR state is ${pr.state}`;
    } else if (ci.status === "fail") {
      statusState = "failure";
      statusDesc = `CI failed: ${ci.summary}`;
    }
  } else if (verdict && verdict.matches_head && verdict.verdict === "REJECT") {
    console.log(`  [FAIL] Verifier verdict: REJECT on head ${headSha.slice(0, 7)}`);
    statusState = "failure";
    statusDesc = `Verifier REJECT on ${headSha.slice(0, 7)} by ${verdict.author}`;
  } else if (verdict && verdict.matches_head && !distinctOk) {
    console.log(`  [FAIL] Distinct reviewer enforced: author ${verdict.author} matches PR author ${prAuthor}`);
    statusState = "failure";
    statusDesc = `Blocked: reviewer (${verdict.author}) must differ from PR author`;
  } else if (verdict) {
    console.log(`  [WAIT] Verdict stale (comment=${verdict.head_sha.slice(0, 7)}, PR=${headSha.slice(0, 7)})`);
    statusDesc = `Verdict stale for ${headSha.slice(0, 7)}; re-verify required`;
  } else {
    console.log("  [WAIT] No trusted Verifier verdict comment found on PR");
  }

  if (publishStatus) {
    publishVerdictCommitStatus(gh, prRef.repo, headSha, statusState, statusDesc);
    return;
  }

  if (openOk && ciOk && verdictOk) {
    console.log("Merge gate verdict: READY_TO_MERGE");
    return;
  }
  if (
    pr.state !== "open" ||
    ci.status === "fail" ||
    (verdict && verdict.matches_head && (verdict.verdict === "REJECT" || !distinctOk))
  ) {
    process.exit(1);
  }
  process.exit(2);
}
