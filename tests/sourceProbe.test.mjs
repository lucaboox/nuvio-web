import assert from "node:assert/strict";
import test from "node:test";
import {
  mixedContentProblem,
  probeSource,
  rangeSupport,
  statusReason,
} from "../src/lib/sourceProbe.ts";

test("https pages cannot read http sources", () => {
  assert.match(
    mixedContentProblem("https:", "http://host/file.mkv") ?? "",
    /https/,
  );
  assert.equal(mixedContentProblem("https:", "https://host/file.mkv"), null);
});

// The local tunnel and `vite dev` are both http, where the mix is allowed.
test("an http page may read an http source", () => {
  assert.equal(mixedContentProblem("http:", "http://host/file.mkv"), null);
});

test("an expired link is named as one rather than as a bad file", () => {
  assert.match(statusReason(403), /expire/i);
  assert.match(statusReason(404), /fresh|no longer/i);
  assert.match(statusReason(429), /rate/i);
  assert.match(statusReason(503), /host/i);
});

const respond = (init) => async () => new Response(null, init);

test("206 means ranges work", async () => {
  const result = await probeSource("https://h/f.mkv", undefined, 100, respond({ status: 206 }));
  assert.deepEqual(result, { ok: true, ranges: "yes" });
});

// The regression this exists to prevent: a host answering 200 to the probe was
// called range-less and refused, which stopped sources that play fine.
test("200 is usable, and says nothing either way about ranges", async () => {
  const result = await probeSource("https://h/f.mkv", undefined, 100, respond({ status: 200 }));
  assert.deepEqual(result, { ok: true, ranges: "unknown" });
});

test("a 200 that advertises ranges is taken at its word", async () => {
  const result = await probeSource("https://h/f.mkv", undefined, 100, respond({
    status: 200,
    headers: { "Accept-Ranges": "bytes" },
  }));
  assert.deepEqual(result, { ok: true, ranges: "yes" });
});

test("only an explicit none counts as no ranges", () => {
  assert.equal(rangeSupport(206, null), "yes");
  assert.equal(rangeSupport(200, "bytes"), "yes");
  assert.equal(rangeSupport(200, "none"), "no");
  assert.equal(rangeSupport(200, null), "unknown");
});

test("an error status is reported as itself", async () => {
  const result = await probeSource("https://h/f.mkv", undefined, 100, respond({ status: 403 }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, statusReason(403));
});

test("a refused fetch is put down to cross-origin policy, not the file", async () => {
  const result = await probeSource("https://h/f.mkv", undefined, 100, async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /CORS/);
});

test("a host that never answers is a timeout, not a decode failure", async () => {
  const result = await probeSource("https://h/f.mkv", undefined, 20, (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /did not answer in time/);
});

test("the probe asks for a small range and passes the stream's own headers", async () => {
  let seen;
  await probeSource("https://h/f.mkv", { Authorization: "Bearer x" }, 100, async (_url, init) => {
    seen = init.headers;
    return new Response(null, { status: 206 });
  });
  assert.equal(seen.Range, "bytes=0-1023");
  assert.equal(seen.Authorization, "Bearer x");
});
