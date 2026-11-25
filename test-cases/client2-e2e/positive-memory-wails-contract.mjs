import assert from "node:assert/strict";

export const positiveMemory = Object.freeze({
  title: "CARD018 Ada compass witness",
  content: "A synthetic polar compass witness for isolated desktop acceptance.",
  query: "polar compass witness"
});

function readOwnedWitness(expected, value) {
  assert(value, "Missing independent bridge witness");
  for (const k of ["instance_id", "pid", "account_id", "generation", "runtimeDigest"]) {
    assert.equal(value.owner?.[k], expected[k], "Wrong witness authority");
  }
  const typed = value.typed, legacy = value.legacy;
  assert.equal(typeof typed?.space, "string");
  assert(typed.space.length > 0 && typed.count === 1 && legacy?.count === 1);
  assert(Array.isArray(typed.list) && typed.list.length === 1);
  const row = typed.list[0];
  assert.match(row?.id ?? "", /^[a-f0-9-]{32,36}$/i);
  assert.equal(row.title, positiveMemory.title);
  assert.equal(row.content, positiveMemory.content);
  assert.deepEqual(typed.hits,[row.id]);
  assert.deepEqual(legacy.list,[row]);
  assert.deepEqual(legacy.hits,[row.id]);
  return {space:typed.space,row};
}

// The launcher reads these two snapshots via separate typed/legacy commands
// with their own scope checks. Never accept values minted from the browser.
export function compareOwnedMemoryWitnesses(owner, before, after) {
  assert(Number.isSafeInteger(owner?.pid) && owner.pid > 0);
  assert(Number.isSafeInteger(owner?.generation) && owner.generation > 0);
  assert(typeof owner.account_id === "string" && owner.account_id && typeof owner.instance_id === "string" && owner.instance_id);
  assert.match(owner.runtimeDigest ?? "", /^[a-f0-9]{64}$/);
  const first=readOwnedWitness(owner,before);
  const second=readOwnedWitness(owner,after);
  assert.deepEqual(second,first,"Positive memory changed during browser observation");
  return Object.freeze({space:first.space,id:first.row.id,title:first.row.title,count:1});
}

// Called on the retained same-origin POST before forwarding. Exactly one
// known fixture search; do not pass any other operation through this gate.
export function isPositiveMemorySearch(postData) {
  const args=postData?.args;
  return postData?.name==="memory_search" && postData.confirmed===true && postData.secret==="" &&
    Object.keys(postData).sort().join(",")==="args,confirmed,id,name,secret" &&
    /^desktop-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(postData.id??"") &&
    !!args && Object.keys(args).length===2 &&
    args.query===positiveMemory.query && args.limit===50;
}

export function acceptPositiveSearchTerminal({operationID, owner, memoryID, terminal}) {
  assert.equal(terminal?.state,"done");
  assert.equal(terminal?.name,"memory_search");
  assert.equal(terminal?.id,operationID);
  assert.equal(terminal?.runtimeOperationId,operationID);
  for (const k of ["instance_id","account_id","generation"]) assert.equal(terminal.scope?.[k],owner[k]);
  assert.equal(terminal.envelope?.status,"ok");
  assert.equal(terminal.envelope.summary?.count,1);
  assert.deepEqual(terminal.envelope.details?.map(x=>[x.entry?.id,x.entry?.title]),
    [[memoryID,positiveMemory.title]]);
}
