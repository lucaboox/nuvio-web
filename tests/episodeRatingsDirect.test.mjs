import assert from "node:assert/strict";
import test from "node:test";

import { toRatingMap } from "../src/lib/episodeRatings.ts";
import { toRatingMap as workerToRatingMap } from "../worker-imdb-ratings/src/index.ts";

// The upstream's own shape, as the official clients decode it.
const SEASONS = [
  {
    episodes: [
      { season_number: 1, episode_number: 1, vote_average: 8.9 },
      { season_number: 1, episode_number: 2, vote_average: 8.6 },
    ],
  },
  { episodes: [{ season_number: 2, episode_number: 1, vote_average: 7.4 }] },
];

test("a season array flattens to season:episode keys", () => {
  const ratings = toRatingMap(SEASONS);
  assert.equal(ratings.get("1:1"), 8.9);
  assert.equal(ratings.get("1:2"), 8.6);
  assert.equal(ratings.get("2:1"), 7.4);
  assert.equal(ratings.size, 3);
});

test("an unrated episode gets no badge rather than a 0.0 one", () => {
  const ratings = toRatingMap([
    {
      episodes: [
        { season_number: 1, episode_number: 1, vote_average: 0 },
        { season_number: 1, episode_number: 2, vote_average: null },
        { season_number: 1, episode_number: 3 },
        { season_number: 1, episode_number: 4, vote_average: -1 },
        { season_number: 1, episode_number: 5, vote_average: 7.1 },
      ],
    },
  ]);
  assert.deepEqual([...ratings.keys()], ["1:5"]);
});

test("an episode with no numbering is skipped", () => {
  const ratings = toRatingMap([
    {
      episodes: [
        { episode_number: 1, vote_average: 8 },
        { season_number: 1, vote_average: 8 },
        { season_number: null, episode_number: null, vote_average: 8 },
      ],
    },
  ]);
  assert.equal(ratings.size, 0);
});

test("anything that is not a season array reads as no ratings", () => {
  for (const payload of [null, undefined, {}, "", 7, { ratings: {} }])
    assert.equal(toRatingMap(payload).size, 0);
  // A season with no episodes is not an error either.
  assert.equal(toRatingMap([{}, { episodes: null }]).size, 0);
});

test("the client and the Worker flatten identically", () => {
  // The rule lives in two places because the Worker is a separate deployment
  // that cannot import from the app. A score that differed between the desktop
  // and the web because these two disagreed would be very hard to trace back
  // here, so they are compared directly.
  for (const payload of [
    SEASONS,
    [{ episodes: [{ season_number: 3, episode_number: 9, vote_average: 0 }] }],
    [{ episodes: [{ season_number: 1, episode_number: 1, vote_average: 6.05 }] }],
    "not a season array",
  ]) {
    assert.deepEqual(
      Object.fromEntries(toRatingMap(payload)),
      workerToRatingMap(payload),
    );
  }
});
