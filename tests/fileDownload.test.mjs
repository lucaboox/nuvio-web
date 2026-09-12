import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  fileExtension,
  needsUnsendableHeaders,
  saveFilename,
} from "../src/lib/fileDownload.ts";

const read = (path) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("the addon's own filename wins over anything composed", () => {
  // It is the release name, which is what a subtitle file, a library scanner
  // and the viewer's own eye all match against.
  assert.equal(
    saveFilename({
      url: "https://media.example/abc123",
      filename: "Show.Name.S01E02.1080p.WEB-DL.DDP5.1.H.264-GROUP.mkv",
      title: "The Episode",
      showName: "Show Name",
      season: 1,
      episode: 2,
    }),
    "Show.Name.S01E02.1080p.WEB-DL.DDP5.1.H.264-GROUP.mkv",
  );
});

test("dots and hyphens survive; only what Windows rejects goes", () => {
  const name = saveFilename({
    url: "https://media.example/x",
    filename: 'A:B/C*D?E"F<G>H|I.mkv',
    title: "ignored",
  });
  assert.ok(!/[\\/:*?"<>|]/.test(name), `${name} still holds an illegal char`);
  assert.equal(name, "A B C D E F G H I.mkv");
});

test("an episode is named show, number and title", () => {
  assert.equal(
    saveFilename({
      url: "https://media.example/stream.mp4",
      title: "Winter Is Coming",
      showName: "Game of Thrones",
      season: 1,
      episode: 2,
    }),
    "Game of Thrones - S01E02 - Winter Is Coming.mp4",
  );
});

test("a film is not named twice", () => {
  // title and showName are the same string for a film, and "Dune - Dune" is
  // what a naive join would produce.
  assert.equal(
    saveFilename({ url: "https://media.example/dune.mkv", title: "Dune" }),
    "Dune.mkv",
  );
  assert.equal(
    saveFilename({
      url: "https://media.example/dune",
      title: "Dune",
      showName: "Dune",
    }),
    "Dune.mkv",
  );
});

test("a name with nothing usable still ends up a file", () => {
  assert.equal(
    saveFilename({ url: "not a url at all", title: "   " }),
    "Nuvio.mkv",
  );
});

test("the extension is read from the name, then the path, then guessed", () => {
  assert.equal(fileExtension("https://media.example/a", "clip.MP4"), ".mp4");
  // A query string must not be mistaken for the end of the path.
  assert.equal(
    fileExtension("https://media.example/a/b.mkv?token=x.mp4"),
    ".mkv",
  );
  assert.equal(fileExtension("https://media.example/opaque-id"), ".mkv");
  assert.equal(fileExtension("magnet:?xt=urn:btih:abc"), ".mkv");
});

test("only headers the browser cannot substitute count as unsendable", () => {
  // The browser sends its own of these three, and hosts asking for them
  // generally accept what arrives — so they must not raise the warning.
  assert.equal(needsUnsendableHeaders(undefined), false);
  assert.equal(needsUnsendableHeaders({}), false);
  assert.equal(
    needsUnsendableHeaders({ "User-Agent": "x", Referer: "y", origin: "z" }),
    false,
  );
  assert.equal(needsUnsendableHeaders({ Authorization: "Bearer x" }), true);
});

test("the saved address goes through safeHttpUrl", () => {
  // There is no DOM here to click a link in, so this holds the guarantee that
  // matters: an addon-supplied javascript: URL must never reach an href.
  const source = read("../src/lib/fileDownload.ts");
  assert.match(source, /const safe = safeHttpUrl\(url\);\s*\n\s*if \(!safe\)/);
  assert.match(source, /link\.href = safe;/);
  assert.ok(
    !/link\.href = url/.test(source),
    "the unchecked url must not reach href",
  );
  // A source that turns out to serve a page would otherwise navigate the app
  // away from itself.
  assert.match(source, /link\.target = "_blank";/);
  assert.match(source, /link\.rel = "noopener";/);
});

test("the browser save is offered on its own capability, not on a shell test", () => {
  const details = read("../src/components/Details.tsx");
  assert.match(details, /\.\.\.\(platform\.fileSave/);
  // The whole point of FileSaveApi being absent in a shell with a queue is
  // that the render site needs no second condition.
  assert.ok(
    !/platform\.fileSave[\s\S]{0,80}!platform\.downloads/.test(details),
    "fileSave must not be gated on downloads as well",
  );
  // Both entries carry the same icon, so the labels are what distinguish them.
  assert.match(details, /t\("sources\.saveFile"\)/);

  const types = read("../src/platform/types.ts");
  assert.match(types, /fileSave\?: FileSaveApi;/);
  const web = read("../src/platform/web.ts");
  assert.match(web, /fileSave: \{ save: saveToDevice \}/);
});
