import assert from "node:assert/strict";
import test from "node:test";
import { startNativePlaybackSession } from "../src/lib/nativePlaybackSession.ts";

function pending() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("closing during prepare stops the late native playback exactly once", async () => {
  const entered = pending();
  const opening = pending();
  const calls = [];
  const player = {
    async open() { calls.push("open"); entered.resolve(); await opening.promise; },
    async stop() { calls.push("stop"); },
  };
  const session = startNativePlaybackSession(player, {});
  await entered.promise;
  const closed = session.stop();
  assert.equal(session.stop(), closed);
  assert.deepEqual(calls, ["open"]);
  opening.resolve();
  await closed;
  assert.deepEqual(calls, ["open", "stop"]);
});

test("old cleanup completes before replacement opens and cannot stop it twice", async () => {
  const stopping = pending();
  const calls = [];
  const player = {
    async open(source) { calls.push(source.url); },
    async stop() { calls.push("stop"); await stopping.promise; },
  };
  const old = startNativePlaybackSession(player, { url: "first" });
  await old.ready;
  const closed = old.stop();
  const next = startNativePlaybackSession(player, { url: "second" });
  stopping.resolve();
  await closed;
  await next.ready;
  await old.stop();
  assert.deepEqual(calls, ["first", "stop", "second"]);
});

test("an overlay removed before its queued launch never opens a player", async () => {
  const calls = [];
  const player = { async open() { calls.push("open"); }, async stop() { calls.push("stop"); } };
  const session = startNativePlaybackSession(player, {});
  await session.stop();
  assert.deepEqual(calls, []);
});

test("failed prepares still clean up and do not block later sessions", async () => {
  const calls = [];
  const player = {
    async open(source) { calls.push(source.url); if (source.url === "bad") throw Error("failed"); },
    async stop() { calls.push("stop"); },
  };
  const bad = startNativePlaybackSession(player, { url: "bad" });
  await assert.rejects(bad.ready, /failed/);
  await bad.stop();
  const good = startNativePlaybackSession(player, { url: "good" });
  await good.ready;
  assert.deepEqual(calls, ["bad", "stop", "good"]);
});
