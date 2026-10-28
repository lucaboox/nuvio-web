import assert from "node:assert/strict";
import test from "node:test";
import {
  parseExternalReport,
  takeExternalReport,
  withKnownDuration,
} from "../src/lib/externalHandoff.ts";

// What the Shortcut copies is the whole webapp:// address, so the parser is
// given a full URL rather than a query — iOS reopens an installed web app at
// its own start address, so this is the only copy that still has the numbers.
const COPIED = "webapp://nuvio.example/?nuvio-external=stopped&position=83&duration=5400";

test("a stopped report is read out of the address the Shortcut copied", () => {
  assert.deepEqual(parseExternalReport(COPIED), {
    outcome: "stopped",
    positionMs: 83_000,
    durationMs: 5_400_000,
  });
});

test("a finished report needs no numbers", () => {
  assert.deepEqual(
    parseExternalReport("webapp://host/?nuvio-external=finished"),
    { outcome: "finished" },
  );
});

test("a bare query is read the same as a whole address", () => {
  assert.deepEqual(parseExternalReport("?nuvio-external=stopped&position=12"), {
    outcome: "stopped",
    positionMs: 12_000,
    durationMs: 0,
  });
});

test("anything else on the clipboard is refused rather than half-read", () => {
  for (const text of [
    "",
    "https://example.com/movie.mkv",
    "webapp://host/",
    "just some copied text",
    "?position=83&duration=5400",
  ])
    assert.equal(parseExternalReport(text), null, `should refuse: ${text}`);
});

test("a missing or nonsense position reads as no position, not NaN", () => {
  const report = parseExternalReport("?nuvio-external=stopped&position=abc");
  assert.deepEqual(report, { outcome: "stopped", positionMs: 0, durationMs: 0 });
});

// The address is made up. The tail is what SenPlayer 6.2.2 appended to its
// x-success, as captured: the stream URL as lastPlayedUrl, with that URL's own
// query encoded, then the position in seconds. It sends no duration.
const SENPLAYER_RETURN =
  "https://nuvio.example/nuvio-web/?nuvio-external=stopped&lastPlayedUrl=http://127.0.0.1:8765/media/short.mp4?sig%3Da%252Bb%26exp%3D1&position=20";

test("SenPlayer's report is read as a position with no length", () => {
  assert.deepEqual(parseExternalReport(SENPLAYER_RETURN), {
    outcome: "stopped",
    positionMs: 20_000,
    durationMs: 0,
  });
});

test("a missing length is filled from the runtime, and the position kept without one", () => {
  const report = { outcome: "stopped", positionMs: 2_580_000, durationMs: 0 };
  assert.deepEqual(withKnownDuration(report, 2_700_000), {
    outcome: "stopped",
    positionMs: 2_580_000,
    durationMs: 2_700_000,
  });
  // No runtime: still worth saving, since it resumes from there.
  assert.equal(withKnownDuration(report, null), report);
  assert.equal(withKnownDuration(report, 0), report);
  // A length the player measured beats one from metadata.
  const reported = { outcome: "stopped", positionMs: 83_000, durationMs: 5_400_000 };
  assert.equal(withKnownDuration(reported, 2_700_000), reported);
});

test("the stream URL SenPlayer appends is taken out of the address bar", () => {
  let replaced = null;
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { search: new URL(SENPLAYER_RETURN).search, href: SENPLAYER_RETURN },
      history: { replaceState: (_state, _title, url) => (replaced = url) },
    },
  });
  try {
    assert.deepEqual(takeExternalReport(), { outcome: "stopped", positionMs: 20_000, durationMs: 0 });
    assert.equal(replaced, "https://nuvio.example/nuvio-web/");
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else delete globalThis.window;
  }
});
