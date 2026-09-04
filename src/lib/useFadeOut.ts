import { useEffect, useRef, useState } from "react";

/**
 * Keeps something on screen long enough to animate away.
 *
 * React unmounts the moment a condition goes false, so an overlay disappears
 * rather than closes — there is nothing left to transition. This holds it for
 * the length of its exit and reports when that exit is running.
 *
 * The two-step matters. A transition only runs if the browser has painted the
 * starting state first, and here the element is often *newly mounted* at the
 * moment it should begin leaving — the boot screen is replaced by the app tree,
 * so what fades is a different element from the one that was showing. Mounting
 * it already marked as leaving would apply the end state immediately and skip
 * the animation entirely. So it mounts plain, one frame passes, and only then
 * is it told to go.
 */
export function useFadeOut(active: boolean, ms: number) {
  /** hidden: not rendered. holding: rendered, not yet leaving. leaving: going. */
  const [phase, setPhase] = useState<"hidden" | "holding" | "leaving">(
    active ? "holding" : "hidden",
  );
  const timer = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const wasActive = useRef(active);

  useEffect(() => {
    const clear = () => {
      if (timer.current != null) window.clearTimeout(timer.current);
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
    clear();

    if (active) {
      wasActive.current = true;
      setPhase("holding");
      return clear;
    }
    // Never shown, so there is nothing to fade — this also covers first render,
    // where an exit would be a flash of something that was never there.
    if (!wasActive.current) {
      setPhase("hidden");
      return clear;
    }
    wasActive.current = false;
    setPhase("holding");
    // Two frames: the first paints the visible state, the second starts the
    // transition from it. One is not always enough — a frame that also mounts
    // the tree can commit both states together.
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => setPhase("leaving"));
    });
    timer.current = window.setTimeout(() => setPhase("hidden"), ms + 40);
    return clear;
  }, [active, ms]);

  return { mounted: phase !== "hidden", leaving: phase === "leaving" };
}
