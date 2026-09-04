import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const script = readFileSync(
  fileURLToPath(new URL("../public/boot-label.js", import.meta.url)),
  "utf8",
);
const locales = fileURLToPath(new URL("../src/locales/", import.meta.url));
const read = (tag) =>
  JSON.parse(readFileSync(join(locales, `${tag}.json`), "utf8"));

/** Runs the script against a fake page and returns the label it left behind. */
function boot({ stored, languages }) {
  const node = { textContent: "Loading Nuvio…" };
  const context = {
    document: { getElementById: (id) => (id === "boot-splash-label" ? node : null) },
    navigator: { languages, language: languages[0] },
    localStorage: {
      getItem: () => {
        if (stored === "blocked") throw new Error("blocked");
        return stored ?? null;
      },
    },
  };
  runInNewContext(script, context);
  return node.textContent;
}

test("the boot label matches the locale files", () => {
  // The strings are duplicated into public/boot-label.js because plain HTML
  // loaded before the bundle cannot import them. This is what keeps the locale
  // files the one place a translation is corrected.
  for (const tag of ["de", "es", "fr", "it", "ja"])
    assert.equal(
      boot({ stored: tag, languages: ["en-US"] }),
      read(tag)["boot.loading"],
      `${tag} has drifted from its locale file`,
    );
  assert.equal(boot({ stored: "en", languages: ["de"] }), read("en")["boot.loading"]);
});

test("the boot label follows the device when nothing is stored", () => {
  assert.equal(boot({ stored: null, languages: ["fr-CA", "en"] }), read("fr")["boot.loading"]);
  assert.equal(boot({ stored: "system", languages: ["ja-JP"] }), read("ja")["boot.loading"]);
  // An unlisted language falls back to the English already in the markup.
  assert.equal(boot({ stored: null, languages: ["pt-BR"] }), read("en")["boot.loading"]);
});

test("a blocked or empty storage still renders a label", () => {
  // Private modes throw on getItem rather than returning null.
  assert.equal(boot({ stored: "blocked", languages: ["es-ES"] }), read("es")["boot.loading"]);
  assert.equal(boot({ stored: "blocked", languages: [] }), read("en")["boot.loading"]);
});

test("the splash is outside #root so React cannot replace it", () => {
  // Rendered inside, React tore it down on mount: a fresh <img> that flashed
  // while it decoded, and a spinner whose rotation restarted mid-wait.
  const html = readFileSync(
    fileURLToPath(new URL("../index.html", import.meta.url)),
    "utf8",
  );
  const splash = html.indexOf('id="boot-splash"');
  const root = html.indexOf('id="root"');
  assert.ok(splash > 0 && root > 0, "expected both the splash and the root");
  assert.ok(splash < root, "the splash must not be nested in #root");
  assert.match(html, /<div id="root"><\/div>/, "#root must start empty");
});
