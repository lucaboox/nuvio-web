import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import postcss from "postcss";

const picker = readFileSync(new URL("../src/components/AccentPicker.tsx", import.meta.url), "utf8");
// The palette itself moved to a data module so the settings parser can share
// it without a lib importing a component.
const palette = readFileSync(new URL("../src/lib/accents.ts", import.meta.url), "utf8");
const css = postcss.parse(readFileSync(new URL("../src/styles.css", import.meta.url), "utf8"));
test("swatches match the real theme palette and preserve all seven synced values", () => {
  // Multi-line entries too: the gradient accents carry a `swatch` after `ink`,
  // so the pattern stops at `ink` rather than assuming the object ends there.
  const options = [...palette.matchAll(/value: "(\w+)", label: "[^"]+",\s*color: "([^"]+)", ink: "([^"]+)"/g)];
  // Every option must be backed by real tokens; the count itself is not the
  // point, and pinning it meant adding an accent failed here rather than where
  // an accent would actually be wrong.
  assert.ok(options.length >= 7, `only ${options.length} options parsed`);
  for (const [, value, color, ink] of options) {
    const selector = value === "WHITE" ? ":root" : `:root[data-nuvio-accent="${value.toLowerCase()}"]`;
    const tokens = {};
    css.walkRules(selector, rule => rule.walkDecls(decl => tokens[decl.prop] = decl.value));
    assert.equal(color, tokens["--accent"], value);
    assert.equal(ink, tokens["--accent-ink"], value);
  }
});
test("picker is a named native radio group, fits narrow screens and keeps the existing sync method", () => {
  assert.match(picker, /<fieldset[^>]*disabled=\{disabled\}/);
  assert.match(picker, /type="radio" name=\{name\}/);
  assert.match(picker, /checked=\{value === option.value\}/);
  assert.doesNotMatch(picker, /<Check/);
  let outline;
  css.walkRules(".accent-choice input:checked + .accent-swatch", rule => rule.walkDecls("outline", decl => outline = decl.value));
  assert.equal(outline, "2px solid var(--swatch-color)");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /onChange=\{\(value\) => onTypedSetting\("theme_settings", "selected_theme", "string", value\)\}/);
  let columns;
  css.walkRules(".accent-options", rule => rule.walkDecls("grid-template-columns", decl => columns = decl.value));
  assert.equal(columns, "repeat(auto-fit, minmax(64px, 1fr))");
});
