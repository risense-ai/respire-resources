import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const fixture = JSON.parse(await readFile(new URL("../fixtures/i18n/transport.json", import.meta.url), "utf8"));
export const minimumBytes = 100 * 1024;

export function wire(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

export function payload(channel, locale = "zh") {
  assert(["en", "zh"].includes(locale), "Unsupported transport locale");
  const title = "card018-utf8-" + channel + "-" + locale;
  const entry = {index: 0, text: locale === "en" ? fixture.englishSegment : fixture.segment};
  const content = JSON.stringify({
    marker: title,
    notebook: {entries: Array.from({length: 1500}, (_, index) => ({...entry, index}))},
    end: title
  });
  return {title, content};
}

export function exactBytes(actual, expected) {
  assert.equal(typeof actual, "string", "Recalled content must be a string");
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  assert.equal(actualBytes.length, expectedBytes.length, "UTF-8 byte length changed");
  assert(actualBytes.equals(expectedBytes), "UTF-8 bytes changed");
}

export async function httpRoundTrip(target, locale = "zh") {
  const note = payload("http", locale);
  const body = {...note, tags: ["card018", "utf8"]};
  const bytes = wire(body).length;
  assert(bytes > minimumBytes, "HTTP body must exceed 100 KiB");
  const stored = await target.request({method: "POST", path: "/v1/memories", body});
  assert.equal(stored.status, 201);
  assert(typeof stored.data.id === "string" && stored.data.id, "Missing stored memory ID");
  const response = await target.request({
    method: "POST", path: "/v1/memories/recall", body: {query: note.title, top_k: 10}
  });
  assert.equal(response.status, 200);
  const hit = response.data.hits.find(({memory}) => memory.id === stored.data.id);
  assert(hit, "Recall did not return the stored HTTP memory ID");
  exactBytes(hit.memory.content, note.content);
  return bytes;
}

export async function httpBurst(target) {
  async function pair(index) {
    const content = "card018-burst-note-" + index + "-end";
    const saved = await target.request({method: "POST", path: "/v1/memories", body: {content}});
    assert.equal(saved.status, 201);
    const recalled = await target.request({method: "POST", path: "/v1/memories/recall", body: {query: content}});
    assert.equal(recalled.status, 200);
    const hit = recalled.data.hits.find(({memory}) => memory.id === saved.data.id);
    assert.equal(hit?.memory.content, content, "Persisted burst marker missing: " + index);
    return saved.data.id;
  }
  const results = await Promise.allSettled(Array.from({length: 4}, (_, index) => pair(index)));
  const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, "HTTP store/recall burst failed");
  assert.equal(new Set(results.map(result => result.value)).size, results.length, "Concurrent stores reused memory IDs");
}
