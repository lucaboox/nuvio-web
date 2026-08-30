import assert from "node:assert/strict";
import test from "node:test";

// A minimal localStorage, since this module is only ever a browser one.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { clearRecentSearches, forgetSearch, readRecentSearches, rememberSearch } =
  await import("../src/lib/recentSearches.ts");

test("the most recent search comes first", () => {
  clearRecentSearches();
  rememberSearch("dune");
  rememberSearch("arrival");
  assert.deepEqual(readRecentSearches(), ["arrival", "dune"]);
});

test("searching the same thing again moves it up rather than duplicating it", () => {
  clearRecentSearches();
  rememberSearch("dune");
  rememberSearch("arrival");
  rememberSearch("DUNE");
  assert.deepEqual(readRecentSearches(), ["DUNE", "arrival"]);
});

test("surrounding space is not a different search", () => {
  clearRecentSearches();
  rememberSearch("  dune  ");
  assert.deepEqual(readRecentSearches(), ["dune"]);
});

test("an empty search is not history", () => {
  clearRecentSearches();
  rememberSearch("   ");
  rememberSearch("");
  assert.deepEqual(readRecentSearches(), []);
});

test("history is capped at ten, keeping the newest", () => {
  clearRecentSearches();
  for (let i = 0; i < 15; i += 1) rememberSearch(`q${i}`);
  const entries = readRecentSearches();
  assert.equal(entries.length, 10);
  assert.equal(entries[0], "q14");
  assert.equal(entries.at(-1), "q5");
});

test("one entry can be forgotten without clearing the rest", () => {
  clearRecentSearches();
  rememberSearch("dune");
  rememberSearch("arrival");
  assert.deepEqual(forgetSearch("dune"), ["arrival"]);
  assert.deepEqual(readRecentSearches(), ["arrival"]);
});

test("junk in the store reads as no history", () => {
  store.set("nuvio.recentSearches", "{ not json");
  assert.deepEqual(readRecentSearches(), []);
  // A well-formed array of the wrong thing is filtered, not trusted.
  store.set("nuvio.recentSearches", JSON.stringify(["dune", 42, null]));
  assert.deepEqual(readRecentSearches(), ["dune"]);
  store.set("nuvio.recentSearches", JSON.stringify({ dune: true }));
  assert.deepEqual(readRecentSearches(), []);
});

test("a full store does not break search", () => {
  const setItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  assert.doesNotThrow(() => rememberSearch("dune"));
  globalThis.localStorage.setItem = setItem;
});
