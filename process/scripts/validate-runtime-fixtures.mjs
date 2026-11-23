import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fixtures = {
  ProblemDetails: "problem-details.json",
  OperationEvent: "operation-event.json",
  MemoryItem: "memory-item.json",
  ModelCatalogResponse: "model-catalog-response.json",
};
assert.ok(process.argv[2], "Pass an OpenAPI JSON document produced by oasdiff flatten.");
const schemas = JSON.parse(readFileSync(process.argv[2], "utf8")).components.schemas;

const supportedKeywords = new Set([
  "$ref", "type", "description", "required", "properties", "items", "enum",
  "default", "format", "minimum", "maximum", "oneOf",
]);

// Validate the subset used by these fixtures against source schemas, not copies.
function check(value, schema, path) {
  assert.ok(schema && typeof schema === "object", path + ": missing schema");
  for (const key of Object.keys(schema)) {
    if (!supportedKeywords.has(key)) throw new Error(path + ": unsupported schema keyword " + key);
  }
  if (schema.$ref) {
    const prefix = "#/components/schemas/";
    assert.ok(schema.$ref.startsWith(prefix), path + ": unsupported reference");
    check(value, schemas[schema.$ref.slice(prefix.length)], path);
  }
  if (schema.oneOf) {
    let matches = 0;
    for (const option of schema.oneOf) {
      try {
        check(value, option, path);
        matches += 1;
      } catch (error) {
        if (error.code !== "ERR_ASSERTION") throw error;
      }
    }
    assert.equal(matches, 1, path + ": expected exactly one matching schema");
  }
  if (schema.type) {
    const types = [schema.type].flat();
    const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    assert.ok(types.includes(kind) || (types.includes("integer") && Number.isInteger(value)),
      path + ": expected " + types.join(" or "));
  }
  if (schema.enum) assert.ok(schema.enum.includes(value), path + ": not in enum");
  if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, path + ": below minimum");
  if (schema.maximum !== undefined) assert.ok(value <= schema.maximum, path + ": above maximum");
  if (schema.format === "date-time") assert.ok(!Number.isNaN(Date.parse(value)), path + ": invalid timestamp");
  for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value, key), path + ": missing " + key);
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if (Object.hasOwn(value, key)) check(value[key], property, path + "." + key);
  }
  if (schema.items) value.forEach((item, index) => check(item, schema.items, path + "[" + index + "]"));
}

const dir = new URL("../../contracts/runtime-api/fixtures/", import.meta.url);
for (const [name, file] of Object.entries(fixtures)) {
  const json = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
  check(json, schemas[name], file);
}
console.log("Validated " + Object.keys(fixtures).length + " Runtime golden JSON fixtures against OpenAPI.");
