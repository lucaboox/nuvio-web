/**
 * Where the spinner should be in its rotation right now.
 *
 * A CSS animation starts when its element is created, so every remount snaps
 * the spinner back to twelve o'clock. This screen is built at least twice —
 * the static one in index.html is replaced by this component once the bundle
 * runs — and the restart is the visible jolt in what should be one continuous
 * wait. A negative delay offsets the animation into the position it would have
 * been in had it never stopped.
 */
function spinnerPhase(): string {
  if (typeof document === "undefined") return "0ms";
  // The spinner being replaced, if it is still in the document — during this
  // render it is, because React has not committed the swap yet.
  const previous = document.querySelector(".nuvio-loading-spinner");
  const spin = previous?.getAnimations?.().find((animation) => {
    const duration = animation.effect?.getComputedTiming().duration;
    return typeof duration === "number" && duration > 0;
  });
  const elapsed = typeof spin?.currentTime === "number" ? spin.currentTime : null;
  const duration = spin?.effect?.getComputedTiming().duration;
  if (elapsed === null || typeof duration !== "number") return "0ms";
  // Asking the animation rather than assuming: the duration doubles under
  // reduced motion, and the outgoing spinner started whenever its stylesheet
  // landed rather than at page load, so neither is safe to guess.
  return `-${(elapsed % duration).toFixed(0)}ms`;
}

/** One opaque, branded loading state for both the website and native shell. */
export function LoadingScreen({
  overlay = false,
  leaving = false,
  label = "Loading Nuvio…",
}: {
  overlay?: boolean;
  /** Held on screen for its exit; see `useFadeOut`. */
  leaving?: boolean;
  label?: string;
}) {
  return (
    <div
      className={`nuvio-loading-screen${overlay ? " is-overlay" : ""}${leaving ? " is-leaving" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={label}
      // Announced while it works, silent while it goes.
      aria-hidden={leaving || undefined}
    >
      <div className="nuvio-loading-brand">
        <img src={`${import.meta.env.BASE_URL}Nuvio-icon.png`} width="96" height="96" alt="" />
        <span className="nuvio-loading-name">Nuvio</span>
        <i
          className="nuvio-loading-spinner"
          style={{ animationDelay: spinnerPhase() }}
          aria-hidden="true"
        />
        <span className="nuvio-loading-label">{label}</span>
      </div>
    </div>
  );
}
