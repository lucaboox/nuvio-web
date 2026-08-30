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
  cachedStreamToSource,
  contentKey,
  getValidStreamLink,
  hasExpiringCredentials,
  removeStreamLink,
  saveStreamLink,
} = await import("../src/lib/streamLinkCache.ts");

const HOUR = 3_600_000;
const stream = (over = {}) => ({
  name: "Torbox 2160p",
  title: "Torbox 2160p",
  description: "",
  url: "https://cdn.example.com/file.mkv",
  addonName: "Torrentio",
  behaviorHints: { filename: "file.mkv", videoSize: 42, bingeGroup: "tio|2160p" },
  ...over,
});

test("a plain URL has no expiring credentials", () => {
  assert.equal(hasExpiringCredentials("https://cdn.example.com/file.mkv"), false);
  assert.equal(hasExpiringCredentials("https://cdn.example.com/f.mkv?quality=1080"), false);
});

test("signed and time-limited URLs are recognised", () => {
  for (const url of [
    "https://cdn.example.com/f.mkv?token=abc",
    "https://cdn.example.com/f.mkv?expires=1700000000",
    "https://cdn.example.com/f.mkv?X-Amz-Signature=deadbeef",
    "https://cdn.example.com/f.mkv?access_token=x",
    "https://cdn.example.com/f.mkv?sig=x&other=y",
    // Separators inside the key must not hide it.
    "https://cdn.example.com/f.mkv?auth-key=x",
    "https://cdn.example.com/f.mkv?expires_in=60",
  ])
    assert.equal(hasExpiringCredentials(url), true, url);
});

test("the fragment is not mistaken for a query", () => {
  assert.equal(hasExpiringCredentials("https://cdn.example.com/f.mkv#token=abc"), false);
});

test("an episode is keyed by its series, season and number", () => {
  assert.equal(
    contentKey("series", "tt0903747:1:1", "tt0903747", 1, 1),
    "series|tt0903747|s1|e1|tt0903747:1:1",
  );
  // A film, and an episode missing its numbering, fall back to the id alone.
  assert.equal(contentKey("Movie", "tt1375666"), "movie|tt1375666");
  assert.equal(contentKey("series", "x", "tt1", 1, undefined), "series|x");
});

test("a saved link comes back and rebuilds a playable stream", () => {
  store.clear();
  saveStreamLink("k", stream());
  const cached = getValidStreamLink("k", 24 * HOUR);
  assert.ok(cached);
  assert.equal(cached.url, "https://cdn.example.com/file.mkv");
  const source = cachedStreamToSource(cached);
  assert.equal(source.url, "https://cdn.example.com/file.mkv");
  assert.equal(source.behaviorHints.bingeGroup, "tio|2160p");
  assert.equal(source.behaviorHints.videoSize, 42);
  assert.equal(source.behaviorHints.notWebReady, false);
});

test("a credentialed link is never stored, and clears what was there", () => {
  store.clear();
  saveStreamLink("k", stream());
  assert.ok(getValidStreamLink("k", 24 * HOUR));
  // The next play resolved to a signed URL: the old entry must not stand in
  // for it, since it is the one thing the user did not choose.
  saveStreamLink("k", stream({ url: "https://cdn.example.com/f.mkv?token=abc" }));
  assert.equal(getValidStreamLink("k", 24 * HOUR), null);
});

test("a stream with nothing playable in it is not stored", () => {
  store.clear();
  saveStreamLink("k", stream({ url: undefined, infoHash: undefined }));
  assert.equal(getValidStreamLink("k", 24 * HOUR), null);
  // An infoHash alone is enough to be worth keeping.
  saveStreamLink("k", stream({ url: undefined, infoHash: "abc123", fileIdx: 2 }));
  const cached = getValidStreamLink("k", 24 * HOUR);
  assert.equal(cached?.infoHash, "abc123");
  assert.equal(cached?.fileIdx, 2);
});

test("an entry past its age is dropped rather than re-read every play", () => {
  store.clear();
  saveStreamLink("k", stream());
  const key = [...store.keys()][0];
  const entry = JSON.parse(store.get(key));
  entry.cachedAtMs = Date.now() - 25 * HOUR;
  store.set(key, JSON.stringify(entry));
  assert.equal(getValidStreamLink("k", 24 * HOUR), null);
  assert.equal(store.has(key), false);
});

test("a zero window disables reuse without touching what is stored", () => {
  store.clear();
  saveStreamLink("k", stream());
  assert.equal(getValidStreamLink("k", 0), null);
  assert.ok(getValidStreamLink("k", 24 * HOUR));
});

test("unreadable JSON evicts itself", () => {
  store.clear();
  saveStreamLink("k", stream());
  store.set([...store.keys()][0], "{ not json");
  assert.equal(getValidStreamLink("k", 24 * HOUR), null);
  assert.equal(store.size, 0);
});

test("removing a link forgets it", () => {
  store.clear();
  saveStreamLink("k", stream());
  removeStreamLink("k");
  assert.equal(getValidStreamLink("k", 24 * HOUR), null);
});

test("a full store does not break playback", () => {
  const setItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  assert.doesNotThrow(() => saveStreamLink("k", stream()));
  globalThis.localStorage.setItem = setItem;
});
