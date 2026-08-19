import assert from "node:assert/strict";
import test from "node:test";
import {
  createHostLimiter,
  hostKey,
  isRetryable,
  retryAfterMs,
} from "../src/lib/requestPolicy.ts";

test("requests are bucketed by host, not by path", () => {
  assert.equal(hostKey("https://a.io/catalog/movie/top.json"), "https://a.io");
  assert.equal(hostKey("https://a.io/meta/series/x.json"), "https://a.io");
  assert.notEqual(hostKey("https://a.io/x"), hostKey("https://b.io/x"));
});

test("a host asking for later is retried; a refusal is not", () => {
  assert.equal(isRetryable(429), true);
  assert.equal(isRetryable(503), true);
  assert.equal(isRetryable(403), false);
  assert.equal(isRetryable(404), false);
  assert.equal(isRetryable(500), false);
});

test("Retry-After in seconds is obeyed", () => {
  assert.equal(retryAfterMs("2", 0), 2000);
  assert.equal(retryAfterMs("0", 0), 0);
});

test("Retry-After as a date is obeyed", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const at = new Date(now + 5000).toUTCString();
  assert.equal(retryAfterMs(at, 0, now), 5000);
});

test("a date already past waits no time at all", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const at = new Date(now - 5000).toUTCString();
  assert.equal(retryAfterMs(at, 0, now), 0);
});

test("a host that says nothing gets a doubling wait", () => {
  assert.equal(retryAfterMs(null, 0), 500);
  assert.equal(retryAfterMs(null, 1), 1000);
  assert.equal(retryAfterMs(null, 2), 2000);
});

test("a host cannot make us wait forever", () => {
  assert.equal(retryAfterMs("99999", 0), 30_000);
  assert.equal(retryAfterMs(null, 40), 8_000);
});

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

test("no more than the cap runs against one host at a time", async () => {
  const limiter = createHostLimiter(2);
  let running = 0;
  let peak = 0;
  const gates = [];
  const runs = Array.from({ length: 6 }, () => {
    const gate = deferred();
    gates.push(gate);
    return limiter("https://a.io/x", async () => {
      running += 1;
      peak = Math.max(peak, running);
      await gate.promise;
      running -= 1;
    });
  });
  // Let the first batch take its slots before anything is let go.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(peak, 2);
  for (const gate of gates) {
    gate.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
  await Promise.all(runs);
  assert.equal(peak, 2, "never exceeded the cap");
  assert.equal(running, 0);
});

test("a busy host does not hold up a different one", async () => {
  const limiter = createHostLimiter(1);
  const slow = deferred();
  const first = limiter("https://slow.io/x", () => slow.promise);
  let otherRan = false;
  await limiter("https://fast.io/x", async () => {
    otherRan = true;
  });
  assert.equal(otherRan, true);
  slow.resolve();
  await first;
});

test("a slot is released even when the request throws", async () => {
  const limiter = createHostLimiter(1);
  await assert.rejects(
    limiter("https://a.io/x", async () => {
      throw new Error("boom");
    }),
  );
  let ran = false;
  await limiter("https://a.io/x", async () => {
    ran = true;
  });
  assert.equal(ran, true, "the failed request did not strand its slot");
});

test("queued requests all eventually run", async () => {
  const limiter = createHostLimiter(2);
  let done = 0;
  await Promise.all(
    Array.from({ length: 9 }, () =>
      limiter("https://a.io/x", async () => {
        done += 1;
      }),
    ),
  );
  assert.equal(done, 9);
});
