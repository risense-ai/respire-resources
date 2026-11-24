import assert from "node:assert/strict";
import test from "node:test";
import {readFile,readdir,stat} from "node:fs/promises";
import {Script} from "node:vm";

const pages = ["wizard","overview","quickpanel","workspace","recall","diary","organize","models","storage","session-import","stats","accounts","grants","space-members","injection","settings"];
const controls = {
  wizard:["action"],overview:["metrics","results"],quickpanel:["input","action","search"],
  workspace:["memory","edit","delete","editor","title","content","save","dismiss","first","mode","action"],
  recall:["input","action"],diary:["input","date","action"],organize:["action","apply","suggest","suggestions"],
  models:["operation","op-state","cancel"],storage:["export","restore"],"session-import":["action"],
  stats:["metrics","mode","authorize","audit"],accounts:["sync","spaces","space-name","create"],
  grants:["authorize"],"space-members":["space","role","input","action"],injection:["mode","action"],settings:["mode","action"]
};
test("16 page inventories, local assets and interaction targets (static, not browser rendering)",async()=>{
  const root = new URL("../pages/",import.meta.url);
  assert.deepEqual((await readdir(root)).filter(f=>f.endsWith(".html")).sort(),pages.map(p=>p+".html").sort());
  for (const page of pages) {
    const url = new URL(page+".html",root), text = await readFile(url,"utf8");
    assert.match(text,new RegExp('data-page="'+page+'"'));
    const ids = [...text.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);
    assert.equal(ids.length,new Set(ids).size,"Duplicate IDs: "+page);
    for (const id of ["scenario","notice","results",...controls[page]]) assert.ok(ids.includes(id),page+" missing "+id);
    assert.match(text,/aria-live="polite"/);
    for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      assert.doesNotMatch(match[1],/^(?:https?:|\/\/)/,"Remote asset");
      assert.ok((await stat(new URL(match[1],url))).isFile());
    }
  }
  for (const file of ["gallery.js","screens.js"]) {
    const text = await readFile(new URL(file,root),"utf8");
    assert.doesNotThrow(()=>new Script(text,{filename:file}));
    assert.doesNotMatch(text,/\/v1\/spaces\/studio\/members/);
  }
});
test("prototype source guardrails exclude coordinator-owned browser artifacts",async()=>{
  async function inspect(dir) {
    for (const entry of await readdir(dir,{withFileTypes:true})) {
      if (entry.name === ".card017-browser-check") continue;
      const url = new URL(entry.name+(entry.isDirectory() ? "/" : ""),dir);
      if (entry.isDirectory()) { await inspect(url); continue; }
      if (!/\.(?:mjs|js|html|css|md)$/.test(entry.name)) continue;
      const text = await readFile(url,"utf8");
      assert.ok(text.split("\n").length <= 600,url.pathname+" exceeds cap");
      assert.doesNotMatch(text,/[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/);
    }
  }
  await inspect(new URL("../",import.meta.url));
});
