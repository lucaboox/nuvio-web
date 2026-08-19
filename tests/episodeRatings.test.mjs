import assert from "node:assert/strict";
import test from "node:test";
import { formatRating, imdbIdFrom } from "../src/lib/episodeRatings.ts";

// Addon ids carry episode coordinates; only the head identifies the series.
test("an episode id yields its show's imdb id", () => {
  assert.equal(imdbIdFrom("tt0944947:1:2"), "tt0944947");
  assert.equal(imdbIdFrom("tt0944947"), "tt0944947");
  assert.equal(imdbIdFrom("TT0944947"), "tt0944947");
});

test("anything that is not an imdb id is refused", () => {
  for (const value of ["", undefined, "1399", "tmdb:1399", "tt12", "kitsu:42"]) {
    assert.equal(imdbIdFrom(value), "", String(value));
  }
});

// IMDb only, by choice. A TMDB-keyed fallback answers with TMDB's vote
// average, which is a different measure and would sit under an IMDb mark.
test("a show identified only by tmdb gets no ratings rather than the wrong ones", () => {
  assert.equal(imdbIdFrom("tmdb:1399"), "");
  assert.equal(imdbIdFrom("1399"), "");
});

test("scores always read to one decimal", () => {
  assert.equal(formatRating(8.9), "8.9");
  assert.equal(formatRating(8), "8.0");
  assert.equal(formatRating(10), "10.0");
});

// Matched to the official clients' integer-tenths rounding, so one score does
// not read differently on two devices.
test("rounding goes through tenths, as the official clients do", () => {
  assert.equal(formatRating(8.25), "8.3");
  assert.equal(formatRating(8.24), "8.2");
  assert.equal(formatRating(7.96), "8.0");
});
