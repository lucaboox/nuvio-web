import assert from "node:assert/strict";
import test from "node:test";

// A minimal localStorage, since this module is only ever a browser one.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const {
  announceExternalAnswer,
  readExternalAnswer,
  readExternalHandoff,
  rememberExternalHandoff,
} = await import("../src/lib/externalHandoff.ts");

const meta = { id: "tt0386676", type: "series", name: "The Office" };

test("a hand-off is told apart by when it was made", () => {
  const at = rememberExternalHandoff(0, meta);
  assert.equal(typeof at, "number");
  assert.equal(readExternalHandoff().at, at);
});

test("another tab's answer is read back for the same hand-off", () => {
  const report = { outcome: "stopped", positionMs: 83_000, durationMs: 1_320_000 };
  announceExternalAnswer(1_000, report);
  assert.deepEqual(readExternalAnswer(1_000), report);
  announceExternalAnswer(1_000, { outcome: "dismissed" });
  assert.deepEqual(readExternalAnswer(1_000), { outcome: "dismissed" });
});

test("an answer to an earlier hand-off is not taken for a later one", () => {
  announceExternalAnswer(1_000, { outcome: "finished" });
  assert.equal(readExternalAnswer(2_000), null);
});

test("nothing stored, or something unreadable, is no answer", () => {
  store.clear();
  assert.equal(readExternalAnswer(1_000), null);
  store.set("nuvio-external-answer", "{not json");
  assert.equal(readExternalAnswer(1_000), null);
});

test("a store that refuses writes costs the answer, not the caller", () => {
  const setItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  assert.doesNotThrow(() => announceExternalAnswer(1_000, { outcome: "finished" }));
  assert.equal(typeof rememberExternalHandoff(0, meta), "number");
  globalThis.localStorage.setItem = setItem;
});
