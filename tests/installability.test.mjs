import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The manifest icon set, as an installable web app needs it.
 *
 * Written after a deploy that passed every installability check Chromium
 * exposes and still would not install on Android: the icons were one 1024px
 * file declared twice, and Chrome quietly fell back to a home-screen shortcut
 * that opens in a tab. Nothing in the build failed, and nothing in the browser
 * said why — which is exactly the kind of silence a test is for.
 */

const at = (path) => fileURLToPath(new URL(path, import.meta.url));
const config = readFileSync(at("../vite.config.ts"), "utf8");

/** Every icon the manifest declares, read out of the config as written. */
const icons = [
  ...config.matchAll(
    /\{ src: `\$\{base\}([^`]+)`, sizes: "(\d+)x(\d+)", type: "image\/png", purpose: "(\w+)" \}/g,
  ),
].map(([, file, width, height, purpose]) => ({
  file,
  width: Number(width),
  height: Number(height),
  purpose,
}));

/** A PNG states its own size in the IHDR chunk, at a fixed offset. */
function pngSize(file) {
  const bytes = readFileSync(at(`../public/${file}`));
  assert.equal(
    bytes.subarray(1, 4).toString("latin1"),
    "PNG",
    `${file} is not a PNG`,
  );
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("the manifest declares icons at all", () => {
  assert.ok(icons.length >= 2, "expected the icon list to parse out of the config");
});

test("Android's two conventional sizes are both present and square", () => {
  // 192 and 512 are what every installable app ships. A larger icon satisfies
  // the browser's own minimum and is still not enough to be packaged.
  for (const size of [192, 512]) {
    const match = icons.find(
      (icon) =>
        icon.purpose === "any" && icon.width === size && icon.height === size,
    );
    assert.ok(match, `no ${size}x${size} icon with purpose "any"`);
  }
});

test("a maskable icon is its own file, not the artwork used for any", () => {
  const maskable = icons.filter((icon) => icon.purpose === "maskable");
  assert.ok(maskable.length > 0, "no maskable icon is declared");
  const plain = new Set(
    icons.filter((icon) => icon.purpose === "any").map((icon) => icon.file),
  );
  for (const icon of maskable)
    assert.ok(
      !plain.has(icon.file),
      `${icon.file} is declared both maskable and any; a masked icon is cropped to the safe zone, so the padded artwork has to be a separate file`,
    );
});

test("every declared icon exists and is the size it claims", () => {
  // A manifest that lies about a size is worse than one that omits it: the
  // host picks an icon by what it was told and then gets something else.
  for (const icon of icons) {
    const actual = pngSize(icon.file);
    assert.deepEqual(
      actual,
      { width: icon.width, height: icon.height },
      `${icon.file} is ${actual.width}x${actual.height} but is declared ${icon.width}x${icon.height}`,
    );
  }
});

test("icons are precached, so an installed app has them offline", () => {
  const assets = config.slice(
    config.indexOf("includeAssets:"),
    config.indexOf("manifest:"),
  );
  for (const icon of new Set(icons.map((entry) => entry.file)))
    assert.ok(
      assets.includes(`"${icon}"`),
      `${icon} is in the manifest but not in includeAssets`,
    );
});

test("the app keeps one identity across a move", () => {
  // Absent, identity falls back to start_url, so changing the base path would
  // read as a different app to anything that had already installed this one.
  assert.match(config, /\bid: base,/);
});
