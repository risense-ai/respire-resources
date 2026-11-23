// Pure OpenSpec card metadata parsing, dependency DAG classification, and GitHub card fetching.

export const REPOS = ["risense-ai/respire-resources", "risense-ai/respire"];

/** Parse the <!-- respire-card ... --> YAML-like block inside a GitHub Issue body. */
export function parseCardMetadata(body) {
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

/** Classify a card strictly from Issue state, labels, and upstream dependencies (Fail-Closed). */
export function classifyCard(card, byRef) {
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

/** Fetch all Issues containing <!-- respire-card --> metadata across managed repositories. */
export function fetchAllCards(gh, repos = REPOS) {
  const cards = [];
  const byRef = new Map();
  const byId = new Map();

  for (const repo of repos) {
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
