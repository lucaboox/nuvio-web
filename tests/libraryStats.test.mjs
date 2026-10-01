import assert from "node:assert/strict";
import test from "node:test";
import { tallyWatched } from "../src/lib/libraryStats.ts";

test("the library's watched count follows the poster badges, per type", () => {
  const items = [
    { id: "tt1", type: "movie" },
    { id: "tt2", type: "movie" },
    { id: "tt3", type: "series" },
    { id: "tt4", type: "series" },
    { id: "tt5", type: "series" },
    { id: "ch1", type: "channel" },
  ];
  // An episode mark alone does not make the show watched.
  const watched = new Set(["tt1", "tt3", "tt4:s1e1", "ch1"]);
  const tally = tallyWatched(items, watched);
  assert.deepEqual(tally.movie, { watched: 1, total: 2 });
  assert.deepEqual(tally.series, { watched: 1, total: 3 });
  assert.deepEqual(tally.all, { watched: 3, total: 6 });
  assert.deepEqual(tallyWatched([], watched).all, { watched: 0, total: 0 });
});
