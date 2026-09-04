import type { WebPlayerSettings } from "../lib/webSettings";
import type { SyncPreferenceType } from "../lib/settingsBlob";
import { platform } from "../platform/index.ts";

export function PlaybackPolicySettings({ section, settings, ready, addonNames = [], onChange }: {
  section: "next" | "scope" | "skipping" | "render";
  settings: WebPlayerSettings;
  ready: boolean;
  addonNames?: string[];
  onChange(feature: string, key: string, type: SyncPreferenceType, value: string | boolean | number | string[]): void;
}) {
  const save = (key: string, type: SyncPreferenceType, value: string | boolean | number | string[]) => onChange("player_settings", key, type, value);
  const toggle = (title: string, description: string, key: string, checked: boolean) => (
    <div className="theme-row" key={key}>
      <span><strong>{title}</strong><small>{description}</small></span>
      <label className="switch"><input aria-label={title} type="checkbox" checked={checked} disabled={!ready} onChange={(event) => save(key, "boolean", event.target.checked)} /><i /></label>
    </div>
  );
  if (section === "next") return <>
    {toggle("Auto-play next episode", "Automatically continue when the next-episode threshold is reached. You can cancel the countdown in either internal player.", "stream_auto_play_next_episode_enabled", settings.autoPlayNextEpisode)}
    {toggle("Prefer the same release", "Try the current stream's binge group for the next episode.", "stream_auto_play_prefer_binge_group", settings.preferBingeGroup)}
    {toggle("Allow next-episode fallback", "In manual source mode, allow another source if auto-play is enabled and the same release is unavailable. Otherwise open source selection.", "stream_auto_play_next_episode_fallback_enabled", settings.autoPlayNextEpisodeFallback)}
    <label className="setting-select-row"><span><strong>Show next episode</strong><small>Known end credits are used unless a post-credit scene extends beyond this threshold.</small></span>
      <select disabled={!ready} value={settings.nextEpisodeThresholdMode} onChange={(event) => save("next_episode_threshold_mode", "string", event.target.value)}>
        <option value="PERCENTAGE">Percentage watched</option><option value="MINUTES_BEFORE_END">Minutes before the end</option>
      </select>
    </label>
    <label className="setting-text-row"><span><strong>{settings.nextEpisodeThresholdMode === "PERCENTAGE" ? "Watched percentage (97–100%)" : "Minutes remaining (0–3.5)"}</strong></span>
      <input type="number" disabled={!ready} min={settings.nextEpisodeThresholdMode === "PERCENTAGE" ? 97 : 0} max={settings.nextEpisodeThresholdMode === "PERCENTAGE" ? 100 : 3.5} step="0.1"
        value={settings.nextEpisodeThresholdMode === "PERCENTAGE" ? settings.nextEpisodeThresholdPercent : settings.nextEpisodeThresholdMinutes}
        onChange={(event) => { if (event.target.value !== "") save(settings.nextEpisodeThresholdMode === "PERCENTAGE" ? "next_episode_threshold_percent_v2" : "next_episode_threshold_minutes_before_end_v2", "float", Number(event.target.value)); }} />
    </label>
  </>;
  if (section === "scope") return <>
    <label className="setting-select-row"><span><strong>Source selection wait</strong><small>Maximum wait for addon responses before automatically choosing. All sources remain available for manual selection.</small></span>
      <select disabled={!ready} value={settings.autoPlayTimeoutSeconds} onChange={(event) => save("stream_auto_play_timeout_seconds", "int", Number(event.target.value))}>
        {[0,1,2,3,4,5,6,7,8,9,10,15,20,25,30,2147483647].map((value) => <option key={value} value={value}>{value === 2147483647 ? "Wait for all sources" : `${value} seconds`}</option>)}
      </select>
    </label>
    <label className="setting-select-row"><span><strong>Auto-play sources</strong><small>Plugins are unavailable in this shared client. A synced plugins-only selection will require manual source selection.</small></span>
      <select disabled={!ready} value={settings.autoPlaySource} onChange={(event) => save("stream_auto_play_source", "string", event.target.value)}>
        <option value="ALL_SOURCES">All sources</option><option value="INSTALLED_ADDONS_ONLY">Installed addons only</option><option value="ENABLED_PLUGINS_ONLY" disabled>Enabled plugins only (unavailable)</option>
      </select>
    </label>
    <details className="playback-addon-scope"><summary>Choose auto-play addons</summary><p>No selection means all installed addons. This does not hide sources from the manual list.</p>
      {[...new Set([...addonNames, ...settings.autoPlaySelectedAddons])].map((name) => <label key={name}><input type="checkbox" disabled={!ready} checked={settings.autoPlaySelectedAddons.includes(name)} onChange={(event) => save("stream_auto_play_selected_addons", "string_set", event.target.checked ? [...settings.autoPlaySelectedAddons, name] : settings.autoPlaySelectedAddons.filter((value) => value !== name))} /> {name}</label>)}
    </details>
    {toggle("Reuse binge group", "Prefer the previously used release when auto-selecting another source for this title.", "stream_auto_play_reuse_binge_group", settings.reuseBingeGroup)}
  </>;
  if (section === "skipping") return <>
    <p>{platform.player ? "Use native IntroDB/AniSkip timing providers, with optional AnimeSkip. Not every title has timings." : "Skip buttons use available IntroDB timings. Not every title has timings; additional native providers are not available in browsers."}</p>
    {platform.player && toggle("AnimeSkip", "Also use AnimeSkip timings with your client ID below.", "animeskip_enabled", settings.animeSkipEnabled)}
    <div className="playback-addon-scope"><strong>Automatically skip</strong>
      {[["intro", "Intros"], ["recap", "Recaps"], ["outro", "End credits"]].map(([value, label]) => <label key={value}><input type="checkbox" disabled={!ready || !settings.skipIntroEnabled} checked={settings.autoSkipSegmentTypes.includes(value)} onChange={(event) => save("auto_skip_segment_types", "string_set", event.target.checked ? [...settings.autoSkipSegmentTypes, value] : settings.autoSkipSegmentTypes.filter((kind) => kind !== value))} /> {label}</label>)}
    </div>
  </>;
  return <>
    {platform.player ? toggle("Preserve ASS/SSA styling (libass)", "LibMPV always renders through libass. Enable to preserve the subtitle file's fonts, positioning and effects; disable to apply your style overrides.", "use_libass", settings.useLibass) : <p>Browser text cues use the styles below. Full ASS/SSA effects need a separate libass/WebAssembly renderer; the Android OpenGL/Canvas render modes are not available here.</p>}
  </>;
}
