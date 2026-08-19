import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBaseUrl, toRatingMap } from "../worker-imdb-ratings/src/index.ts";

// Shape taken from the DTOs the official clients decode.
const SEASONS = [
  {
    episodes: [
      { season_number: 1, episode_number: 1, vote_average: 8.9 },
      { season_number: 1, episode_number: 2, vote_average: 8.6 },
    ],
  },
  {
    episodes: [{ season_number: 2, episode_number: 1, vote_average: 9.1 }],
  },
];

test("seasons flatten to season:episode keys", () => {
  assert.deepEqual(toRatingMap(SEASONS), {
    "1:1": 8.9,
    "1:2": 8.6,
    "2:1": 9.1,
  });
});

// A zero means nobody has rated it, not that it scored zero — a 0.0 badge on
// an unaired episode is worse than no badge.
test("unrated episodes are dropped rather than shown as zero", () => {
  const map = toRatingMap([
    { episodes: [{ season_number: 1, episode_number: 1, vote_average: 0 }] },
  ]);
  assert.deepEqual(map, {});
});

test("episodes missing their numbers are skipped", () => {
  const map = toRatingMap([
    {
      episodes: [
        { episode_number: 1, vote_average: 8 },
        { season_number: 1, vote_average: 8 },
        { season_number: 1, episode_number: 3, vote_average: 8 },
      ],
    },
  ]);
  assert.deepEqual(map, { "1:3": 8 });
});

test("a season with no episodes is not an error", () => {
  assert.deepEqual(toRatingMap([{ episodes: null }, {}]), {});
});

test("season zero and its specials are kept", () => {
  const map = toRatingMap([
    { episodes: [{ season_number: 0, episode_number: 1, vote_average: 7.4 }] },
  ]);
  assert.deepEqual(map, { "0:1": 7.4 });
});

test("anything that is not a list of seasons yields nothing", () => {
  for (const payload of [null, undefined, {}, "", 0, { episodes: [] }]) {
    assert.deepEqual(toRatingMap(payload), {}, String(payload));
  }
});

test("a non-numeric score is refused rather than coerced", () => {
  const map = toRatingMap([
    {
      episodes: [
        { season_number: 1, episode_number: 1, vote_average: "8.9" },
        { season_number: 1, episode_number: 2, vote_average: null },
        { season_number: 1, episode_number: 3, vote_average: Number.NaN },
      ],
    },
  ]);
  assert.deepEqual(map, {});
});

// cmd.exe keeps the quotes when echoing into `wrangler secret put`, so the
// stored value builds a URL that cannot parse. Cheaper to strip than to
// expect everyone to know which shell they are in.
test("a base url survives shell quoting", () => {
  assert.equal(normalizeBaseUrl('"https://ratings.example"'), "https://ratings.example");
  assert.equal(normalizeBaseUrl("'https://ratings.example'"), "https://ratings.example");
  assert.equal(normalizeBaseUrl(' "https://ratings.example" '), "https://ratings.example");
});

test("trailing slashes and blanks are handled too", () => {
  assert.equal(normalizeBaseUrl("https://ratings.example/"), "https://ratings.example");
  assert.equal(normalizeBaseUrl('"https://ratings.example/"'), "https://ratings.example");
  assert.equal(normalizeBaseUrl(""), "");
  assert.equal(normalizeBaseUrl(undefined), "");
  assert.equal(normalizeBaseUrl('""'), "");
});
