import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DETAILS_DEBUG_KEY, detailsDebugEnabled, type DetailsTrace } from "../lib/detailsDebug";

export function DetailsDebugToggle() {
  const [enabled, setEnabled] = useState(detailsDebugEnabled);
  const [error, setError] = useState("");
  return <label className="setting-select-row">
    <span><strong>Details loading debug mode</strong><small>Show live resource timings the next time you open a movie or show. Only on this device; not synced.</small>{error && <small role="alert">{error}</small>}</span>
    <input type="checkbox" checked={enabled} onChange={event => {
      try { localStorage.setItem(DETAILS_DEBUG_KEY, String(event.target.checked)); setEnabled(event.target.checked); setError(""); }
      catch { setError("This browser is blocking local preference storage."); }
    }} />
  </label>;
}

export function DetailsDebugPanel({ traces }: { traces: DetailsTrace[] }) {
  const trace = traces[traces.length - 1]!;
  const [, tick] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => {
      tick(value => value + 1);
      if (trace.ended !== undefined && trace.entries.every(entry => entry.end !== undefined)) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [trace]);
  const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
  return createPortal(<aside className="details-debug" aria-label="Details loading diagnostics">
    <header><strong>Details: {seconds(trace.elapsed())} · {trace.ended === undefined ? "Loading" : "Visible"}</strong><button onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? "Expand" : "Minimize"}</button></header>
    {!collapsed && <>
      <p>{trace.title}</p>
      <small>Entry-loading resources only; lazy thumbnails/background ratings are not blockers. Stages overlap; do not add their times. Cache entries may include an in-flight shared request.</small>
      {traces.length > 1 && <small>{traces.length - 1} earlier attempt(s) retained in Copy timings: {seconds(traces.slice(0, -1).reduce((total, previous) => total + previous.elapsed(), 0))}. Loading restarted as inputs changed.</small>}
      <div className="details-debug-resources">
        {trace.entries.map((entry, index) => <div key={index} data-status={entry.status}>
          <span>{entry.label}<small>+{seconds(entry.start - trace.started)} · {entry.note || entry.status}</small></span>
          <strong>{seconds(trace.entryElapsed(entry))}<small>{entry.status}</small></strong>
        </div>)}
      </div>
      <footer><button onClick={async () => {
        try { await navigator.clipboard.writeText(JSON.stringify({ attempts: traces.map(item => JSON.parse(item.report())) }, null, 2)); setCopyStatus("Copied"); }
        catch { setCopyStatus("Clipboard unavailable"); }
      }}>Copy timings</button><span role="status">{copyStatus}</span></footer>
    </>}
  </aside>, document.body);
}
