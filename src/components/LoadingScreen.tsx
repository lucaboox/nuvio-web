/** One opaque, branded loading state for both the website and native shell. */
export function LoadingScreen({
  overlay = false,
  label = "Loading Nuvio…",
}: {
  overlay?: boolean;
  label?: string;
}) {
  return (
    <div className={`nuvio-loading-screen${overlay ? " is-overlay" : ""}`} role="status" aria-live="polite" aria-label={label}>
      <div className="nuvio-loading-brand">
        <img src={`${import.meta.env.BASE_URL}Nuvio-icon.png`} width="96" height="96" alt="" />
        <span className="nuvio-loading-name">Nuvio</span>
        <i className="nuvio-loading-spinner" aria-hidden="true" />
        <span className="nuvio-loading-label">{label}</span>
      </div>
    </div>
  );
}
