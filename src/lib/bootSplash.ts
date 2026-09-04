import { runExit } from "./useFadeOut.ts";

/**
 * The loading screen that index.html paints, dismissed rather than replaced.
 *
 * It lives outside #root so React never owns it. When React rendered its own
 * copy, the swap rebuilt every part of it: the logo was a new <img> and
 * flashed while it decoded, the spinner was a new element so its rotation
 * restarted, and the label changed text. Matching the styles could not fix
 * that, because the fault was the teardown rather than the appearance.
 *
 * So React leaves it alone and only ends it. The fade is the same runExit the
 * React overlays use — the element must paint its visible state before the
 * class arrives, and the removal must be timed from the fade rather than from
 * the wait.
 */
const ID = "boot-splash";

let dismissing = false;

/** True while the static screen is still the one on screen. */
export function bootSplashPresent(): boolean {
  return typeof document !== "undefined" && document.getElementById(ID) !== null;
}

export function dismissBootSplash(ms: number): void {
  if (dismissing) return;
  const node = typeof document === "undefined" ? null : document.getElementById(ID);
  if (!node) return;
  dismissing = true;
  runExit(ms, (phase) => {
    if (phase === "leaving") {
      node.classList.add("is-leaving");
      // Announced while it works, silent while it goes.
      node.setAttribute("aria-hidden", "true");
    }
    if (phase === "hidden") node.remove();
  });
}
