import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

export const screens = JSON.parse(await readFile(new URL("../fixtures/i18n/screens.json", import.meta.url), "utf8"));
export const viewports = {
  desktop: {width: 1440, height: 900},
  desktopSmall: {width: 1024, height: 768},
  quickpanel: {width: 560, height: 520}
};

function translationKeys(locale, prefix = "") {
  assert(locale && typeof locale === "object" && !Array.isArray(locale), "Expected a translation object");
  return Object.entries(locale).flatMap(([name, value]) => {
    const key = prefix + name;
    if (typeof value === "string") {
      assert(value.trim() && !/\[\[.*\]\]|^(undefined|null)$/.test(value), "Invalid translation " + key);
      return [key];
    }
    return translationKeys(value, key + ".");
  }).sort();
}

export function validateCatalogs(en, zh, required = []) {
  const keys = translationKeys(en);
  assert(keys.length > 0, "Translation catalog is empty");
  assert.deepEqual(translationKeys(zh), keys, "Translation keys differ between en and zh");
  for (const key of required) assert(keys.includes(key), "Missing required translation " + key);
}

export function validateScreens() {
  assert.equal(Object.keys(screens.en).length, 16);
  assert.deepEqual(Object.keys(screens.zh).sort(), Object.keys(screens.en).sort());
  for (const name of Object.keys(screens.en)) {
    for (const locale of ["en", "zh"]) {
      assert.equal(screens[locale][name].length, 2);
      for (const label of screens[locale][name]) assert(typeof label === "string" && label.trim());
    }
    assert.notEqual(screens.en[name][0], screens.zh[name][0]);
  }
}

export function measureLayout() {
  const root = document.documentElement;
  const issues = [];
  if (root.scrollWidth > root.clientWidth + 1) issues.push("horizontal overflow");
  if (/\bNaN\b|\[\[[^\]]+\]\]|\{\{[^}]+\}\}/.test(document.querySelector("main").innerText)) {
    issues.push("visible invalid number or unresolved translation");
  }
  for (const control of document.querySelectorAll("main button, main select, main input, main textarea, [data-layout-icon]")) {
    if (!control.getClientRects().length) continue;
    const rect = control.getBoundingClientRect();
    if (rect.left < -1 || rect.right > root.clientWidth + 1 || rect.width <= 0 || rect.height <= 0) {
      issues.push("out-of-bounds control: " + (control.id || control.tagName));
    }
    if (control.matches("button") && (control.scrollWidth > control.clientWidth + 1 || control.scrollHeight > control.clientHeight + 1)) {
      issues.push("clipped button: " + (control.id || control.textContent.trim()));
    }
    const icon = control.querySelector("svg, [data-layout-icon]");
    if (icon) {
      const mark = icon.getBoundingClientRect();
      if (Math.abs((mark.top + mark.bottom - rect.top - rect.bottom) / 2) > 2) issues.push("misaligned control icon");
    }
  }
  const fontSize = parseFloat(getComputedStyle(root).fontSize);
  if (!Number.isFinite(fontSize) || fontSize < 14 || fontSize > 18.81) issues.push("root font outside rem scale");
  return {issues, fontSize};
}
