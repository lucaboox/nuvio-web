import { useEffect, useRef, useState } from "react";
import { platform } from "../platform";
import { safeHttpUrl } from "../lib/security";
import { normalizeBadgeRules, parseBadgeImport, readBadgeRules, upsertBadgeImport } from "../lib/fusionBadges";

export function FusionBadgeSettings({ serialized, disabled, onSave }: { serialized: string; disabled: boolean; onSave(value: string): void }) {
  const rules = readBadgeRules(serialized);
  const current = useRef(rules);
  current.current = rules;
  const request = useRef<AbortController | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => () => request.current?.abort(), []);
  async function importUrl(value: string) {
    const source = safeHttpUrl(value.trim());
    if (!source) { setMessage("Enter a valid HTTP or HTTPS badge JSON URL."); return; }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setMessage("");
    try {
      const response = await platform.request(source, { signal: controller.signal, timeoutMs: 15000, maxBytes: 1024 * 1024 });
      if (!response.ok) throw new Error(`Badge host returned HTTP ${response.status}.`);
      const imported = parseBadgeImport(source, JSON.parse(response.body));
      if (controller.signal.aborted) return;
      onSave(JSON.stringify(upsertBadgeImport(current.current, imported)));
      setUrl("");
      setMessage(`Imported ${imported.filters.length} badges.`);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(`${error instanceof Error ? error.message : "Could not import badges."} In a browser, the host must allow CORS.`);
    } finally { if (request.current === controller) setBusy(false); }
  }
  const locked = disabled || busy;
  return <div className="fusion-settings">
    <p>Import up to three Fusion badge JSON URLs. One collection is active at a time, matching Nuvio desktop. Imports and selection sync to your profile.</p>
    <form onSubmit={(event) => { event.preventDefault(); void importUrl(url); }}>
      <input aria-label="Fusion badge JSON URL" type="url" placeholder="https://…/badges.json" value={url} disabled={locked} onChange={(event) => setUrl(event.target.value)} />
      <button disabled={locked || !url.trim()}>{busy ? "Importing…" : "Import"}</button>
    </form>
    {message && <p role="status">{message}</p>}
    {rules.imports.map((source) => <section key={source.sourceUrl}>
      <strong>{source.isActive ? "Active · " : ""}{source.filters.filter((filter) => filter.isEnabled !== false).length} enabled badges</strong>
      <small>{source.sourceUrl}</small>
      <div className="fusion-import-actions">
        <button disabled={locked || source.isActive} onClick={() => onSave(JSON.stringify(normalizeBadgeRules({ ...rules, imports: rules.imports.map((entry) => ({ ...entry, isActive: entry.sourceUrl === source.sourceUrl })) })))}>Use</button>
        <button disabled={locked} onClick={() => void importUrl(source.sourceUrl)}>Refresh</button>
        <button disabled={locked} onClick={() => onSave(JSON.stringify(normalizeBadgeRules({ ...rules, imports: rules.imports.filter((entry) => entry.sourceUrl !== source.sourceUrl) })))}>Remove</button>
      </div>
      <details><summary>Preview & enabled badges</summary><div className="fusion-preview">
        {source.filters.map((filter, index) => <label key={`${filter.id}:${index}`}>
          <input type="checkbox" disabled={locked} checked={filter.isEnabled !== false} onChange={(event) => onSave(JSON.stringify({ ...rules, imports: rules.imports.map((entry) => entry.sourceUrl !== source.sourceUrl ? entry : { ...entry, filters: entry.filters.map((value, position) => position === index ? { ...value, isEnabled: event.target.checked } : value) }) }))} />
          {safeHttpUrl(filter.imageURL) && <img loading="lazy" src={safeHttpUrl(filter.imageURL)!} alt="" />}{filter.name}
        </label>)}
      </div></details>
    </section>)}
  </div>;
}
