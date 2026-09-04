import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { applyResolvedTheme } from "../src/lib/themeCache.ts";

const bootstrap = readFileSync(new URL("../public/theme-bootstrap.js", import.meta.url), "utf8");
function fixture(values = {}) {
  const cache = new Map(Object.entries(values));
  const root = { dataset: {}, style: {} };
  const meta = { setAttribute(name, value) { this[name] = value; } };
  const document = { documentElement: root, querySelector: () => meta };
  const storage = { getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) };
  return { root, document, meta, storage, cache };
}

test("OLED/accent are restored before React, and unresolved settings do not overwrite them", () => {
  const f = fixture({ "nuvio-web-amoled": "true", "nuvio-web-accent": "crimson" });
  runInNewContext(bootstrap, { document: f.document, localStorage: f.storage });
  applyResolvedTheme(null, f.root, f.document, f.storage);
  assert.equal(f.root.dataset.theme, "amoled");
  assert.equal(f.root.dataset.nuvioAccent, "crimson");
  assert.equal(f.root.style.backgroundColor, "#000000");
  assert.equal(f.meta.content, "#000000");
  assert.equal(f.cache.get("nuvio-web-amoled"), "true");
});

test("resolved server changes replace the boot cache, including turning OLED off", () => {
  const f = fixture({ "nuvio-web-amoled": "true" });
  applyResolvedTheme({ amoled: false, selectedTheme: "OCEAN" }, f.root, f.document, f.storage);
  assert.equal(f.root.dataset.theme, "default");
  assert.equal(f.root.dataset.nuvioAccent, "ocean");
  assert.equal(f.meta.content, "#080a0d");
  assert.equal(f.cache.get("nuvio-web-amoled"), "false");
  assert.equal(f.cache.get("nuvio-web-accent"), "ocean");
});

test("blocked storage and invalid accent values cannot break startup", () => {
  const f = fixture({ "nuvio-web-accent": "not-a-theme" });
  runInNewContext(bootstrap, { document: f.document, localStorage: f.storage });
  assert.equal(f.root.dataset.nuvioAccent, "white");
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => runInNewContext(bootstrap, { document: f.document, localStorage: blocked }));
  assert.doesNotThrow(() => applyResolvedTheme({ amoled: true, selectedTheme: "WHITE" }, f.root, f.document, blocked));
  assert.equal(f.root.dataset.theme, "amoled");
});

test("profile startup keeps the navigation covered through the hydration handoff", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(app, /const activateProfile[^]*?setProfileStarting\(next !== null\)/);
  const hydrate = app.slice(app.indexOf("const hydrate ="), app.indexOf("const loadProfileData ="));
  assert.doesNotMatch(hydrate, /setProfileStarting\(false\)/);
  assert.match(app, /const pageLoading = loading \|\| profileStarting/);
  assert.match(css, /\.app-shell\.is-loading > \.bottom-nav,[^}]*visibility: hidden/);
});
