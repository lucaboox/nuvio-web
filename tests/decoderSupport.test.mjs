import assert from "node:assert/strict";
import test from "node:test";
import { probeDecoders, summariseDecoders } from "../src/lib/decoderSupport.ts";

test("both halves are named, so a missing codec is visible", () => {
  const text = summariseDecoders({ "H.264": true, HEVC: false, AAC: true });
  assert.match(text, /can decode H\.264, AAC/);
  assert.match(text, /cannot decode HEVC/);
});

test("all-supported says so without an empty second half", () => {
  const text = summariseDecoders({ "H.264": true, AAC: true });
  assert.match(text, /can decode H\.264, AAC\.$/);
  assert.doesNotMatch(text, /cannot/);
});

test("nothing supported still reports the negative", () => {
  assert.match(summariseDecoders({ HEVC: false }), /cannot decode HEVC/);
});

// A decoder that never answers must leave the entry unknown rather than
// claiming it is unsupported — and must not be reported either way.
test("unknown entries are left out of both lists", () => {
  const text = summariseDecoders({ "H.264": true, HEVC: null });
  assert.match(text, /can decode H\.264/);
  assert.doesNotMatch(text, /HEVC/);
});

test("nothing known at all produces no claim", () => {
  assert.equal(summariseDecoders({}), "");
  assert.equal(summariseDecoders({ HEVC: null }), "");
});

test("without WebCodecs every codec reports unsupported, and it does not hang", async () => {
  const before = globalThis.VideoDecoder;
  delete globalThis.VideoDecoder;
  delete globalThis.AudioDecoder;
  try {
    const support = await probeDecoders(10);
    assert.equal(support["HEVC"], false);
    assert.equal(support["AAC"], false);
    assert.match(summariseDecoders(support), /cannot decode/);
  } finally {
    if (before) globalThis.VideoDecoder = before;
  }
});

test("a decoder that never answers times out as unknown", async () => {
  globalThis.VideoDecoder = { isConfigSupported: () => new Promise(() => {}) };
  globalThis.AudioDecoder = { isConfigSupported: () => new Promise(() => {}) };
  try {
    const support = await probeDecoders(10);
    assert.equal(support["HEVC"], null, "unknown, not a false claim");
    assert.equal(summariseDecoders(support), "");
  } finally {
    delete globalThis.VideoDecoder;
    delete globalThis.AudioDecoder;
  }
});

test("a rejected configuration counts as unsupported", async () => {
  globalThis.VideoDecoder = {
    isConfigSupported: async () => {
      throw new TypeError("bad config");
    },
  };
  globalThis.AudioDecoder = { isConfigSupported: async () => ({ supported: true }) };
  try {
    const support = await probeDecoders(50);
    assert.equal(support["HEVC"], false);
    assert.equal(support["AAC"], true);
  } finally {
    delete globalThis.VideoDecoder;
    delete globalThis.AudioDecoder;
  }
});

// Every browser says no to these natively, and the player brings its own
// decoder — reporting them would tell the user a playable file cannot play.
test("Dolby codecs are left out, since the player supplies its own decoder", async () => {
  globalThis.VideoDecoder = { isConfigSupported: async () => ({ supported: true }) };
  globalThis.AudioDecoder = { isConfigSupported: async () => ({ supported: true }) };
  try {
    const support = await probeDecoders(50);
    assert.ok(!("AC-3" in support));
    assert.ok(!("E-AC-3" in support));
    assert.doesNotMatch(summariseDecoders(support), /AC-3/);
  } finally {
    delete globalThis.VideoDecoder;
    delete globalThis.AudioDecoder;
  }
});
