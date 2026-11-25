import assert from "node:assert/strict";
import {compiledEntryURL} from "./compiled-product-entry.mjs";
import {screens} from "./layout.mjs";

const workspace = (hash) => "/workspace.html#" + hash;
// This is a plan, not an acceptance receipt. The observer must have separately
// read trusted fixture data from its owned Runtime or host state.
const entries = {
  wizard: ["/workspace.html", "#onboarding:not([hidden])", "h1", "text", "fresh-onboarding", "owned-desktop-state", "title"],
  overview: [workspace("overview"), "#view .view-page", "[data-overview-summary] .metric:first-child strong", "text", "seeded-memory", "runtime-status", "memoryCount"],
  workspace: [workspace("memories"), "#view .view-page", ".memory-title[data-select]", "text", "seeded-memory", "memory-list", "title"],
  recall: [workspace("memories"), "#view .view-page", "[data-count]", "text", "lexical-query", "memory-search", "localizedResultCount"],
  quickpanel: ["/quickpanel.html", "#qp-body", null, "text", "isolated-account", "runtime-status", "accountName"],
  diary: [workspace("diary"), "#view .view-page", "[data-entries] [data-entry]", "text", "dated-diary-entry", "diary-list", "title"],
  organize: [workspace("organize"), "#view .view-page", ".suggestion-card strong", "text", "pending-suggestion", "organize-suggestions", "title"],
  models: [workspace("models"), "#view .view-page", "[data-live]", "text", "registered-model-profile", "model-profile-state", "modelName"],
  storage: [workspace("settings"), "#view .view-page", "input[name=dir]", "value", "isolated-data-root", "runtime-status", "dataDirectory"],
  "session-import": [workspace("session-import"), "#view .view-page", "[data-preview-result] .si-session", "text", "single-synthetic-codex", "import-preview", "previewWitness"],
  stats: [workspace("overview"), "#view .view-page", "[data-overview-stats] .metrics .metric:nth-child(3) strong", "text", "one-empty-recall", "query-log", "total"],
  accounts: [workspace("accounts"), "#view .view-page", "[data-session-field=user]", "text", "isolated-account", "runtime-status", "accountName"],
  grants: [workspace("grants"), "#view .view-page", "[data-grants] .row strong", "text", "isolated-read-only-grant", "grant-list", "grantLabel"],
  "space-members": [workspace("accounts"), "dialog[open]", "[data-members] .row strong", "text", "seeded-space-member", "space-members", "memberName"],
  injection: [workspace("injection"), "#view .view-page", "[data-row=codex]", "text", "isolated-codex-instruction", "host-inject-targets", "isolatedTargetState"],
  settings: [workspace("settings"), "#view .view-page", "[data-pref=theme]", "value", "isolated-nondefault-preferences", "owned-desktop-state", "theme"]
};

assert.deepEqual(Object.keys(entries).sort(), Object.keys(screens.en).sort());
export const productScreenNames = Object.freeze(Object.keys(entries));

export function productScreenPlan(name, locale, origin) {
  assert(Object.hasOwn(entries, name), "Unknown Client2 acceptance screen");
  assert(["en", "zh"].includes(locale), "Unknown Client2 acceptance locale");
  const url = new URL(origin);
  assert.match(url.origin, /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  assert.equal(origin, url.origin, "Expected bare owned Wails origin");
  const [entry, surface, selector, read, fixture, source, field] = entries[name];
  return Object.freeze({name, locale, navigation: compiledEntryURL(origin, entry, {locale}).href,
    surface, selector, read, fixture, source, field, prerequisites: Object.freeze({
      recall: "Search with independently seeded keyword using the workspace search form",
      "session-import": "Use only the preflight-verified synthetic Codex preview, never Apply",
      "space-members": "Open the members dialog without inviting or removing a member",
      wizard: "Use a distinct fresh profile, not the already enrolled workspace"
    }[name] ?? "Read-only navigation")});
}

export function assertIndependentWitness(plan, receipt) {
  assert.equal(receipt?.source, plan.source, "Wrong independent witness source");
  assert.equal(receipt?.fixture, plan.fixture, "Wrong isolated fixture");
  assert.equal(receipt?.locale, plan.locale, "Wrong isolated locale");
  assert.equal(receipt?.field, plan.field, "Wrong loaded-data witness");
  const value = receipt?.value;
  assert(typeof value === "string" && value.trim(), "Missing independently observed value");
  if (plan.name === "stats") assert.equal(value, "1", "Stats empty fallback is not loaded-data evidence");
  if (plan.name === "overview") assert.match(value, /^[1-9][0-9]*$/, "Expected positive seeded memory count");
  return value;
}
