import assert from "node:assert/strict";
import test from "node:test";
import { formatRating, tmdbIdFrom } from "../src/lib/episodeRatings.ts";

// The service files IMDb's scores under TMDB's id, so that is the only key it
// takes — an IMDb id returns an empty list from it.
test("a plain tmdb id is accepted", () => {
  assert.equal(tmdbIdFrom("1399"), "1399");
  assert.equal(tmdbIdFrom(" 1399 "), "1399");
});

test("anything that is not a bare tmdb id is refused", () => {
  for (const value of ["", undefined, "tt0944947", "tmdb:1399", "kitsu:42", "12a"]) {
    assert.equal(tmdbIdFrom(value), "", String(value));
  }
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
