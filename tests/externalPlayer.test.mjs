import assert from "node:assert/strict";
import test from "node:test";
import {
  externalPlayerOptions,
  infusePlaybackUrl,
  lennaPlaybackUrl,
  senplayerPlaybackUrl,
  shortcutReturnUrl,
} from "../src/lib/externalPlayer.ts";

test("Infuse handoff encodes signed stream URLs and a useful filename", () => {
  const result = infusePlaybackUrl(
    "https://media.example/movie.mkv?token=a+b&part=1",
    "House / Dragon: S1E1",
  );
  const parsed = new URL(result);

  assert.equal(parsed.protocol, "infuse:");
  assert.equal(parsed.pathname, "/play");
  assert.equal(
    parsed.searchParams.get("url"),
    "https://media.example/movie.mkv?token=a+b&part=1",
  );
  assert.equal(parsed.searchParams.get("filename"), "House _ Dragon_ S1E1.mkv");
});

test("the Shortcut return address keeps the trailing slash and a literal space", () => {
  const url = shortcutReturnUrl(
    "https://nuvio.example/",
    "?nuvio-external=stopped",
  );
  assert.ok(url.startsWith("shortcuts://run-shortcut?"));
  // "+" would be read as a plus by anything not decoding a form, and the name
  // has to match the installed Shortcut exactly.
  assert.ok(!url.includes("+"));
  assert.ok(url.includes("name=Open%20Nuvio"));
  const params = new URLSearchParams(url.split("?").slice(1).join("?"));
  assert.equal(params.get("name"), "Open Nuvio");
  assert.equal(
    params.get("text"),
    "webapp://nuvio.example/?nuvio-external=stopped",
  );
});

test("the Shortcut return address follows wherever the app is served from", () => {
  const pages = new URLSearchParams(
    shortcutReturnUrl("https://lucaboox.github.io/nuvio-web/", "?nuvio-external=finished")
      .split("?").slice(1).join("?"),
  );
  assert.equal(
    pages.get("text"),
    "webapp://lucaboox.github.io/nuvio-web/?nuvio-external=finished",
  );
  // A missing trailing slash is added: without it iOS does not find the app.
  const bare = new URLSearchParams(
    shortcutReturnUrl("https://example.com", "?nuvio-external=stopped")
      .split("?").slice(1).join("?"),
  );
  assert.equal(bare.get("text"), "webapp://example.com/?nuvio-external=stopped");
});

test("Lenna starts where you left off and reports back through the relay", () => {
  const href = lennaPlaybackUrl("https://cdn.example/film.mkv?sig=a&b=c", {
    positionSeconds: 754.9,
    subtitleUrl: "https://subs.example/en.srt",
    returnUrlFor: (query) => `https://relay.example/r/token${query}`,
  });
  assert.ok(href.startsWith("lenna://x-callback-url/play?"));
  const params = new URL(href.replace("lenna://", "https://")).searchParams;
  assert.equal(params.get("url"), "https://cdn.example/film.mkv?sig=a&b=c");
  assert.equal(params.get("sub"), "https://subs.example/en.srt");
  assert.equal(params.get("position"), "754");
  assert.equal(params.get("x-success"), "https://relay.example/r/token?nuvio-external=stopped");
  assert.equal(params.get("x-error"), params.get("x-success"));
  // Without a relay there is nothing to report to, and nothing is promised.
  const bare = new URL(lennaPlaybackUrl("https://cdn.example/a.mp4").replace("lenna://", "https://")).searchParams;
  assert.equal(bare.get("x-success"), null);
  assert.equal(bare.get("position"), "0");
});

test("SenPlayer starts where you left off and reports back through the relay", () => {
  const href = senplayerPlaybackUrl(
    "https://cdn.example/film.mkv?sig=a&b=c",
    "Hello, Ms. Cobel",
    {
      positionSeconds: 754.9,
      subtitleUrl: "https://subs.example/en.srt",
      returnUrlFor: (query) => `https://relay.example/r/token${query}`,
    },
  );
  assert.ok(href.startsWith("senplayer://x-callback-url/play?"));
  // Spaces go as %20, which no reader mistakes for anything else.
  assert.ok(!href.includes("+"), href);
  assert.ok(href.includes("name=Hello%2C%20Ms.%20Cobel"), href);
  const params = new URL(href.replace("senplayer://", "https://")).searchParams;
  assert.equal(params.get("url"), "https://cdn.example/film.mkv?sig=a&b=c");
  assert.equal(params.get("sub"), "https://subs.example/en.srt");
  assert.equal(params.get("position"), "754");
  assert.equal(params.get("x-success"), "https://relay.example/r/token?nuvio-external=stopped");
  // x-success is the only callback it documents; nothing else is promised.
  assert.equal(params.get("x-cancel"), null);
  assert.equal(params.get("x-error"), null);
});

test("SenPlayer is always given a whole, non-negative position", () => {
  const read = (href) =>
    new URL(href.replace("senplayer://", "https://")).searchParams;
  const bare = read(senplayerPlaybackUrl("https://cdn.example/a.mp4", ""));
  assert.equal(bare.get("position"), "0");
  assert.equal(bare.get("name"), null);
  assert.equal(bare.get("x-success"), null);
  for (const positionSeconds of [-5, Number.NaN, Number.POSITIVE_INFINITY, 0.4])
    assert.equal(
      read(senplayerPlaybackUrl("https://cdn.example/a.mp4", "A", { positionSeconds })).get("position"),
      "0",
    );
  // A literal "+" in the stream URL is handed over as a plus, not a space.
  assert.equal(
    read(senplayerPlaybackUrl("https://cdn.example/a.mp4?sig=x+y", "A")).get("url"),
    "https://cdn.example/a.mp4?sig=x+y",
  );
});

test("SenPlayer is offered on iPhone, iPad and Mac, and reports back", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const offered = (navigator) => {
    Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true });
    const find = (surface) =>
      externalPlayerOptions(surface).find((option) => option.mode === "senplayer");
    assert.deepEqual(find("settings"), find("player"));
    return find("player");
  };
  try {
    const iPhone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 };
    // iPadOS reports itself as a Mac; the touch points give it away.
    const iPad = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 };
    const mac = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 };
    const android = { userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)", platform: "Linux armv8l", maxTouchPoints: 5 };
    const windows = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32", maxTouchPoints: 0 };
    for (const device of [iPhone, iPad, mac])
      assert.deepEqual(offered(device), { mode: "senplayer", label: "SenPlayer", reportsBack: true });
    for (const device of [android, windows]) assert.equal(offered(device), undefined);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  }
});
