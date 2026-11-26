import assert from "node:assert/strict";
import {test} from "node:test";
import {createRequestDiagnostics} from "./request-diagnostics.mjs";

const origin="http://127.0.0.1:4567";
const marker="never-emit-source-path-user-id";
const classify=createRequestDiagnostics(origin,new Map([
  ["fonts/"+marker+".woff2",Buffer.alloc(1)],["dashboard.css",Buffer.alloc(1)],
]));
const req=(path,{method="GET",resource="font",error="net::ERR_ABORTED"}={})=>({
  method:()=>method,url:()=>path,resourceType:()=>resource,failure:()=>({errorText:error}),
});

test("failed requests identify known routes and trusted asset ordinals without exposing names",()=>{
  assert.equal(classify(req(origin+"/fonts/"+marker+".woff2")),"GET:asset-0002:font:aborted");
  assert.equal(classify(req(origin+"/dashboard.css",{resource:"stylesheet"})),"GET:asset-0001:stylesheet:aborted");
  assert.equal(classify(req(origin+"/wails/custom.js",{method:"HEAD",resource:"fetch"})),"HEAD:wails-optional:fetch:aborted");
  assert.equal(classify(req(origin+"/api/runtime-status",{resource:"xhr",error:"net::ERR_TIMED_OUT"})),"GET:status:xhr:timed-out");
});
test("private resource URLs, unknown paths and arbitrary failure strings never escape",()=>{
  assert.equal(classify(req(origin+"/api/runtime-status?token="+marker,{error:marker})),"GET:other:font:unclassified");
  assert.equal(classify(req("https://"+marker+".invalid/dashboard.css",{method:marker,resource:marker,error:marker})),
    "OTHER:other:other:unclassified");
  assert.equal(classify(req(origin+"/"+marker,{error:"NS_BINDING_ABORTED"})),"GET:other:font:binding-aborted");
});
