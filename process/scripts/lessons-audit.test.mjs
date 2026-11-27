import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildReport, classifyCommit, fileGuardrails, issueMarker } from "./lessons-audit.mjs";

const SCRIPT = fileURLToPath(new URL("./lessons-audit.mjs", import.meta.url));
const SINCE = "2026-01-01T00:00:00.000Z";
const CATEGORY = "desktop-text-overflow";
const LEDGER = "## Historical lessons\n\n### L-004: Windows argument transport\n";
const TITLES = [
  "fix(desktop)!: wrap long metric notes",
  'Revert "fix: wrap diary counts in narrow cells"',
  "revert(ui): wrap long item titles at narrow widths",
];

function commit(index, subject, fields = {}) {
  return { sha: index.toString(16).padStart(40, "0"), subject, repository: "product",
    date: "2026-01-02T00:00:00Z", ...fields };
}

function fixtureDirectory(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lessons-audit-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

function auditCli(cwd, ...args) {
  return execFileSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
}

test("classifies conventional repairs and reverts, with recognized trailers taking precedence", () => {
  for (const [index, subject] of TITLES.entries()) {
    assert.deepEqual(classifyCommit(commit(index, subject)), [[CATEGORY, "Desktop text overflow"]]);
  }
  assert.deepEqual(classifyCommit(commit(4, "docs: wrap long titles", { lessons: ["L-004"] })), []);
  assert.deepEqual(classifyCommit(commit(5, "fix: correct an unspecified problem")), []);
  assert.deepEqual(classifyCommit(commit(6, TITLES[0], { lessons: [" l-004 ", "L-004", "L-999"] })),
    [["windows-argument-transport", "Windows argument transport"]]);
});

test("matches ledger IDs, headings and markers in numbered entries", () => {
  const ledger = LEDGER + "\n### L-008: Narrow layouts\n" + issueMarker(CATEGORY) + "\n" +
    "\n### L-009: Reject unsupported SQLite versions\n";
  const commits = [
    commit(1, TITLES[0]), commit(2, "fix: another layout regression", { lessons: ["L-008"] }),
    commit(3, "fix: Windows argv encoding"), commit(4, "fix: protect SQLite schema migrations"),
  ];
  const covered = buildReport(commits, ledger, SINCE);
  assert.deepEqual(covered.findings.map(({ category, lesson, count }) => [category, lesson, count]), [
    [CATEGORY, "L-008", 2], ["sqlite-migration", "L-009", 1], ["windows-argument-transport", "L-004", 1],
  ]);
  assert.deepEqual(covered.drafts, []);
  const misplaced = LEDGER + "\n## Other notes\n" + issueMarker(CATEGORY) + "\n";
  const uncovered = buildReport(commits.slice(0, 1), misplaced, SINCE);
  assert.equal(uncovered.findings[0].lesson, null);
  assert.match(uncovered.drafts[0].markdown, /\*\*Root Cause\*\*:/);
});

test("uses distinct SHAs and qualifies guardrails at three strikes", () => {
  const commits = TITLES.map((subject, index) => commit(index + 1, subject));
  const shared = { ...commits[0], repository: "resources" };
  const old = commit(4, TITLES[2], { date: "2025-12-31T23:59:59Z" });
  const unknown = commit(5, "fix: correct an unspecified problem");
  const below = buildReport([commits[0], commits[1], shared, old, unknown], LEDGER, SINCE);
  assert.equal(below.findings[0].count, 2);
  assert.deepEqual(below.guardrails, []);
  assert.deepEqual(below.unclassified, [{ sha: unknown.sha, repositories: ["product"] }]);
  const at = buildReport([...commits, shared, old], LEDGER, SINCE);
  assert.equal(at.findings[0].count, 3);
  assert.deepEqual(at.findings[0].evidence[0].repositories, ["product", "resources"]);
  assert.equal(at.guardrails[0].category, CATEGORY);
  assert.match(at.guardrails[0].body, /^<!-- respire-lessons-audit: category=desktop-text-overflow -->$/m);
  assert.deepEqual(at.guardrails[0].labels, ["guardrail"]);
});

test("files once across reruns and ignores pull requests and inexact markers", () => {
  const marker = issueMarker(CATEGORY);
  const issues = [
    { number: 1, body: marker, pull_request: {} },
    { number: 2, body: `Quoted ${marker}` },
    { number: 3, body: issueMarker(`${CATEGORY}-other`) },
  ];
  const commits = TITLES.map((subject, index) => commit(index + 1, subject));
  const create = (payload) => {
    const issue = { ...payload, number: 4, state: "closed" };
    issues.push(issue);
    return issue;
  };
  const first = buildReport(commits, LEDGER, SINCE);
  fileGuardrails(first.guardrails, () => issues, create);
  assert.deepEqual(first.guardrails[0].issue, { number: 4, status: "created" });
  const second = buildReport(commits, LEDGER, SINCE);
  fileGuardrails(second.guardrails, () => issues, () => assert.fail("Duplicate filing"));
  assert.deepEqual(second.guardrails[0].issue, { number: 4, status: "existing" });
});

test("offline dry-run writes both reports without changing the ledger", (t) => {
  const cwd = fixtureDirectory(t);
  const ledger = path.join(cwd, "ledger.md");
  const input = path.join(cwd, "input.json");
  const json = path.join(cwd, "report.json");
  const markdown = path.join(cwd, "report.md");
  fs.writeFileSync(ledger, LEDGER);
  fs.writeFileSync(input, JSON.stringify({
    commits: TITLES.map((subject, index) => commit(index + 1, subject)),
    issues: [{ number: 42, body: issueMarker(CATEGORY) + "\r\n\r\nEvidence" }],
  }));
  const args = ["--input", input, "--lessons-file", ledger, "--since", SINCE];
  auditCli(cwd, ...args, "--dry-run", "--output-json", json, "--output-md", markdown);
  const report = JSON.parse(fs.readFileSync(json, "utf8"));
  assert.deepEqual(report, JSON.parse(auditCli(cwd, ...args)));
  assert.deepEqual(report.guardrails[0].issue, { number: 42, status: "existing" });
  const text = fs.readFileSync(markdown, "utf8");
  assert.match(text, /^# Lessons audit\n/);
  assert.match(text, /^### L-TBD: Desktop text overflow$/m);
  assert.match(text, /^Issue: #42 \(existing\)\.$/m);
  assert.equal(fs.readFileSync(ledger, "utf8"), LEDGER);
  assert.throws(() => auditCli(cwd, ...args, "--apply"), /--apply requires live history/);
  assert.throws(() => auditCli(cwd, ...args, "--output-md", ledger), /paths must be distinct/);
});

test("live dry-run reads merged main commits and their trailers", (t) => {
  const cwd = fixtureDirectory(t);
  const git = (...args) => execFileSync("git", ["-c", "user.name=Fixture", "-c",
    "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args],
  { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-q");
  git("commit", "--allow-empty", "-qm", "initial");
  git("commit", "--allow-empty", "-qm", "fix: correct an unspecified problem", "-m", "Lesson: L-004\nLesson: L-004");
  const head = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", head);
  git("commit", "--allow-empty", "-qm", TITLES[0]);
  fs.writeFileSync(path.join(cwd, "LESSONS.md"), LEDGER);
  const report = JSON.parse(auditCli(cwd, "--repos", ".", "--dry-run"));
  assert.deepEqual(report.snapshots, [{ repository: path.basename(cwd), head }]);
  assert.deepEqual(report.findings.map(({ category, count, lesson }) => [category, count, lesson]),
    [["windows-argument-transport", 1, "L-004"]]);
});
