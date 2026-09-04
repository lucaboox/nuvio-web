import assert from "node:assert/strict";
import test from "node:test";
import { runExit } from "../src/lib/useFadeOut.ts";

/** A scheduler that runs nothing until told, so ordering is observable. */
function fakeScheduler() {
  const frames = [];
  const timers = [];
  return {
    frames,
    timers,
    /** The timer that removes the element, as opposed to the stall release. */
    removal: () => timers.filter((entry) => entry.ms < 1200),
    scheduler: {
      frame: (run) => frames.push(run),
      cancelFrame: () => {},
      timer: (run, ms) => timers.push({ run, ms }),
      cancelTimer: () => {},
    },
  };
}

test("the visible state is painted before the transition starts", () => {
  // Applying `leaving` on the same frame the element mounts jumps straight to
  // the end state: the browser has no start state to animate from.
  const { frames, scheduler } = fakeScheduler();
  const phases = [];
  runExit(420, (phase) => phases.push(phase), scheduler);

  assert.deepEqual(phases, ["holding"], "must mount plain, not already leaving");
  frames.shift()();
  assert.deepEqual(phases, ["holding"], "one frame is not enough");
  frames.shift()();
  assert.deepEqual(phases, ["holding", "leaving"]);
});

test("removal is timed from the fade, not from the wait", () => {
  // The regression this exists for. The boot screen leaves during the app's
  // first full render — the heaviest frame there is. With the timer started
  // alongside the frame wait, a tree slower than `ms` to paint burned the
  // whole budget before the transition began, and the overlay was removed as
  // it started fading. On screen that is identical to no animation.
  const fake = fakeScheduler();
  const phases = [];
  runExit(420, (phase) => phases.push(phase), fake.scheduler);

  assert.equal(fake.removal().length, 0, "nothing may be removed before leaving");
  fake.frames.shift()();
  assert.equal(fake.removal().length, 0, "still waiting for the start state");
  fake.frames.shift()();

  assert.equal(fake.removal().length, 1, "scheduled once the fade starts");
  assert.equal(phases.at(-1), "leaving");
  assert.ok(fake.removal()[0].ms >= 420, "removal must outlast the transition");

  fake.removal()[0].run();
  assert.deepEqual(phases, ["holding", "leaving", "hidden"]);
});

test("a suspended clock still releases the screen", () => {
  // A background tab suspends requestAnimationFrame, so the frames never come.
  // Without this the exit hangs and the screen is still up when the reader
  // returns to the tab.
  const { timers, scheduler } = fakeScheduler();
  const phases = [];
  runExit(420, (phase) => phases.push(phase), scheduler);

  const stall = timers.find((entry) => entry.ms >= 1200);
  assert.ok(stall, "expected a release for frames that never arrive");
  stall.run();
  assert.deepEqual(phases, ["holding", "leaving"]);
});

test("the release cannot fire the exit twice", () => {
  const fake = fakeScheduler();
  const phases = [];
  runExit(420, (phase) => phases.push(phase), fake.scheduler);

  fake.frames.shift()();
  fake.frames.shift()();
  const before = fake.removal().length;
  fake.timers.find((entry) => entry.ms >= 1200).run();

  assert.deepEqual(phases, ["holding", "leaving"], "no second transition");
  assert.equal(fake.removal().length, before, "no second removal");
});

test("an exit cancelled midway schedules nothing further", () => {
  const fake = fakeScheduler();
  const phases = [];
  const cancel = runExit(420, (phase) => phases.push(phase), fake.scheduler);
  cancel();
  fake.frames.shift()();
  assert.equal(fake.removal().length, 0);
});
