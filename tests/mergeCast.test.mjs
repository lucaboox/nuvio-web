import assert from "node:assert/strict";
import test from "node:test";

import { mergeCast } from "../src/lib/metadataEnrichment.ts";

const addon = [
  { name: "Alan Ritchson", role: "Jack Reacher" },
  { name: "Maria Sten" },
];
const tmdb = [
  { name: "Alan Ritchson", role: "Reacher", photo: "a.jpg", tmdbId: 1 },
  { name: "Maria Sten", role: "Frances Neagley", photo: "m.jpg", tmdbId: 2 },
  { name: "Serinda Swan", role: "Karla Dixon", photo: "s.jpg", tmdbId: 3 },
];

test("the addon decides who appears and in what order", () => {
  // The official client shows the addon's list; ours used to replace it with
  // TMDB's, which is why it showed a different number of actors.
  const merged = mergeCast(addon, tmdb);
  assert.equal(merged[0].name, "Alan Ritchson");
  assert.equal(merged[1].name, "Maria Sten");
});

test("what the addon left out is filled in, not overwritten", () => {
  const merged = mergeCast(addon, tmdb);
  // The addon's own character name wins where it has one.
  assert.equal(merged[0].role, "Jack Reacher");
  // Everything it lacked comes from TMDB — including the id, without which the
  // person page cannot be opened at all.
  assert.equal(merged[0].photo, "a.jpg");
  assert.equal(merged[0].tmdbId, 1);
  assert.equal(merged[1].role, "Frances Neagley");
  assert.equal(merged[1].tmdbId, 2);
});

test("someone only TMDB knows about is appended, not dropped", () => {
  const merged = mergeCast(addon, tmdb);
  assert.equal(merged.length, 3);
  assert.equal(merged[2].name, "Serinda Swan");
});

test("punctuation and case do not prevent a match", () => {
  const merged = mergeCast(
    [{ name: "J.K. Simmons" }],
    [{ name: "J. K. SIMMONS", photo: "j.jpg", tmdbId: 9 }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].tmdbId, 9);
  assert.equal(merged[0].name, "J.K. Simmons");
});

test("either side missing falls back to the other", () => {
  assert.deepEqual(mergeCast([], tmdb), tmdb);
  assert.deepEqual(mergeCast(addon, []), addon);
  assert.deepEqual(mergeCast([], []), []);
});

test("a duplicate name in the addon list does not duplicate the TMDB entry", () => {
  const merged = mergeCast(
    [{ name: "Alan Ritchson" }, { name: "Alan Ritchson" }],
    [{ name: "Alan Ritchson", tmdbId: 1 }],
  );
  // Both addon rows are kept — the addon's list is authoritative — but the
  // TMDB entry is consumed once and not appended again on the end.
  assert.equal(merged.length, 2);
  assert.equal(merged[0].tmdbId, 1);
  assert.equal(merged[1].tmdbId, undefined);
});
