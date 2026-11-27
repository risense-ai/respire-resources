import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { FIX_OR_REVERT } from "./lib/lessons-audit.mjs";

const TARGET = "risense-ai/respire-resources";
const STRIKES = 3;
const SHA = /^[0-9a-f]{40}$/i;
const categories = [
  ["architecture-boundary", "Layer isolation", /\b(?:duplicate contracts?|cross-layer|server crates?)\b/i, "L-001"],
  ["desktop-storage", "Desktop storage isolation", /\b(?:wasm sqlite|sqlite drivers?|direct sqlite)\b/i, "L-002"],
  ["repeated-hashing", "Repeated full-file hashing", /\b(?:full-file.*hash|repeat\w*.*hash|redundant.*hash)\b/i, "L-003"],
  ["windows-argument-transport", "Windows argument transport", /\b(?:createprocess|shelling out via cli arguments|windows.*(?:argv|command.line length))\b/i, "L-004"],
  ["ci-sprawl", "CI workflow sprawl", /\b(?:workflow sprawl|unbounded ci workflow|workflow (?:budget|cap))\b/i, "L-005"],
  ["language-policy", "Repository language policy", /\b(?:zero.cjk|non.english text|english.only)\b/i, "L-006"],
  ["session-completion", "Session completion verification", /\b(?:login|logout|authentication|private account)\b.*\b(?:completion|confirmation)\b/i],
  ["desktop-text-overflow", "Desktop text overflow", /\b(?:wrap|overflow|truncat\w*)\b.*\b(?:widths?|cells?|titles?|text|notes?|cards?)\b/i],
  ["desktop-localization", "Desktop localization", /\b(?:translat\w*|localiz\w*)\b.*\b(?:panel|title|view|label|screen)\b/i],
  ["sqlite-migration", "SQLite migration safety", /\b(?:sqlite|schema)\b.*\b(?:upgrad\w*|migrat\w*|versions?)\b/i],
  ["release-artifacts", "Release artifact selection", /\b(?:published component updates|package names|artifact (?:selection|receipt))\b/i],
];
const byLesson = new Map(categories.filter(([, , , id]) => id).map((entry) => [entry[3], entry]));

export function issueMarker(category) {
  return `<!-- respire-lessons-audit: category=${category} -->`;
}

function readLedger(text) {
  const coverage = new Map();
  for (const section of text.split(/(?=^#{1,3} )/m)) {
    const [heading, ...body] = section.split(/\r?\n/);
    const match = /^### (L-\d+):/.exec(heading);
    if (!match) continue;
    const [, id] = match;
    coverage.set(`lesson-${id.toLowerCase()}`, id);
    for (const [category, , pattern, baseline] of categories) {
      if (id === baseline || pattern.test(heading) || body.includes(issueMarker(category))) {
        coverage.set(category, id);
      }
    }
  }
  return coverage;
}

export function classifyCommit(commit, coverage = new Map()) {
  if (!FIX_OR_REVERT.test(commit.subject)) return [];
  const ids = (commit.lessons ?? []).map((id) => id.trim().toUpperCase());
  const tagged = ids.flatMap((id) => {
    const known = byLesson.get(id) ?? categories.find(([category]) => coverage.get(category) === id);
    if (known) return [[known[0], known[1]]];
    const category = `lesson-${id.toLowerCase()}`;
    return coverage.has(category) ? [[category, `Lesson ${id}`]] : [];
  });
  if (tagged.length) return [...new Map(tagged)];
  const match = categories.find(([, , pattern]) => pattern.test(commit.subject));
  return match ? [[match[0], match[1]]] : [];
}

function evidenceLines(evidence) {
  return evidence.map(({ sha, repositories }) => `- ${repositories.join(", ")} @ \`${sha}\``);
}

function draftLesson({ category, title, evidence }) {
  return [
    `### L-TBD: ${title}`,
    issueMarker(category),
    `- **Symptom**: ${evidence.length} distinct merged repair or revert commits matched this category.`,
    "- **Root Cause**: Confirm from the evidence below.",
    "- **Guardrail Target**: Add a deterministic check or permanent regression test for the confirmed invariant.",
    "- **Status**: Draft for review.",
    "",
    ...evidenceLines(evidence),
  ].join("\n");
}

export function buildReport(commits, ledger, since, snapshots = []) {
  const coverage = readLedger(ledger);
  const groups = new Map();
  const unclassified = new Map();
  const cutoff = Date.parse(since);
  for (const commit of commits) {
    if (!SHA.test(commit.sha ?? "") || typeof commit.subject !== "string" ||
        typeof commit.repository !== "string" || !/^[\w.-]+(?:\/[\w.-]+)?$/.test(commit.repository) ||
        !Number.isFinite(Date.parse(commit.date)) ||
        (commit.lessons !== undefined && (!Array.isArray(commit.lessons) ||
          commit.lessons.some((id) => typeof id !== "string")))) {
      throw new Error("Invalid commit record");
    }
    if (Date.parse(commit.date) < cutoff || !FIX_OR_REVERT.test(commit.subject)) continue;
    const sha = commit.sha.toLowerCase();
    const matches = classifyCommit(commit, coverage);
    if (!matches.length) {
      if (!unclassified.has(sha)) unclassified.set(sha, new Set());
      unclassified.get(sha).add(commit.repository);
    }
    for (const [category, title] of matches) {
      if (!groups.has(category)) groups.set(category, { title, commits: new Map() });
      const { commits: matchesBySha } = groups.get(category);
      if (!matchesBySha.has(sha)) matchesBySha.set(sha, new Set());
      matchesBySha.get(sha).add(commit.repository);
    }
  }

  const evidenceFor = (matches) => [...matches.keys()].sort().map((sha) => ({
    sha,
    repositories: [...matches.get(sha)].sort(),
  }));
  const findings = [...groups.keys()].sort().map((category) => {
    const { title, commits: matchesBySha } = groups.get(category);
    const evidence = evidenceFor(matchesBySha);
    const count = evidence.length;
    const lesson = coverage.get(category) ?? null;
    return { category, title, count, lesson, evidence };
  });
  const drafts = findings.filter(({ lesson }) => !lesson).map((finding) => ({
    category: finding.category,
    markdown: draftLesson(finding),
  }));
  const guardrails = findings.filter(({ count }) => count >= STRIKES).map((finding) => ({
    category: finding.category,
    title: `Guardrail: ${finding.title}`,
    labels: ["guardrail"],
    body: [
      issueMarker(finding.category),
      "",
      `${finding.count} distinct merged repair or revert commits matched this category.`,
      finding.lesson ? `Ledger entry: ${finding.lesson}.` : "Review the draft ledger entry for this category.",
      "Confirm the common failure and add an automated check or permanent regression test.",
      "",
      ...evidenceLines(finding.evidence),
    ].join("\n"),
    issue: null,
  }));
  return { since, snapshots, findings, unclassified: evidenceFor(unclassified), drafts, guardrails };
}

export function matchIssues(guardrails, issues) {
  const byMarker = new Map(guardrails.map((guardrail) => [issueMarker(guardrail.category), guardrail]));
  for (const issue of issues) {
    if (issue.pull_request || !Number.isInteger(issue.number) || typeof issue.body !== "string") continue;
    for (const line of issue.body.split(/\r?\n/)) {
      const guardrail = byMarker.get(line);
      if (guardrail && (!guardrail.issue || issue.number < guardrail.issue.number)) {
        guardrail.issue = { number: issue.number, status: "existing" };
      }
    }
  }
}

export function fileGuardrails(guardrails, list, create) {
  if (!guardrails.length) return;
  matchIssues(guardrails, list());
  for (const guardrail of guardrails) {
    if (guardrail.issue) continue;
    const { title, labels, body } = guardrail;
    const { number } = create({ title, labels, body });
    if (!Number.isInteger(number) || number < 1) throw new Error("Issue creation did not return a number");
    guardrail.issue = { number, status: "created" };
  }
}

export function renderMarkdown(report) {
  const lines = ["# Lessons audit", "", `Since ${report.since}`, "", "## Findings", ""];
  for (const { repository, head } of report.snapshots) lines.push(`- ${repository} main at \`${head}\``);
  if (report.snapshots.length) lines.push("");
  if (!report.findings.length) lines.push("No classified repairs or reverts.");
  for (const { title, count, lesson, evidence } of report.findings) {
    lines.push(`### ${title}`, "", `Occurrences: ${count}. Ledger entry: ${lesson ?? "uncovered"}.`, "",
      ...evidenceLines(evidence), "");
  }
  lines.push("", "## Unclassified commits", "", ...evidenceLines(report.unclassified), "");
  if (!report.unclassified.length) lines.push("None.", "");
  lines.push("## Draft ledger entries", "");
  if (!report.drafts.length) lines.push("None.", "");
  for (const { markdown } of report.drafts) lines.push(markdown, "");
  lines.push("## Three-strike guardrails", "");
  if (!report.guardrails.length) lines.push("None.", "");
  for (const { title, issue, body } of report.guardrails) {
    const status = issue ? `#${issue.number} (${issue.status})` : "pending";
    lines.push(`### ${title}`, "", `Issue: ${status}.`, "", body, "");
  }
  return lines.join("\n");
}

function scanRepository(directory, since) {
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  if (git("rev-parse", "--is-shallow-repository") !== "false") throw new Error(`Full history required: ${directory}`);
  const head = git("rev-parse", "--verify", "refs/remotes/origin/main^{commit}");
  const repository = path.basename(git("rev-parse", "--show-toplevel"));
  const log = git("log", "--first-parent", `--since-as-filter=${since}`, "-z",
    "--format=%H%x00%cI%x00%s%x00%(trailers:key=Lesson,valueonly,separator=%x2C)", head);
  const fields = log ? log.split("\0") : [];
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 4 !== 0) throw new Error(`Invalid history records: ${directory}`);
  const commits = [];
  for (let index = 0; index < fields.length; index += 4) {
    const [sha, date, subject, lessons] = fields.slice(index, index + 4);
    commits.push({ sha, date, subject, lessons: lessons.split(","), repository });
  }
  return { snapshot: { repository, head }, commits };
}

function issueApi(args, input) {
  return JSON.parse(execFileSync("gh", ["api", ...args], {
    encoding: "utf8", input: input === undefined ? undefined : JSON.stringify(input),
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"],
    maxBuffer: 32 * 1024 * 1024,
  }));
}

function run() {
  const { values } = parseArgs({ options: {
    input: { type: "string" }, repos: { type: "string" }, since: { type: "string" },
    "lessons-file": { type: "string", default: "LESSONS.md" },
    "dry-run": { type: "boolean" }, apply: { type: "boolean" },
    "output-json": { type: "string" }, "output-md": { type: "string" },
  } });
  if (values.apply && (values["dry-run"] || values.input !== undefined)) {
    throw new Error("--apply requires live history and cannot be combined with --dry-run or --input");
  }
  if (values.input !== undefined && values.repos !== undefined) throw new Error("Choose --input or --repos");
  const since = values.since ?? new Date(Date.now() - 90 * 86400_000).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(since) ||
      !Number.isFinite(Date.parse(since))) throw new Error("--since must be an ISO date or timestamp");
  const cutoff = new Date(since).toISOString();
  const ledgerPath = values["lessons-file"];
  const jsonPath = values["output-json"];
  const markdownPath = values["output-md"];
  const paths = [ledgerPath, values.input, jsonPath, markdownPath].filter((file) => file !== undefined);
  const resolved = paths.map((file) => fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file));
  if (new Set(resolved).size !== paths.length) throw new Error("Input and report paths must be distinct");
  const ledger = fs.readFileSync(ledgerPath, "utf8");
  let report;
  if (values.input !== undefined) {
    const { commits, issues = [] } = JSON.parse(fs.readFileSync(values.input, "utf8"));
    if (!Array.isArray(commits) || !Array.isArray(issues)) throw new Error("Expected commits and optional issues arrays");
    report = buildReport(commits, ledger, cutoff);
    matchIssues(report.guardrails, issues);
  } else {
    const directories = (values.repos ?? ".").split(",").map((directory) => directory.trim());
    if (directories.some((directory) => !directory)) throw new Error("--repos requires nonempty checkout paths");
    const histories = directories.map((directory) => scanRepository(directory, cutoff));
    report = buildReport(histories.flatMap(({ commits }) => commits), ledger, cutoff,
      histories.map(({ snapshot }) => snapshot));
  }

  const writeReports = () => {
    const json = JSON.stringify(report, null, 2) + "\n";
    if (jsonPath !== undefined) fs.writeFileSync(jsonPath, json);
    if (markdownPath !== undefined) fs.writeFileSync(markdownPath, renderMarkdown(report));
    if (jsonPath === undefined && markdownPath === undefined) process.stdout.write(json);
  };
  if (!values.apply) {
    writeReports();
    return;
  }
  if (jsonPath !== undefined || markdownPath !== undefined) writeReports();
  try {
    fileGuardrails(report.guardrails,
      () => issueApi(["--paginate", "--slurp", `repos/${TARGET}/issues?state=all&per_page=100`]).flat(),
      (issue) => issueApi(["--method", "POST", `repos/${TARGET}/issues`, "--input", "-"], issue));
  } finally {
    writeReports();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
