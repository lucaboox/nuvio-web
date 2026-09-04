import { runExit } from "./useFadeOut.ts";

/**
 * The one loading screen, painted by index.html and never rebuilt.
 *
 * Startup used to show three: "Loading Nuvio" from index.html, "Loading
 * profiles" while the account loaded, and "Restoring Nuvio" while the profile
 * hydrated. They looked alike, but each was a different element, so every
 * handover tore one down and built the next — a fresh <img> that flashed while
 * it decoded, a fresh spinner whose rotation restarted, and a new line of text
 * that changed the layout. Three screens in a row, each arriving with a jolt.
 *
 * So there is one element for the whole of startup, and React only shows and
 * hides it. It is never removed from the document, because removing it is what
 * made re-showing it a remount. The label never changes either: a wait is one
 * wait, whatever the app is doing behind it.
 */
const ID = "boot-splash";

let cancel: (() => void) | null = null;

function node(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.getElementById(ID);
}

/** True while the static screen exists — false once index.html has changed. */
export function bootSplashPresent(): boolean {
  return node() !== null;
}

export function setBootSplashVisible(visible: boolean, ms: number): void {
  const element = node();
  if (!element) return;
  cancel?.();
  cancel = null;

  if (visible) {
    element.hidden = false;
    element.classList.remove("is-leaving");
    element.removeAttribute("aria-hidden");
    return;
  }
  if (element.hidden) return;

  cancel = runExit(ms, (phase) => {
    if (phase === "leaving") {
      element.classList.add("is-leaving");
      // Announced while it works, silent while it goes.
      element.setAttribute("aria-hidden", "true");
    }
    if (phase === "hidden") element.hidden = true;
  });
}
