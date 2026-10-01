import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { menuPosition, readOptions } from "../src/lib/selectMenu.ts";
import { tooltipPosition } from "../src/lib/tooltip.ts";

const view = { width: 1280, height: 800 };

test("options are read through the conditionals they are written with", () => {
  // What `Children.toArray` is for: a list is almost never a flat run of
  // literal elements, and an option that never reached the menu would be a
  // value you could hold but not choose.
  // Real elements, not a hand-rolled shape: React identifies its own by a
  // symbol that has changed name between versions, and a fake one is read as
  // a plain object and thrown out.
  const option = (value, label, disabled) =>
    createElement("option", { key: value, value, disabled }, label);
  const options = readOptions([
    option("all", "All seasons"),
    [option("1", "Season 1"), option("2", "Season 2")],
    false,
    null,
    option("0", "Specials", true),
    "stray text",
  ]);
  assert.deepEqual(
    options.map((entry) => entry.value),
    ["all", "1", "2", "0"],
  );
  assert.equal(options[0].label, "All seasons");
  assert.equal(options[3].disabled, true);
  assert.equal(options[1].disabled, false);
});

test("a label built from several children is joined as the DOM joins it", () => {
  // `<option>Season {value}</option>` is two children, and `String()` on that
  // array is the array's own join: "Season ,1". The native list read correctly
  // the whole time, so only the drawn one grew commas.
  const options = readOptions([
    createElement("option", { key: 1, value: 1 }, "Season ", 1),
    createElement("option", { key: "t", value: "trailers" }, "Trailers", " (", 3, ")"),
    // Nested elements contribute their own text, and nothing renderless
    // contributes "[object Object]" or "false".
    createElement(
      "option",
      { key: "n", value: "n" },
      createElement("span", null, "Deep"),
      false,
      null,
      " text",
    ),
  ]);
  assert.deepEqual(
    options.map((entry) => entry.label),
    ["Season 1", "Trailers (3)", "Deep text"],
  );
});

test("an option with no value of its own is named by its text", () => {
  const options = readOptions([
    createElement("option", { key: "a" }, "Not supported"),
  ]);
  assert.equal(options[0].value, "Not supported");
});

test("a list opens downwards, and upwards only when it would not fit", () => {
  const field = { top: 100, bottom: 140, left: 40, width: 200 };
  assert.equal(menuPosition(field, 200, view).top, 144);

  // Near the bottom there is no room underneath, so it goes above the field
  // rather than off the window.
  const low = { top: 700, bottom: 740, left: 40, width: 200 };
  assert.equal(menuPosition(low, 200, view).top, 496);
});

test("a list is never narrower than readable, nor off the side", () => {
  const narrow = { top: 10, bottom: 50, left: 20, width: 60 };
  assert.equal(menuPosition(narrow, 100, view).width, 160);

  // A field against the right edge opens a list that stays on screen.
  const edge = { top: 10, bottom: 50, left: 1240, width: 200 };
  const placed = menuPosition(edge, 100, view);
  assert.ok(placed.left + placed.width <= view.width, "runs off the right");
  assert.ok(placed.left >= 8, "runs off the left");
});

test("a tooltip trails the cursor, as the platform's does", () => {
  // Below and to the right, not centred over the control: centring reads as a
  // popover the page put there rather than as the pointer's own label.
  const placed = tooltipPosition({ x: 600, y: 400 }, { width: 120, height: 28 }, view);
  assert.equal(placed.left, 614);
  assert.equal(placed.top, 420);
});

test("a tooltip flips rather than sitting under the pointer that summoned it", () => {
  // Against the right edge it goes to the other side of the cursor, so the
  // pointer is never on top of the text it asked for.
  const right = tooltipPosition({ x: 1270, y: 400 }, { width: 200, height: 28 }, view);
  assert.ok(right.left + 200 <= view.width);
  assert.ok(right.left < 1270, "must move to the left of the cursor");

  const bottom = tooltipPosition({ x: 600, y: 790 }, { width: 120, height: 28 }, view);
  assert.ok(bottom.top + 28 <= view.height);
  assert.ok(bottom.top < 790, "must move above the cursor");

  // And a cursor in the very corner still leaves it on screen.
  const corner = tooltipPosition({ x: 2, y: 2 }, { width: 200, height: 28 }, view);
  assert.ok(corner.left >= 8 && corner.top >= 8);
});

test("a press hides the tooltip without handing the title back", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/lib/tooltip.ts", import.meta.url)),
    "utf8",
  );
  // Restoring `title` while the pointer is still on the control hands the
  // browser a hovered element with a title on it, and it draws its own — so
  // clicking a button was the one way to see the tooltip this file replaces.
  // A press conceals; only the pointer leaving releases.
  assert.match(source, /const onDismiss = \(\) => conceal\(\);/);
  assert.match(source, /const onLeave = \(\) => release\(\);/);
  assert.match(source, /const release = \(\) => \{\s*\n\s*conceal\(\);\s*\n\s*restore\(\);/);
  // `hide` is gone: leaving both names in place is how the two get confused.
  assert.doesNotMatch(source, /\bhide\(\)/);
});

test("the platform list is suppressed, and only where there is a mouse", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/components/Select.tsx", import.meta.url)),
    "utf8",
  );
  // Preventing the mousedown default is the only way to stop the platform
  // drawing its own list over ours.
  assert.match(source, /event\.preventDefault\(\);\s*\n\s*if \(rest\.disabled\) return;/);
  // A phone keeps its own picker, which is better than anything here.
  assert.match(source, /\(hover: hover\) and \(pointer: fine\)/);
  // Scrolling the list is not scrolling away from it, and a press outside is
  // caught by a listener rather than swallowed by a full-screen scrim — the
  // scrim made opening a second dropdown take two clicks.
  assert.match(source, /if \(menu\.current\?\.contains\(event\.target as Node\)\) return;/);
  assert.doesNotMatch(source, /select-scrim/);
  // And the element itself stays: it is what the stylesheets target, what a
  // screen reader announces, and what holds the value. `\r?` because a Windows
  // checkout has CRLF line endings.
  assert.match(source, /<select\r?\n\s*\{\.\.\.rest\}/);
});

test("the dropdown and the tooltip outrank every overlay in the app", () => {
  // Both are portalled to the document and positioned in the viewport, so
  // nothing contains them and only the stacking order decides. A field can be
  // opened from inside the roulette dialog (1000) or the plugin dialog
  // (1005); at 321 the list opened behind the backdrop and looked broken.
  const css = readFileSync(
    fileURLToPath(new URL("../src/styles.css", import.meta.url)),
    "utf8",
  );
  const layer = (selector) => {
    const rule = new RegExp(`\\${selector} \\{[^}]*z-index: (\\d+)`, "s").exec(css);
    assert.ok(rule, `${selector} has no z-index`);
    return Number(rule[1]);
  };
  const menu = layer(".select-menu");
  const tooltip = layer(".app-tooltip");
  const others = [...css.matchAll(/z-index: (\d+)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value !== menu && value !== tooltip);

  assert.ok(menu > Math.max(...others), `.select-menu (${menu}) must top the app`);
  // A tooltip can be drawn over an open list, and takes no pointer events.
  assert.ok(tooltip > menu, ".app-tooltip must sit above .select-menu");
});

test("nothing renders a native select any more", () => {
  for (const file of [
    "../src/App.tsx",
    "../src/components/Collections.tsx",
    "../src/components/Details.tsx",
    "../src/components/Discover.tsx",
    "../src/components/PlaybackPolicySettings.tsx",
    "../src/components/Player.tsx",
    "../src/components/PluginSettings.tsx",
  ]) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    assert.doesNotMatch(source, /<select[\s>]/, `${file} still opens a native list`);
  }
});
