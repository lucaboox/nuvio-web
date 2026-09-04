import assert from "node:assert/strict";
import test from "node:test";
import { DetailsTrace, timed, detailsDebugEnabled } from "../src/lib/detailsDebug.ts";
import { tmdbJson } from "../src/lib/metadataEnrichment.ts";
import { platform } from "../src/platform/index.ts";

test("live seconds, start offsets and total stay correct for overlapping work", async () => {
  let now = 100;
  const trace = new DetailsTrace("Test", () => now);
  const one = trace.start("Addon");
  now = 350;
  const two = trace.start("Logo");
  now = 1100; one();
  assert.equal(trace.entryElapsed(trace.entries[0]), 1000);
  assert.equal(trace.entryElapsed(trace.entries[1]), 750);
  now = 2100; two(); trace.finish();
  now = 9000;
  const report = JSON.parse(trace.report());
  assert.equal(report.totalSeconds, 2);
  assert.equal(report.resources[1].startSeconds, .25);
  assert.equal(report.resources[1].seconds, 1.75);
});

test("instrumentation preserves result/errors and excludes error messages", async () => {
  const trace = new DetailsTrace("Test");
  assert.equal(await timed(trace, "cached", async () => 42, "cache / shared request"), 42);
  const error = new Error("https://host/secret-token?apikey=SECRET");
  await assert.rejects(timed(trace, "provider", async () => { throw error; }), e => e === error);
  assert.equal(trace.entries[1].status, "error");
  assert.doesNotMatch(trace.report(), /SECRET|secret-token/);
  assert.equal(await timed(undefined, "off", async () => 3), 3);
});

test("cancelled runs cannot be changed by stale requests and records are bounded", () => {
  let now = 0;
  const trace = new DetailsTrace("Test", () => now);
  const finish = trace.start("request");
  now = 500; trace.cancel(); now = 1000; finish();
  assert.equal(trace.entries[0].status, "cancelled");
  assert.equal(trace.entryElapsed(trace.entries[0]), 500);
  trace.start("stale")();
  assert.equal(trace.entries.length, 1);
  const bounded = new DetailsTrace("Test");
  for (let i = 0; i < 500; i++) bounded.start("resource")();
  assert.equal(bounded.entries.length, 200);
});

test("debug defaults off when local storage is unavailable", () => {
  assert.equal(detailsDebugEnabled(), false);
});

test("provider timing distinguishes network/cache without recording query credentials", async () => {
  const original = platform.request;
  let calls = 0;
  platform.request = async () => { calls++; return { ok: true, status: 200, headers: {}, body: '{"id":12345}' }; };
  try {
    const trace = new DetailsTrace("Test");
    const url = "https://api.themoviedb.org/3/movie/12345?api_key=DO_NOT_LOG";
    assert.deepEqual(await tmdbJson(url, trace), { id: 12345 });
    assert.deepEqual(await tmdbJson(url, trace), { id: 12345 });
    assert.equal(calls, 1);
    assert.equal(trace.entries[0].note, "network");
    assert.equal(trace.entries[1].note, "cache / shared request");
    assert.doesNotMatch(trace.report(), /DO_NOT_LOG|api_key/);
  } finally { platform.request = original; }
});
