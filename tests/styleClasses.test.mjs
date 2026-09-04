import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not `.pathname`: this repository lives under a directory with
// a space in it, and the raw pathname keeps it percent-encoded.
const root = fileURLToPath(new URL("../src/", import.meta.url));
const css = readFileSync(join(root, "styles.css"), "utf8");
const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

function tsxFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/**
 * Names that are deliberately not styled on their own: they are either matched
 * only in combination (`.setting-grid.subtitle-grid`) or are hooks for tests
 * and scripts rather than appearance.
 */
const INTENTIONAL = new Set([
  "continue-section",
  "inline-error",
  "integration-hub",
  "is-detailed",
  "plugin-browser-note",
  "subtitle-grid",
]);

test("every class name used in JSX has a rule in styles.css", () => {
  // A className with no rule renders as an unstyled browser default and is
  // invisible in review — `primary-button` shipped that way in three files,
  // and the folder buttons in download settings looked like raw OS widgets.
  const missing = new Map();
  for (const file of tsxFiles(root)) {
    const text = readFileSync(file, "utf8");
    for (const [, value] of text.matchAll(/className="([^"{}]+)"/g))
      for (const name of value.split(/\s+/).filter(Boolean))
        if (!defined.has(name) && !INTENTIONAL.has(name))
          missing.set(name, file.slice(root.length));
  }
  assert.deepEqual(
    [...missing].map(([name, file]) => `${name} (${file})`),
    [],
  );
});
