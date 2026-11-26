// Read a first-parent range from the default branch and report review candidates.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

export function auditLessons(cwd, ledgerPath, previous, current) {
  if (![previous, current].every((sha) => /^[0-9a-f]{40}$/i.test(sha || ""))) {
    throw new Error("Expected two full commit SHAs for the audit range");
  }
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  [previous, current] = [previous.toLowerCase(), current.toLowerCase()];
  const commits = git("rev-list", "--first-parent", previous + ".." + current)
    .split("\n").filter(Boolean);
  if (previous !== current && (!commits.length ||
    git("rev-parse", "--verify", commits.at(-1) + "^1") !== previous)) {
    throw new Error("Audit base is not on the current first-parent chain");
  }
  const lessons = new Set(Array.from(fs.readFileSync(ledgerPath, "utf8")
    .matchAll(/^### (L-\d+):/gm), (m) => m[1]));
  const candidates = [];
  const occurrences = new Map();
  for (const sha of commits) {
    const subject = git("show", "-s", "--format=%s", sha);
    if (!/^(?:fix(?:\([^)]+\))?!?:|revert(?:\([^)]+\))?!?:|Revert ")/i.test(subject)) continue;
    const ids = new Set(git("show", "-s", "--format=%(trailers:key=Lesson,valueonly)", sha)
      .split("\n").map((id) => id.trim()).filter((id) => lessons.has(id)));
    const paths = git("diff", "--name-only", sha + "^1", sha, "--", "LESSONS.md");
    candidates.push({ sha, subject, ledgerUpdated: paths === "LESSONS.md", lessons: [...ids] });
    for (const id of ids) {
      if (!occurrences.has(id)) occurrences.set(id, []);
      occurrences.get(id).push(sha);
    }
  }
  const guardrails = Array.from(occurrences, ([lesson, commits]) => ({ lesson, commits }))
    .filter((item) => item.commits.length >= 3);
  return { candidates, guardrails };
}
