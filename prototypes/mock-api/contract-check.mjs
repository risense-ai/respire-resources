import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// Parse the canonical document's indentation/flow-scalar subset; reject unsupported syntax.
function scalar(text) {
  if (text.startsWith("[")) {
    assert.ok(text.endsWith("]"));
    return text.slice(1,-1).split(",").filter(s=>s.trim()).map(s=>scalar(s.trim()));
  }
  if (text.startsWith('"')) return JSON.parse(text);
  if (text === "true" || text === "false") return text === "true";
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  assert.ok(!/^[{&*!>|]/.test(text),"Unsupported scalar: " + text);
  return text;
}
function mapping(lines, start, indent) {
  const value = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const depth = line.length - line.trimStart().length;
    if (depth < indent) break;
    assert.equal(depth,indent,"Unexpected indentation: " + line);
    const match = /^\s*([^:]+):(?: (.*))?$/.exec(line);
    assert.ok(match,"Unsupported mapping: " + line);
    const key = match[1].replace(/^"|"$/g,"");
    const rest = match[2];
    i++;
    if (rest === "|") {
      const text = [];
      while (i < lines.length && (!lines[i].trim() || lines[i].search(/\S/) > indent)) text.push(lines[i++].trim());
      value[key] = text.join("\n");
    } else if (rest !== undefined) value[key] = scalar(rest);
    else if (lines[i]?.trimStart().startsWith("- ")) {
      const list = [];
      while (i < lines.length && lines[i].startsWith(" ".repeat(indent+2) + "- ")) {
        const item = lines[i++].trim().slice(2);
        const pair = /^([^:]+): (.*)$/.exec(item);
        assert.ok(pair,"Unsupported list item: " + item);
        list.push({[pair[1]]:scalar(pair[2])});
      }
      value[key] = list;
    } else {
      const nested = mapping(lines,i,indent+2);
      value[key] = nested.value;
      i = nested.next;
    }
  }
  return {value,next:i};
}
const source = readFileSync(new URL("../../contracts/runtime-api/openapi.yaml",import.meta.url),"utf8").replaceAll("\r\n","\n");
const schemasText = source.slice(source.indexOf("  schemas:\n") + "  schemas:\n".length);
export const schemas = mapping(schemasText.split(/\r?\n/),0,4).value;
export const methods = new Map();
for (const pathMatch of source.matchAll(/^  (\/v1\/[^:]+):\r?\n([\s\S]*?)(?=^  \/v1\/|^components:)/gm)) {
  for (const op of pathMatch[2].matchAll(/^    (get|post|patch|delete):\r?\n([\s\S]*?)(?=^    (?:get|post|patch|delete):|(?![\s\S]))/gm)) {
    const responses = {};
    const responseText = op[2].split("      responses:")[1];
    assert.ok(responseText,"Missing responses");
    for (const r of responseText.matchAll(/^        ("\d+"|default):\r?\n([\s\S]*?)(?=^        (?:"\d+"|default):|(?![\s\S]))/gm)) {
      const status = r[1].replaceAll('"',"");
      const media = /^            ([\w+.-]+\/[\w+.-]+):/m.exec(r[2])?.[1];
      const ref = /\$ref: "#\/components\/(schemas|responses)\/([^"\n]+)"/.exec(r[2]);
      responses[status] = ref?.[1] === "responses" ? {media:"application/problem+json",schema:{$ref:"#/components/schemas/ProblemDetails"}} :
        {media,schema:ref ? {$ref:"#/components/schemas/"+ref[2]} : media ? {type:"string",format:"binary"} : undefined};
    }
    const request = op[2].split("      responses:")[0].split("      requestBody:")[1];
    const requestRef = request && /\$ref: "#\/components\/schemas\/([^"\n]+)"/.exec(request)?.[1];
    methods.set(op[1].toUpperCase()+" "+pathMatch[1],{responses,requestSchema:requestRef ? {$ref:"#/components/schemas/"+requestRef} : undefined,scope:/x-respire-required-scope: "([^"]+)"/.exec(op[2])?.[1]});
  }
}
export function validate(value, schema) {
  if (schema.$ref) return validate(value,schemas[schema.$ref.split("/").at(-1)]);
  if (schema.oneOf) {
    let matches = 0;
    for (const option of schema.oneOf) { try { validate(value,option); matches++; } catch (e) { if (!(e instanceof assert.AssertionError)) throw e; } }
    assert.equal(matches,1); return;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  assert.ok(types.some(t => t === "null" ? value === null : t === "array" ? Array.isArray(value) : t === "integer" ? Number.isInteger(value) : t === "object" ? !!value && typeof value === "object" && !Array.isArray(value) : typeof value === t),"Invalid type " + schema.type);
  if (value === null) return;
  if (schema.enum) assert.ok(schema.enum.includes(value));
  if (schema.type === "object") {
    for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value,key),"Missing " + key);
    for (const [key,item] of Object.entries(value)) {
      if (schema.properties?.[key]) validate(item,schema.properties[key]);
      else assert.notEqual(schema.additionalProperties,false,"Unexpected " + key);
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) validate(item,schema.items);
    if (schema.minItems !== undefined) assert.ok(value.length >= schema.minItems);
    if (schema.maxItems !== undefined) assert.ok(value.length <= schema.maxItems);
    if (schema.uniqueItems) assert.equal(new Set(value.map(v=>JSON.stringify(v))).size,value.length);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined) assert.ok(value >= schema.minimum);
    if (schema.maximum !== undefined) assert.ok(value <= schema.maximum);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined) assert.ok(value.length >= schema.minLength);
    if (schema.pattern) assert.match(value,new RegExp(schema.pattern));
    if (schema.format === "uuid") assert.match(value,/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i);
    if (schema.format === "date-time") { assert.match(value,/^\d{4}-\d\d-\d\dT/); assert.ok(Number.isFinite(Date.parse(value))); }
    if (schema.format === "date") assert.match(value,/^\d{4}-\d\d-\d\d$/);
  }
}
