import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import postcss from "postcss";

const picker = readFileSync(new URL("../src/components/AccentPicker.tsx", import.meta.url), "utf8");
const css = postcss.parse(readFileSync(new URL("../src/styles.css", import.meta.url), "utf8"));
test("swatches match the real theme palette and preserve all seven synced values", () => {
  const options = [...picker.matchAll(/value: "(\w+)", label: "[^"]+", color: "([^"]+)", ink: "([^"]+)"/g)];
  assert.equal(options.length, 7);
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
