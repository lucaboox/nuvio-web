import assert from "node:assert/strict";
import { parseNativeSkipSegments } from "../src/lib/skipSegments.ts";
import test from "node:test";

test("native provider aliases become the same skip categories as browser timings", () => {
  assert.deepEqual(parseNativeSkipSegments([
    { startMs: 10000, endMs: 60000, type: "op" },
    { startMs: 900000, endMs: 1000000, type: "mixed-ed" },
    { startMs: -1, endMs: 5, type: "intro" },
  ]), [{ kind: "intro", start: 10, end: 60 }, { kind: "credits", start: 900, end: 1000 }]);
});
import {
  activeSkipSegment,
  creditsStart,
  parseSkipSegments,
} from "../src/lib/skipSegments.ts";

// Shapes taken from real answers, including the two nullable ends.
const BREAKING_BAD = {
  tmdb_id: 1396, type: "tv", season: 1, episode: 1,
  intro: [{ start_ms: 228710, end_ms: 246194 }],
  credits: [{ start_ms: 3431000, end_ms: null }],
};
const GOT = {
  intro: [{ start_ms: null, end_ms: 113411 }],
  credits: [{ start_ms: 3082000, end_ms: 3160000 }],
};
const ANIME = {
  intro: [{ start_ms: 43653, end_ms: 135522 }],
  recap: [{ start_ms: 0, end_ms: 42000 }],
  credits: [{ start_ms: 1345005, end_ms: 1434975 }],
};

test("intervals are read in seconds", () => {
  const [intro] = parseSkipSegments(BREAKING_BAD);
  assert.equal(intro.kind, "intro");
  assert.equal(Math.round(intro.start), 229);
  assert.equal(Math.round(intro.end), 246);
});

test("a missing start means the segment begins with the file", () => {
  const [intro] = parseSkipSegments(GOT);
  assert.equal(intro.start, 0);
  assert.equal(Math.round(intro.end), 113);
});

test("a missing end means the segment runs to the end of the file", () => {
  const credits = parseSkipSegments(BREAKING_BAD).find((s) => s.kind === "credits");
  assert.equal(credits.end, Number.POSITIVE_INFINITY);
  // Not zero, which would have put it at the start of the episode.
  assert.ok(credits.start > 3000);
});

test("every kind the service returns is read", () => {
  const kinds = parseSkipSegments(ANIME).map((s) => s.kind).sort();
  assert.deepEqual(kinds, ["credits", "intro", "recap"]);
});

test("nonsense and empty answers yield nothing rather than throwing", () => {
  for (const payload of [null, undefined, {}, "no", 7, { error: "nope" }])
    assert.deepEqual(parseSkipSegments(payload), []);
  // A zero-length or reversed interval is not a segment.
  assert.deepEqual(parseSkipSegments({ intro: [{ start_ms: 500, end_ms: 500 }] }), []);
  assert.deepEqual(parseSkipSegments({ intro: [{ start_ms: 900, end_ms: 100 }] }), []);
});

test("the button shows inside an intro and not outside it", () => {
  const segments = parseSkipSegments(BREAKING_BAD);
  assert.equal(activeSkipSegment(segments, 100), null);
  assert.equal(activeSkipSegment(segments, 230)?.kind, "intro");
  assert.equal(activeSkipSegment(segments, 300), null);
});

test("recaps are offered and credits are not", () => {
  const segments = parseSkipSegments(ANIME);
  assert.equal(activeSkipSegment(segments, 10)?.kind, "recap");
  assert.equal(activeSkipSegment(segments, 60)?.kind, "intro");
  // Skipping the credits would run to the end of the file, which is not a
  // skip — that is what the next-episode card is for.
  assert.equal(activeSkipSegment(segments, 1_400_000), null);
});

test("the button goes away just before the intro ends", () => {
  const segments = parseSkipSegments(GOT);
  assert.equal(activeSkipSegment(segments, 112)?.kind, "intro");
  assert.equal(activeSkipSegment(segments, 112.5), null);
});

test("the credits mark where the next episode can be offered", () => {
  assert.equal(Math.round(creditsStart(parseSkipSegments(GOT))), 3082);
  assert.equal(creditsStart(parseSkipSegments({ intro: [{ start_ms: 0, end_ms: 10 }] })), null);
});
