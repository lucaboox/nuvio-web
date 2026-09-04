import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * iOS-style interactive back gesture for a full-screen overlay.
 *
 * The panel tracks the finger, then either completes or springs back on
 * release. Two deliberate choices:
 *
 * - The transform is written straight to the node instead of through state.
 *   A re-render per touchmove cannot hold 60fps on a phone, and the gesture
 *   needs to feel attached to the finger.
 * - Listeners are attached manually rather than via React props, because
 *   React registers `touchstart`/`touchmove` on the root as passive, so
 *   `preventDefault` inside a synthetic handler silently does nothing — and
 *   without it the page scrolls vertically mid-drag.
 */
const EDGE_PX = 30;
const DIRECTION_SLOP_PX = 8;
const DISMISS_FRACTION = 0.32;
/** px per ms — a quick flick completes even from a short drag. */
const FLING_VELOCITY = 0.45;
const SETTLE_MS = 220;
const EASE = "cubic-bezier(.22,.61,.36,1)";

export function useSwipeBack<T extends HTMLElement>(
  onDismiss: () => void,
  /**
   * False while something is layered over the overlay. The listeners sit on
   * the overlay node, so a touch anywhere in a panel drawn inside it reaches
   * them — and dismissing then takes the overlay and the panel together,
   * which is never what the gesture on the panel meant.
   */
  enabled = true,
) {
  const ref = useRef<T>(null);
  // Kept in a ref so the listeners can stay mounted for the life of the
  // overlay rather than being torn down whenever the callback changes.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const gestureEnabled = useRef(enabled);
  gestureEnabled.current = enabled;

  /*
   * Which node the listeners are on, as state rather than just the ref.
   *
   * The effect below used to run once, on the mount of whatever owns the
   * hook. That works only for an overlay that is always in the document and
   * merely hidden; for one that is rendered when it opens, the ref is still
   * empty at that moment, the effect returns early, and the gesture is simply
   * never attached — silently, because nothing else about the overlay
   * changes. Reading the ref after every render catches the node whenever it
   * arrives, and lets go of it when it leaves.
   */
  const [node, setNode] = useState<T | null>(null);
  useLayoutEffect(() => {
    setNode((current) => (current === ref.current ? current : ref.current));
  });

  useEffect(() => {
    if (!node) return;

    let active = false;
    let decided = false;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastTime = 0;
    let velocity = 0;
    let offset = 0;

    const paint = (x: number, animate: boolean) => {
      node.style.transition = animate ? `transform ${SETTLE_MS}ms ${EASE}` : "";
      node.style.transform = x > 0 ? `translate3d(${x}px,0,0)` : "";
    };

    const reset = () => {
      active = false;
      decided = false;
      offset = 0;
      node.classList.remove("is-swiping");
      node.style.willChange = "";
    };

    const onStart = (event: TouchEvent) => {
      if (!gestureEnabled.current) return;
      const touch = event.touches[0];
      // Only from the left edge: the page has horizontally scrolling cast and
      // trailer rows, and a full-width gesture would fight them.
      if (event.touches.length !== 1 || !touch || touch.clientX > EDGE_PX)
        return;
      active = true;
      decided = false;
      startX = touch.clientX;
      startY = touch.clientY;
      lastX = touch.clientX;
      lastTime = performance.now();
      velocity = 0;
    };

    const onMove = (event: TouchEvent) => {
      if (!active) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (!decided) {
        // Let a mostly-vertical move go to the scroller untouched.
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > DIRECTION_SLOP_PX) {
          active = false;
          return;
        }
        if (Math.abs(dx) < DIRECTION_SLOP_PX) return;
        decided = true;
        node.classList.add("is-swiping");
        node.style.willChange = "transform";
      }

      event.preventDefault();
      const now = performance.now();
      if (now > lastTime)
        velocity = (touch.clientX - lastX) / (now - lastTime);
      lastX = touch.clientX;
      lastTime = now;
      // Resisted past the edge so an overshoot to the left does nothing.
      offset = Math.max(0, dx);
      paint(offset, false);
    };

    const onEnd = () => {
      if (!active) return;
      if (!decided) {
        reset();
        return;
      }
      const width = node.getBoundingClientRect().width || window.innerWidth;
      const complete =
        offset > width * DISMISS_FRACTION || velocity > FLING_VELOCITY;
      if (complete) {
        paint(width, true);
        // Unmount once it is off-screen, so the panel is never seen snapping
        // back to zero before it disappears.
        window.setTimeout(() => {
          reset();
          node.style.transform = "";
          node.style.transition = "";
          dismiss.current();
        }, SETTLE_MS);
        active = false;
        return;
      }
      paint(0, true);
      window.setTimeout(() => {
        node.style.transition = "";
      }, SETTLE_MS);
      reset();
    };

    node.addEventListener("touchstart", onStart, { passive: true });
    node.addEventListener("touchmove", onMove, { passive: false });
    node.addEventListener("touchend", onEnd);
    node.addEventListener("touchcancel", onEnd);
    return () => {
      node.removeEventListener("touchstart", onStart);
      node.removeEventListener("touchmove", onMove);
      node.removeEventListener("touchend", onEnd);
      node.removeEventListener("touchcancel", onEnd);
    };
  }, [node]);

  return ref;
}
