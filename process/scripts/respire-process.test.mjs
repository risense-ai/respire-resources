import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isTrustedEvidenceAuthor, isTrustedVerdictAuthor, loadAgentsConfig } from "./lib/agents-config.mjs";
import { classifyCard, parseCardMetadata } from "./lib/cards.mjs";
import { hasTrustedEvidence } from "./lib/lifecycle.mjs";
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
