import assert from "node:assert/strict";
import { test } from "node:test";
import { helpCaseList, inspectHelp } from "./legacy-help-inventory.mjs";

test("audited inventory contains 84 required top-level verbs and only literal help invocations",()=>{
  const scopes=helpCaseList();
  assert.equal(scopes[0].expectation.commands.length,84);
  assert.ok(scopes.find(x=>x.topic==="model switch"));
  for(const {args} of scopes){
    assert.equal(args[0],"--client-only");
    assert.equal(args.at(-1),"--help");
    assert.ok(args.slice(1,-1).every(x=>/^[a-z0-9-]+$/.test(x)));
  }
});
test("accepts rendered names, aliases and declared flags; new verbs may coexist",()=>{
  const raw="Usage: rsrs [OPTIONS] [COMMAND]\r\n\r\nCommands:\r\n  v      Version [aliases: version]\r\n  inject Inject targets\r\n  new-verb  New\r\n  help   Print this message\r\n\r\nOptions:\r\n  -h, --help  Print help\r\n      --json  JSON\r\n";
  inspectHelp(raw,"",{commands:["v"],aliases:{v:["version"]},options:["--json","--help"]});
  assert.throws(()=>inspectHelp(raw,"",{commands:["status"]}),/missing required command/);
  assert.throws(()=>inspectHelp(raw,"",{aliases:{v:["release"]}}),/missing required alias/);
});
test("missing option cannot be supplied by another flag's description",()=>{
  const raw="Usage: rsrs.exe inject [OPTIONS]\n\nOptions:\n      --id <ID>  requires --preview when used with --expected\n  -h, --help  Print help\n";
  inspectHelp(raw,"inject",{options:["--id","--help"]});
  assert.throws(()=>inspectHelp(raw,"inject",{options:["--preview"]}),/missing required option/);
  assert.throws(()=>inspectHelp(raw,"model switch",{}),/not the requested help topic/);
});
test("nested topic and aliases require actual structural rows",()=>{
  const raw="Usage: rsrs model [OPTIONS] <COMMAND>\n\nCommands:\n  switch  Switch selection\n  install Install assets [aliases: install-m3]\n  unrelated Mention uninstall in text\n\nOptions:\n  -h, --help  Print help\n";
  inspectHelp(raw,"model",{commands:["switch","install"],aliases:{install:["install-m3"]}});
  assert.throws(()=>inspectHelp(raw,"model",{commands:["uninstall"]}),/missing required command/);
  assert.throws(()=>inspectHelp("rsrs model help", "model",{}),/missing Clap usage/);
});
