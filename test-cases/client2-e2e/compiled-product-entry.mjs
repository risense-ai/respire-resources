import assert from "node:assert/strict";
import {realpath, stat} from "node:fs/promises";
import {isAbsolute, relative, resolve, sep} from "node:path";

// The embedded product is not a single index.html SPA. Only genuine entry
// documents are valid; the fragment is browser state, never a disk path.
const entryPattern = /^\/(workspace|quickpanel)\.html(?:#([a-z][a-z0-9-]*))?$/;

export function compiledEntryURL(origin, entry, {locale, scenario} = {}) {
  const match = entryPattern.exec(entry);
  assert(match && (!match[2] || match[1] === "workspace"), "Expected a genuine compiled product entry");
  assert(["en", "zh"].includes(locale), "Unsupported acceptance locale");
  const url = new URL(entry, origin);
  url.searchParams.set("locale", locale);
  if (scenario) url.searchParams.set("scenario", scenario);
  return url;
}

export async function compiledAssetPath(build, pathname) {
  assert(isAbsolute(build), "Expected an absolute asset directory");
  assert(/^\/[A-Za-z0-9._/-]+$/.test(pathname), "Expected a literal compiled asset path");
  const segments = pathname.slice(1).split("/");
  assert(segments.every(part => part && part !== "." && part !== ".."), "Unsafe compiled asset component");
  const root = await realpath(build);
  const candidate = await realpath(resolve(root, ...segments));
  const rel = relative(root, candidate);
  assert(rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep), "Compiled asset must stay below its root");
  assert((await stat(candidate)).isFile(), "Expected a compiled file");
  return candidate;
}
