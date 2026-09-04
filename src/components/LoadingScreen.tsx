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
      // Announced while it is working, silent while it is going away.
      aria-hidden={leaving || undefined}
    >
      <div className="nuvio-loading-brand">
        <img src={`${import.meta.env.BASE_URL}Nuvio-icon.png`} width="96" height="96" alt="" />
        <span className="nuvio-loading-name">Nuvio</span>
        <i className="nuvio-loading-spinner" aria-hidden="true" />
        <span className="nuvio-loading-label">{label}</span>
      </div>
    </div>
  );
}
