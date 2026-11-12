import assert from "node:assert/strict";
import test from "node:test";
import { parseSeasonPosters } from "../src/lib/seasonPosters.ts";

test("AIOMetadata's keyed season posters are read by season number", () => {
  const posters = parseSeasonPosters(
    { seasonPosters: { "0": "https://a/0.jpg", "1": "https://a/1.jpg", x: "https://a/x.jpg", "2": " " } },
    [0, 1, 2],
  );
  assert.deepEqual(posters, { 0: "https://a/0.jpg", 1: "https://a/1.jpg" });
  assert.deepEqual(
    parseSeasonPosters({ seasonPosterByNumber: { "3": "https://a/3.jpg" } }, [3]),
    { 3: "https://a/3.jpg" },
  );
});

test("an array is lined up against the seasons the title has", () => {
  // One per season, specials included.
  assert.deepEqual(parseSeasonPosters({ seasonPosters: ["s0", "s1"] }, [0, 1, 1]), { 0: "s0", 1: "s1" });
  // One per real season.
  assert.deepEqual(parseSeasonPosters({ seasonPosters: ["s1", "s2"] }, [0, 1, 2]), { 1: "s1", 2: "s2" });
  // An empty slot standing in for specials.
  assert.deepEqual(parseSeasonPosters({ seasonPosters: [null, "s1"] }, [1]), { 1: "s1" });
  // Nothing to line up against: from season 1.
  assert.deepEqual(parseSeasonPosters({ seasonPosters: ["a", "b"] }, []), { 1: "a", 2: "b" });
  assert.deepEqual(parseSeasonPosters({}, [1, 2]), {});
});
