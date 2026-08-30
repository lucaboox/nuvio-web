import assert from "node:assert/strict";
import test from "node:test";

import { applyDebridStreamSettings } from "../src/lib/debridStreams.ts";

const base = {
  debridEnabled: true,
  debridPreferredResolverProviderId: "torbox",
  debridStreamMaxResults: 0,
  debridStreamSortMode: "DEFAULT",
  debridStreamMinimumQuality: "ANY",
  debridStreamDolbyVisionFilter: "ANY",
  debridStreamHdrFilter: "ANY",
  debridStreamCodecFilter: "ANY",
};

function direct(name, service, resolution, size, hdr = [], codec = "HEVC") {
  return {
    name,
    title: "",
    description: "",
    sources: [],
    addonName: "Resolver addon",
    addonId: "resolver",
    clientResolve: {
      type: "debrid",
      service,
      isCached: true,
      stream: { raw: { size, parsed: { resolution, hdr, codec } } },
    },
  };
}

test("debrid rules never reorder or filter ordinary Stremio streams", () => {
  const first = { name: "HTTP one", title: "", description: "", url: "https://one.test/video", sources: [], addonName: "A", addonId: "a" };
  const second = { ...first, name: "HTTP two", url: "https://two.test/video" };
  assert.deepEqual(
    applyDebridStreamSettings([first, second], { ...base, debridStreamMinimumQuality: "P2160" }),
    [first, second],
  );
});

test("disabled debrid removes only client-resolve candidates", () => {
  const http = { name: "HTTP", title: "", description: "", url: "https://one.test/video", sources: [], addonName: "A", addonId: "a" };
  assert.deepEqual(
    applyDebridStreamSettings([direct("TB", "torbox", "2160p", 20), http], { ...base, debridEnabled: false }),
    [http],
  );
});

test("provider, quality, feature, codec, order and limit rules are functional", () => {
  const streams = [
    direct("PM", "premiumize", "2160p", 40, ["HDR"], "HEVC"),
    direct("TB 1080", "torbox", "1080p", 10, [], "AVC"),
    direct("TB 4K", "torbox", "2160p", 30, ["HDR10"], "HEVC"),
    direct("TB 4K DV", "torbox", "2160p", 50, ["DV"], "HEVC"),
  ];
  const result = applyDebridStreamSettings(streams, {
    ...base,
    debridStreamMaxResults: 1,
    debridStreamSortMode: "SIZE_DESC",
    debridStreamMinimumQuality: "P2160",
    debridStreamDolbyVisionFilter: "EXCLUDE",
    debridStreamHdrFilter: "ONLY",
    debridStreamCodecFilter: "HEVC",
  });
  assert.deepEqual(result.map((stream) => stream.name), ["TB 4K"]);
});
