import { useEffect, useRef, useState } from "react";

/** hidden: not rendered. holding: rendered, not yet leaving. leaving: going. */
export type FadePhase = "hidden" | "holding" | "leaving";

/** Injected so the ordering below can be tested without a browser. */
export type FadeScheduler = {
  frame: (run: () => void) => number;
  cancelFrame: (handle: number) => void;
  timer: (run: () => void, ms: number) => number;
  cancelTimer: (handle: number) => void;
};

const browserScheduler: FadeScheduler = {
  frame: (run) => requestAnimationFrame(run),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  timer: (run, ms) => window.setTimeout(run, ms),
  cancelTimer: (handle) => window.clearTimeout(handle),
};

/**
 * Drives one exit: paint the visible state, start the transition, then remove.
 *
 * Two frames pass before `leaving`, because a transition only runs if the
 * browser has painted the starting state first — and here the element is often
 * *newly mounted* at the moment it should begin leaving. One frame is not
 * always enough, since a frame that also mounts the tree can commit both
 * states together, which jumps straight to the end and shows nothing.
 *
 * The removal timer starts inside that second frame rather than alongside it.
 * Started earlier it runs against the wait instead of against the fade: the
 * boot screen leaves as the whole app renders for the first time, which is the
 * heaviest frame in the app, and a tree that takes longer than `ms` to paint
 * spent the entire budget before the transition had begun. The overlay was
 * removed at the moment it started fading — indistinguishable from no
 * animation at all, which is exactly how it looked.
 */
export function runExit(
  ms: number,
  set: (phase: FadePhase) => void,
  scheduler: FadeScheduler = browserScheduler,
): () => void {
  let frame: number | null = null;
  let stall: number | null = null;
  let removal: number | null = null;
  let started = false;

  const begin = () => {
    if (started) return;
    started = true;
    if (frame != null) scheduler.cancelFrame(frame);
    if (stall != null) scheduler.cancelTimer(stall);
    frame = stall = null;
    set("leaving");
    removal = scheduler.timer(() => set("hidden"), ms + 40);
  };

  set("holding");
  frame = scheduler.frame(() => {
    frame = scheduler.frame(begin);
  });
  /*
   * A background tab suspends requestAnimationFrame entirely, so the frames
   * above may never arrive and the exit would hang there — with the removal
   * timer now started by them, the screen would still be up whenever the
   * reader came back. This releases it regardless.
   *
   * Deliberately far longer than a slow frame. Boot is the heaviest render in
   * the app and its frames can be hundreds of milliseconds apart; a short
   * fallback would win that race on exactly the machines that need the frames
   * most, apply the class in the same paint as the mount, and skip the
   * animation again. At this length only a genuinely suspended clock reaches
   * it, and nobody is watching that tab anyway.
   */
  stall = scheduler.timer(begin, 1200);

  return () => {
    if (frame != null) scheduler.cancelFrame(frame);
    if (stall != null) scheduler.cancelTimer(stall);
    if (removal != null) scheduler.cancelTimer(removal);
  };
}

/**
 * Keeps something on screen long enough to animate away.
 *
 * React unmounts the moment a condition goes false, so an overlay disappears
 * rather than closes — there is nothing left to transition. This holds it for
 * the length of its exit and reports when that exit is running.
 */
export function useFadeOut(active: boolean, ms: number) {
  const [phase, setPhase] = useState<FadePhase>(active ? "holding" : "hidden");
  const wasActive = useRef(active);

  useEffect(() => {
    if (active) {
      wasActive.current = true;
      setPhase("holding");
      return;
    }
    // Never shown, so there is nothing to fade — this also covers first render,
    // where an exit would be a flash of something that was never there.
    if (!wasActive.current) {
      setPhase("hidden");
      return;
    }
    wasActive.current = false;
    return runExit(ms, setPhase);
  }, [active, ms]);

  return { mounted: phase !== "hidden", leaving: phase === "leaving" };
}
