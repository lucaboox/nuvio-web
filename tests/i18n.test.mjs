import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const dir = fileURLToPath(new URL("../src/locales/", import.meta.url));
const en = JSON.parse(readFileSync(join(dir, "en.json"), "utf8"));

test("english is the complete set of keys", () => {
  // Every other locale is a subset: t() falls back to English, so a key that
  // exists only in a translation would never be reachable.
  for (const file of readdirSync(dir).filter((f) => f !== "en.json")) {
    const locale = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const extra = Object.keys(locale).filter((key) => !(key in en));
    assert.deepEqual(extra, [], `${file} has keys English does not`);
  }
});

test("placeholders survive translation", () => {
  // A translation that dropped {season} or {count} renders a sentence with a
  // hole in it, and nothing else would catch that.
  const holes = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const file of readdirSync(dir).filter((f) => f !== "en.json")) {
    const locale = JSON.parse(readFileSync(join(dir, file), "utf8"));
    for (const [key, value] of Object.entries(locale))
      assert.deepEqual(
        holes(value),
        holes(en[key]),
        `${file} → ${key} does not carry the same placeholders`,
      );
  }
});

test("plural keys come in complete sets", () => {
  // English needs one and other; a language with more forms may add them, but
  // the two English uses must both exist or a count renders as its key.
  const bases = new Set(
    Object.keys(en)
      .filter((key) => /\.(one|other)$/.test(key))
      .map((key) => key.replace(/\.(one|other)$/, "")),
  );
  for (const base of bases) {
    assert.ok(`${base}.one` in en, `${base}.one is missing`);
    assert.ok(`${base}.other` in en, `${base}.other is missing`);
  }
});
