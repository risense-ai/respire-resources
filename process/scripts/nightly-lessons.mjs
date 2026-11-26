// Produce one reproducible report from two full, trusted main snapshots.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditLessons } from "./lib/lessons-audit.mjs";

const [resources, product] = process.argv.slice(2);
if (!resources || !product) throw new Error("Expected resources and product checkout directories");
const ledger = fileURLToPath(new URL("../../LESSONS.md", import.meta.url));
const snapshots = [];
const candidates = [];
const strikes = new Map();

for (const [repository, directory] of [["respire-resources", resources], ["respire", product]]) {
  const git = (...args) => execFileSync("git", ["-C", path.resolve(directory), ...args],
    { encoding: "utf8" }).trim();
  if (git("rev-parse", "--is-shallow-repository") !== "false") throw new Error("Full history required");
  const head = git("rev-parse", "HEAD");
  const base = git("rev-list", "--first-parent", "--max-parents=0", head);
  const result = auditLessons(directory, ledger, base, head);
  snapshots.push({ repository, base, head });
  for (const candidate of result.candidates) {
    const commit = repository + "@" + candidate.sha;
    candidates.push({ commit, ...candidate });
    for (const lesson of candidate.lessons) {
      if (!strikes.has(lesson)) strikes.set(lesson, new Map());
      const commits = strikes.get(lesson);
      if (!commits.has(candidate.sha)) commits.set(candidate.sha, []);
      commits.get(candidate.sha).push(repository);
    }
  }
}

const drafts = [];
for (const lesson of [...strikes.keys()].sort()) {
  const commits = strikes.get(lesson);
  if (commits.size < 3) continue;
  const evidence = Array.from(commits, ([sha, repositories]) => ({ sha, repositories }));
  drafts.push({
    key: "respire-guardrail/" + lesson,
    title: "Add regression coverage for " + lesson,
    labels: ["guardrail"],
    evidence,
    body: "Capture the invariant recorded under " + lesson + " in an automated check or permanent regression test.",
  });
}
console.log(JSON.stringify({ snapshots, candidates, drafts }, null, 2));
