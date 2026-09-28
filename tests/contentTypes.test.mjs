import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isTitleType } from "../src/lib/contentTypes.ts";

test("collection catalogs are not titles", () => {
  // Published by some metadata addons as their own type, which then showed
  // up in Discover as a "Collections" entry that could never be opened.
  for (const type of ["collection", "collections", "Collections", " collections "])
    assert.equal(isTitleType(type), false, type);
  for (const type of ["movie", "series", "anime", "tv", "channel"])
    assert.equal(isTitleType(type), true, type);
});

test("Discover applies it before anything else about a catalog", () => {
  const source = readFileSync(new URL("../src/lib/addons.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!isTitleType\(catalog\.type\) \|\| !supportsDiscover\(catalog\)\) continue;/);
});
