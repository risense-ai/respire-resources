import assert from "node:assert/strict";
import test from "node:test";
import {sseFrames} from "./targets.mjs";

const status = {operation_id:"synthetic-operation", kind:"model_switch"};
const progress = {...status, state:"running", progress_percent:35};
const failed = {...status, state:"failed", error:{type:"about:blank", title:"Operation failed", status:500, code:"operation_failed"}};
const frame = (event, text) => Buffer.from("event: " + event + "\r\ndata: " + text + "\r\n\r\n");
const read = chunks => Array.fromAsync(sseFrames(chunks,{compiled:true}));

test("compiled progress and typed failure normalize to the unchanged scenario shape", async () => {
  const frames = Buffer.concat([
    Buffer.from(": keepalive\r\n\r\n"),
    frame("progress",JSON.stringify({event:"progress",data:progress})),
    frame("failed",JSON.stringify({event:"failed",data:failed}))
  ]);
  assert.deepEqual(await read([frames.subarray(0,12),frames.subarray(12,41),frames.subarray(41)]),
    [{event:"progress",data:progress},{event:"failed",data:failed}]);
});

test("compiled SSE rejects ambiguous or malformed operation frames without flat fallback", async () => {
  const bad = [
    [frame("progress",JSON.stringify(progress)),/operation envelope/],
    [frame("progress",JSON.stringify({event:"failed",data:progress})),/operation envelope/],
    [frame("progress",'{"event":"progress","data":[]}'),/operation envelope/],
    [frame("progress",'{"event":"progress","data":null}'),/operation envelope/],
    [frame("progress",JSON.stringify({event:"progress",data:progress,state:"running"})),/operation envelope/],
    [frame("progress",JSON.stringify({event:"progress",data:{...progress,state:"failed"}})),/operation status/],
    [frame("progress",'{"event":"progress","data":{"state":"running"}}'),/operation status/],
    [frame("failed",JSON.stringify({event:"failed",data:{...failed,error:{type:"about:blank"}}})),/operation error/],
    [frame("progress",'{"event":"failed","ev\\u0065nt":"progress","data":'+JSON.stringify(progress)+'}'),/Duplicate.*JSON key/],
    [frame("progress",'{"event":"progress","data":{"state":"pending","state":"running"}}'),/Duplicate.*JSON key/],
    [Buffer.from("event: failed\nevent: progress\ndata: "+JSON.stringify({event:"progress",data:progress})+"\n\n"),/Duplicate.*event field/],
    [Buffer.from("event: failed\n\n"),/lacks data/],
    [Buffer.from("event: failed\n"),/Incomplete SSE/]
  ];
  for (const [bytes,error] of bad) await assert.rejects(read([bytes]),error);
});
