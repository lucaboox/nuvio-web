import assert from "node:assert/strict";
import test from "node:test";

import { languageName } from "../src/lib/languageName.ts";

test("two- and three-letter codes become names", () => {
  assert.equal(languageName("en"), "English");
  assert.equal(languageName("es"), "Spanish");
  assert.equal(languageName("ja"), "Japanese");
});

test("regional and underscored forms resolve too", () => {
  // Addons and mpv are inconsistent about which shape they hand back.
  assert.match(languageName("en-US"), /English/);
  assert.match(languageName("pt_BR"), /Portuguese/);
});

test("a name that is already a name is left alone", () => {
  assert.equal(languageName("English"), "English");
  assert.equal(languageName("Brazilian Portuguese"), "Brazilian Portuguese");
});

test("anything unnameable comes back as it arrived", () => {
  // A track labelled "SDH" or "Forced" is not a language and must not be
  // mangled into one.
  assert.equal(languageName("SDH"), "SDH");
  assert.equal(languageName("Forced"), "Forced");
  assert.equal(languageName(""), "");
  assert.equal(languageName(undefined), "");
});

test("the first letter is capitalised", () => {
  assert.equal(languageName("english"), "English");
});
