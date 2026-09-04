import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import postcss from "postcss";

const css = postcss.parse(readFileSync(new URL("../src/styles.css", import.meta.url), "utf8"));
function declarations(selector, property) {
  const result = [];
  css.walkRules(rule => {
    if (rule.selectors.includes(selector)) rule.walkDecls(property, decl => result.push(decl.value));
  });
  return result;
}
test("all loading ring heads and SVG loaders use the selected accent", () => {
  for (const selector of [".mini-spinner", ".detail-entry-loading-content .mini-spinner", ".nuvio-loading-spinner", ".calendar-sync i", ".calendar-month-loading i"]) {
    assert.match(declarations(selector, "border-top-color").at(-1), /var\(--accent/);
  }
  for (const selector of [".spin", ".spin-icon", ".crate-spinner"]) {
    assert.equal(declarations(selector, "color").at(-1), "var(--accent)");
  }
});
test("WebKit and Firefox seek/volume tracks, thumbs and primary controls use theme tokens", () => {
  for (const selector of [
    '.player-view input[type="range"]::-webkit-slider-runnable-track',
    '.player-view input[type="range"]::-webkit-slider-thumb',
    '.player-view input[type="range"]::-moz-range-progress',
    '.player-view input[type="range"]::-moz-range-thumb',
    '.volume-slider::-webkit-slider-runnable-track',
    '.player-control-group .player-play', '.audio-menu > button.selected', '.player-next button.primary',
  ]) assert.match(declarations(selector, "background").at(-1), /var\(--accent\)/);
  assert.equal(declarations('.player-control-group .player-play', 'color').at(-1), 'var(--accent-ink)');
});
test("both player locations use solid playback glyphs, not outline icons", () => {
  const player = readFileSync(new URL("../src/components/Player.tsx", import.meta.url), "utf8");
  const icons = readFileSync(new URL("../src/components/PlaybackIcons.tsx", import.meta.url), "utf8");
  assert.equal((player.match(/<SolidPlay \/>/g) ?? []).length, 2);
  assert.match(player, /playing \? <SolidPause \/> : <SolidPlay \/>/);
  assert.equal((icons.match(/fill="currentColor" stroke="none"/g) ?? []).length, 2);
});
