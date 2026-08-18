import assert from "node:assert/strict";
import test from "node:test";

// A minimal localStorage, since this module is only ever a browser one.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { rememberBingeGroup, bingeGroupFor } = await import("../src/lib/bingeCache.ts");

test("a series remembers the source it was watched from", () => {
  rememberBingeGroup("tt0903747", "addon|1080p");
  assert.equal(bingeGroupFor("tt0903747"), "addon|1080p");
  // The newer choice replaces the older one.
  rememberBingeGroup("tt0903747", "addon|2160p");
  assert.equal(bingeGroupFor("tt0903747"), "addon|2160p");
});

test("nothing is remembered without a group to remember", () => {
  rememberBingeGroup("tt111", undefined);
  rememberBingeGroup("", "group");
  assert.equal(bingeGroupFor("tt111"), undefined);
  assert.equal(bingeGroupFor("never-seen"), undefined);
});

test("the history is bounded, keeping what was watched most recently", () => {
  store.clear();
  for (let i = 0; i < 80; i += 1) rememberBingeGroup(`tt${i}`, `g${i}`);
  const kept = Object.keys(JSON.parse(store.get("nuvio-web-binge-groups")));
  assert.equal(kept.length, 60);
  // The last written survive; the first are dropped.
  assert.equal(bingeGroupFor("tt79"), "g79");
  assert.equal(bingeGroupFor("tt0"), undefined);
});

test("a corrupt store reads as empty rather than throwing", () => {
  store.set("nuvio-web-binge-groups", "{not json");
  assert.equal(bingeGroupFor("tt0903747"), undefined);
  // And is recoverable by writing again.
  rememberBingeGroup("tt1", "g1");
  assert.equal(bingeGroupFor("tt1"), "g1");
});

test("a burst of writes evicts the oldest, not the newest", () => {
  // Every one of these lands in the same millisecond, so the timestamps are
  // identical and only the counter separates them. Ordering by time alone got
  // this backwards — and only sometimes, which is worse than always.
  store.clear();
  for (let i = 0; i < 70; i += 1) rememberBingeGroup(`s${i}`, `g${i}`);
  assert.equal(bingeGroupFor("s69"), "g69", "the newest must survive");
  assert.equal(bingeGroupFor("s9"), undefined, "the oldest must be dropped");
  assert.equal(
    Object.keys(JSON.parse(store.get("nuvio-web-binge-groups"))).length,
    60,
  );
});

test("pruning twice does not reverse the order it keeps", () => {
  // The stored order changes once a prune has rewritten it, which is what
  // made this intermittent rather than plainly wrong.
  store.clear();
  for (let i = 0; i < 65; i += 1) rememberBingeGroup(`a${i}`, `v${i}`);
  for (let i = 0; i < 65; i += 1) rememberBingeGroup(`b${i}`, `w${i}`);
  assert.equal(bingeGroupFor("b64"), "w64");
  assert.equal(bingeGroupFor("a0"), undefined);
});
