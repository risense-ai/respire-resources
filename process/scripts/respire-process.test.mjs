import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isTrustedEvidenceAuthor, isTrustedVerdictAuthor, loadAgentsConfig } from "./lib/agents-config.mjs";
import { classifyCard, parseCardMetadata } from "./lib/cards.mjs";
import { cmdEvidenceRegister, hasTrustedEvidence, matchCompletionCard } from "./lib/lifecycle.mjs";
import { getLatestVerdict, matchLinkedCard, parsePrRef } from "./lib/pr-review.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function makeCard(overrides = {}) {
  return {
    ref: "risense-ai/respire#1",
    repo: "risense-ai/respire",
    number: 1,
    title: "[M2][002] Sample card",
    state: "open",
    labels: new Set(["spec:approved"]),
    meta: { id: "CARD-004", change: "002-runtime-openapi-v1-migration", milestone: "M2: 002", depends_on: [] },
    ...overrides,
  };
}

test("parseCardMetadata parses respire-card YAML-like block and dependencies", () => {
  const body = [
    "<!-- respire-card",
    "id: CARD-013",
    "change: 004-ci-guardrails-and-code-slimming",
    "milestone: M4: 004 Guardrails & Code Slimming",
    "depends_on: [risense-ai/respire-resources#2, risense-ai/respire#9]",
    "-->",
  ].join("\n");
  const meta = parseCardMetadata(body);
  assert.equal(meta.id, "CARD-013");
  assert.deepEqual(meta.depends_on, ["risense-ai/respire-resources#2", "risense-ai/respire#9"]);
  assert.equal(parseCardMetadata("no metadata here"), null);
});

test("classifyCard enforces all Fail-Closed states and dependency blocking", () => {
  const closedDep = makeCard({ ref: "risense-ai/respire-resources#3", state: "closed" });
  const openDep = makeCard({ ref: "risense-ai/respire#9", state: "open" });
  const byRef = new Map([
    [closedDep.ref, closedDep],
    [openDep.ref, openDep],
  ]);

  assert.equal(classifyCard(makeCard({ state: "closed" }), byRef).status, "DONE");
  assert.equal(classifyCard(makeCard({ labels: new Set(["metadata:invalid"]) }), byRef).status, "INVALID");
  assert.equal(classifyCard(makeCard({ labels: new Set(["agent:in-progress"]) }), byRef).status, "IN_PROGRESS");
  assert.equal(classifyCard(makeCard({ labels: new Set(["agent:verify"]) }), byRef).status, "VERIFYING");
  assert.equal(classifyCard(makeCard({ labels: new Set(["needs:human", "spec:approved"]) }), byRef).status, "NEEDS_HUMAN");
  assert.equal(classifyCard(makeCard({ labels: new Set(["spec:proposed"]) }), byRef).status, "WAITING_APPROVAL");

  const blocked = makeCard({
    meta: { id: "CARD-013", change: "004", milestone: "M4", depends_on: [closedDep.ref, openDep.ref] },
  });
  assert.equal(classifyCard(blocked, byRef).status, "BLOCKED");
  assert.deepEqual(classifyCard(blocked, byRef).unmetDeps, [openDep.ref]);

  const ready = makeCard({
    meta: { id: "CARD-004", change: "002", milestone: "M2", depends_on: [closedDep.ref] },
  });
  assert.equal(classifyCard(ready, byRef).status, "READY");
});

test("parsePrRef supports owner/repo#num and GitHub PR URLs", () => {
  assert.deepEqual(parsePrRef("risense-ai/respire#42"), { repo: "risense-ai/respire", number: 42 });
  assert.deepEqual(parsePrRef("https://github.com/risense-ai/respire-resources/pull/7/files"), {
    repo: "risense-ai/respire-resources",
    number: 7,
  });
  assert.equal(parsePrRef("invalid-ref"), null);
});

test("loadAgentsConfig parses repo allowlist and restricts untrusted authors", () => {
  const realCfg = loadAgentsConfig(ROOT);
  assert.equal(isTrustedVerdictAuthor(realCfg, "luodaoyi"), true);
  assert.equal(isTrustedVerdictAuthor(realCfg, "github-actions[bot]"), true);
  assert.equal(isTrustedVerdictAuthor(realCfg, "random-attacker"), false);
  assert.equal(isTrustedEvidenceAuthor(realCfg, "github-actions[bot]"), true);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "respire-agents-"));
  fs.mkdirSync(path.join(tmpDir, ".github"));
  fs.writeFileSync(
    path.join(tmpDir, ".github", "agents.yml"),
    "maintainers:\n  - alice\ntrusted_bots: [github-actions[bot]]\ntrusted_reviewers:\n  - bob-bot\nenforce_distinct_reviewer: true\n"
  );
  const custom = loadAgentsConfig(tmpDir);
  assert.equal(custom.enforce_distinct_reviewer, true);
  assert.equal(isTrustedVerdictAuthor(custom, "bob-bot"), true);
  assert.equal(isTrustedEvidenceAuthor(custom, "bob-bot"), false);
});

test("getLatestVerdict ignores untrusted authors and detects stale head SHAs", () => {
  const comments = [
    {
      body: "<!-- respire-verdict: PASS head=1111111aaaaaaa -->\n### Independent Verifier Verdict",
      user: { login: "luodaoyi" },
      html_url: "https://github.com/example/1",
      created_at: "2026-11-24T00:00:00Z",
    },
    {
      body: "<!-- respire-verdict: PASS head=2222222bbbbbbb -->\nspoofed comment",
      user: { login: "untrusted-user" },
      html_url: "https://github.com/example/2",
      created_at: "2026-11-24T00:05:00Z",
    },
  ];
  const mockGh = () => JSON.stringify(comments);
  const cfg = loadAgentsConfig(ROOT);

  const stale = getLatestVerdict(mockGh, "risense-ai/respire", 5, "2222222bbbbbbb", cfg);
  assert.equal(stale.verdict, "PASS");
  assert.equal(stale.author, "luodaoyi");
  assert.equal(stale.matches_head, false);

  const fresh = getLatestVerdict(mockGh, "risense-ai/respire", 5, "1111111aaaaaaa", cfg);
  assert.equal(fresh.matches_head, true);
});

test("matchLinkedCard resolves cross-repo ref, local ref, and CARD-XXX", () => {
  const card = makeCard({ ref: "risense-ai/respire-resources#2", meta: { id: "CARD-002", change: "001", milestone: "M1", depends_on: [] } });
  const byRef = new Map([[card.ref, card]]);
  const byId = new Map([[card.meta.id, card]]);

  assert.equal(
    matchLinkedCard({ title: "audit", body: "Fixes risense-ai/respire-resources#2", head: { ref: "feat/x" } }, "risense-ai/respire-core", byRef, byId),
    card
  );
  assert.equal(
    matchLinkedCard({ title: "fix", body: "Closes #2", head: { ref: "main" } }, "risense-ai/respire-resources", byRef, byId),
    card
  );
  assert.equal(
    matchLinkedCard({ title: "CARD-002 audit", body: "", head: { ref: "feat/card-002" } }, "risense-ai/respire-core", byRef, byId),
    card
  );
});

test("evidence registration ignores #20 prerequisite but closes the explicit #19 delivery", () => {
  const repo = "risense-ai/respire";
  const card = makeCard({ ref: repo + "#5", repo, number: 5, labels: new Set(["agent:in-progress"]),
    meta: { id: "CARD-008", change: "003", milestone: "M3", depends_on: [] } });
  const byRef = new Map([[card.ref, card]]);
  const byId = new Map([[card.meta.id, card]]);
  const sha = "b8e791a190c3c2d9db7590fe300aea4275ff7e96";
  const runtime = {
    merge_commit_sha: sha,
    number: 20, title: "feat(runtime): add scoped startup control for Client2",
    body: "Part of #5\n\nRuntime-only prerequisite for CARD-008.\n\nThis PR does not close #5, waive compatibility checks, or expose unimplemented model removal.",
    head: { ref: "feat/card-008-runtime-authority" }, base: { ref: "main", repo: { full_name: repo } },
    html_url: "https://github.com/risense-ai/respire/pull/20",
    merged_at: "2026-11-24T19:56:54Z",
  };
  assert.equal(matchLinkedCard(runtime, repo, byRef, byId), card, "review association must remain broad");
  const completed = { ...runtime, number: 19, title: "Import Client2", body: "Closes #5\n\nImports Client2.",
    html_url: "https://github.com/risense-ai/respire/pull/19" };
  const calls = [];
  const exec = (pr, commit = pr.merge_commit_sha) => cmdEvidenceRegister({
    root: ROOT,
    fetchAllCards: () => ({ byRef, byId }),
    cmdSync: () => calls.push(["sync"]),
    gh: (args) => {
      if (args[0] === "api" && args[1].endsWith("/pulls/" + pr.number)) return JSON.stringify(pr);
      if (args[0] === "api" && args.includes("--paginate")) return "[]";
      calls.push(args);
      return "";
    },
  }, ["--repo", repo, "--sha", commit, "--pr", String(pr.number)]);
  exec(runtime);
  assert.deepEqual(calls, [], "prerequisite must not post, close, or unlock");
  exec(completed, "f".repeat(40));
  assert.deepEqual(calls, [], "a different SHA must not credit this merge");
  exec(completed);
  assert.deepEqual(calls.map((args) => args.slice(0, 3)),
    [["issue", "comment", "5"], ["issue", "edit", "5"], ["issue", "close", "5"], ["sync"]]);
  assert.match(calls[0].at(-1), /pull\/19/);
});

test("completion declaration is unambiguous and not prose, quotes, or documentation", () => {
  const repo = "risense-ai/respire";
  const card = makeCard({ ref: repo + "#5" });
  const byRef = new Map([[card.ref, card]]);
  const match = (body) => matchCompletionCard({ title: "Closes #5", body, head: { ref: "card-008" } }, repo, byRef);
  for (const body of [
    "", "This PR does not close #5", "> Closes #5", "    Closes #5",
    "<!-- template\nCloses #5\n-->", "\x60\x60\x60md\nCloses #5\n\x60\x60\x60", "~~~\nCloses #5\n~~~",
    "<pre>\nCloses #5\n</pre>", "<details>\n<summary>Example</summary>\nCloses #5\n</details>",
    "Some template paragraph\nCloses #5", "Closes #5\nCloses #6", "Closes #5\n\nFixes #6, fixes #7",
    "Closes another/repo#5", "Closes #55",
  ]) assert.equal(match(body), null, body);
  assert.equal(match("Closes #5\n\nThis PR implements CARD-008."), card);
  assert.equal(match("Resolves risense-ai/respire#5."), card);
  assert.equal(matchCompletionCard({ body: "Fixes risense-ai/respire#5" }, "risense-ai/respire-resources", byRef), card);
});

test("hasTrustedEvidence enforces SHA match and trusted author allowlist", () => {
  const cfg = loadAgentsConfig(ROOT);
  const sha = "abcdef1234567890";
  const goodComments = [{ body: `<!-- respire-evidence: pr=https://x sha=${sha} card=CARD-002 run=99 -->`, user: { login: "github-actions[bot]" } }];
  const spoofComments = [{ body: `<!-- respire-evidence: pr=https://x sha=${sha} card=CARD-002 run=99 -->`, user: { login: "stranger" } }];

  assert.equal(hasTrustedEvidence(goodComments, sha, cfg), true);
  assert.equal(hasTrustedEvidence(goodComments, "000000", cfg), false);
  assert.equal(hasTrustedEvidence(spoofComments, sha, cfg), false);
});

test("respire-process.mjs --help lists lifecycle and review subcommands", () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, "process", "scripts", "respire-process.mjs"), "--help"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  for (const sub of ["next", "claim", "mark-verify", "review-next", "post-verdict", "verify-merge", "evidence-register", "archive-next", "release-check"]) {
    assert.ok(out.includes(sub), `help output missing subcommand: ${sub}`);
  }
});

test("verify-merge and evidence validation read only exact merge data through the CLI", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "process-review-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixture = path.join(dir, "fixture.cjs");
  fs.writeFileSync(fixture, `
    const child = require("node:child_process");
    const sha = "a".repeat(40);
    const repo = "risense-ai/respire-resources";
    const scenario = process.env.SCENARIO;
    child.execFileSync = (file, args) => {
      if (file !== "gh" || args[0] !== "api" || args.length > 3 || args.includes("-X")) {
        throw Error("unexpected operation");
      }
      const endpoint = args.at(-1);
      if (endpoint.endsWith("/pulls/10")) return JSON.stringify({
        head: { sha }, state: "open", merged_at: "date", base: { ref: "main" },
        merge_commit_sha: scenario === "wrong-merge" ? "b".repeat(40) : sha,
        body: scenario === "ambiguous" ? "Part of #7" : "Fixes #7",
        html_url: "https://github.com/" + repo + "/pull/10"
      });
      if (endpoint.includes("/issues?")) return JSON.stringify(endpoint.startsWith("repos/" + repo + "/")
        ? [{ number: 7, state: "open", body: "<!-- respire-card\\nid: CARD-020\\nchange: 006\\nmilestone: M6\\n-->" }] : []);
      if (endpoint.includes("/issues/7/comments")) return "[]";
      if (endpoint.includes("/issues/10/comments")) return JSON.stringify([{
        body: "<!-- respire-verdict: PASS head=" + sha + " -->", user: { login: "luodaoyi" }
      }]);
      if (endpoint.includes("/check-runs")) return JSON.stringify({ check_runs: [
        { name: scenario === "gate-only" ? "verdict-gate" : "test", status: "completed", conclusion: "success" }
      ] });
      if (endpoint.endsWith("/status")) return '{"statuses":[]}';
      throw Error("unexpected endpoint " + endpoint);
    };
    require("node:module").syncBuiltinESMExports();
  `);
  const cli = path.join(ROOT, "process/scripts/respire-process.mjs");
  function run(scenario, ...args) {
    return execFileSync(process.execPath, ["--require", fixture, cli, ...args],
      { cwd: dir, env: { ...process.env, SCENARIO: scenario }, encoding: "utf8", stdio: "pipe" });
  }
  const repo = "risense-ai/respire-resources";
  const validate = ["evidence-register", "--repo", repo, "--sha", "a".repeat(40), "--pr", "10", "--validate-only"];
  assert.match(run("valid", ...validate), /DRY-RUN/);
  assert.throws(() => run("wrong-merge", ...validate), /Expected one exact merge/);
  assert.throws(() => run("ambiguous", ...validate), /Expected one explicit card/);
  assert.match(run("valid", "verify-merge", repo + "#10"), /READY_TO_MERGE/);
  assert.throws(() => run("gate-only", "verify-merge", repo + "#10"), (err) =>
    err.status === 2 && err.stdout.includes("no CI checks reported"));
});

test("lessons-audit counts independent fixes and reverts and reports missing ledger updates", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "process-lessons-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "user.name=Fixture", "-c",
    "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("commit", "--allow-empty", "-qm", "initial");
  const base = git("rev-parse", "HEAD");
  const main = git("branch", "--show-current");
  git("checkout", "-qb", "side");
  git("commit", "--allow-empty", "-qm", "fix: off-chain", "-m", "Lesson: L-001");
  const side = git("rev-parse", "HEAD");
  git("checkout", "-q", main);
  function audit(previous = base) {
    return JSON.parse(execFileSync(process.execPath, [path.join(ROOT, "process/scripts/respire-process.mjs"),
      "lessons-audit", previous, git("rev-parse", "HEAD")], { cwd: dir, encoding: "utf8", stdio: "pipe" }));
  }
  for (const title of ["fix(cli): first", "revert: second", "docs: ignored"]) {
    git("commit", "--allow-empty", "-qm", title, "-m", "Lesson: L-001\nLesson: L-001");
  }
  git("merge", "--no-ff", "-qm", "merge the side branch", "side");
  assert.throws(() => audit(side), /Audit base is not on the current first-parent chain/);
  assert.deepEqual(audit().guardrails, []);
  fs.writeFileSync(path.join(dir, "LESSONS.md"), "Test incident\n");
  git("add", "LESSONS.md");
  git("commit", "-qm", "fix: third", "-m", "Lesson: L-001");
  const report = audit();
  assert.deepEqual(report.candidates.map((item) => item.ledgerUpdated), [true, false, false]);
  assert.deepEqual(report.guardrails, [{ lesson: "L-001", commits: report.candidates.map((item) => item.sha) }]);
  assert.deepEqual(audit(), report);
});
