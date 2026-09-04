import type { Stream } from "../types.ts";
import type { WebPlayerSettings } from "./webSettings.ts";
import type { SkipSegment } from "./skipSegments.ts";

/** Official PlayerNextEpisodeRules, including an outro followed by a post-credit scene. */
export function nextEpisodeDue(position: number, duration: number, settings: WebPlayerSettings, segments: readonly SkipSegment[]): boolean {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position) || position <= 0) return false;
  const threshold = settings.nextEpisodeThresholdMode === "MINUTES_BEFORE_END"
    ? Math.max(0, Math.min(3.5, settings.nextEpisodeThresholdMinutes)) * 60
    : duration * (1 - Math.max(97, Math.min(100, settings.nextEpisodeThresholdPercent)) / 100);
  const outros = segments.filter((segment) => segment.kind === "credits");
  if (outros.length && duration - Math.max(...outros.map((segment) => Math.min(duration, segment.end))) <= threshold)
    return position >= Math.min(...outros.map((segment) => segment.start));
  return duration - position <= threshold + 0.001;
}

/** Source scope and selection mirror StreamAutoPlaySelector; never silently broaden an empty scope. */
export function selectAutoStream(streams: readonly Stream[], settings: WebPlayerSettings, installedAddons: readonly string[], bingeGroup?: string, nextEpisode = false): Stream | null {
  const manualNext = nextEpisode && settings.autoPlayMode === "MANUAL" && (settings.autoPlayNextEpisode || settings.preferBingeGroup);
  const groupOnly = manualNext && (!settings.autoPlayNextEpisode || !settings.autoPlayNextEpisodeFallback) && settings.preferBingeGroup;
  const mode = manualNext ? "FIRST_STREAM" : settings.autoPlayMode;
  const candidates = streams.filter((stream) => {
    if (!stream.url && !stream.externalUrl) return false;
    if (manualNext) return true;
    const addon = installedAddons.includes(stream.addonName);
    if (settings.autoPlaySource === "INSTALLED_ADDONS_ONLY" && !addon) return false;
    if (settings.autoPlaySource === "ENABLED_PLUGINS_ONLY" && addon) return false;
    const selected = addon ? settings.autoPlaySelectedAddons : settings.autoPlaySelectedPlugins;
    return !selected.length || selected.includes(stream.addonName);
  });
  const prefer = nextEpisode ? settings.preferBingeGroup : settings.reuseBingeGroup;
  const same = prefer && bingeGroup ? candidates.find((stream) => stream.behaviorHints?.bingeGroup === bingeGroup) : undefined;
  if (groupOnly) return same ?? null;
  if (mode === "MANUAL") return null;
  if (same) return same;
  if (mode === "FIRST_STREAM") return candidates[0] ?? null;
  try {
    const regex = new RegExp(settings.autoPlayRegex, "i");
    return candidates.find((stream) => regex.test([stream.addonName, stream.name, stream.title, stream.description, stream.behaviorHints?.filename, stream.url].filter(Boolean).join(" "))) ?? null;
  } catch { return null; }
}

export function shouldBlurEpisode(enabled: boolean, watched: boolean, current = false): boolean {
  return enabled && !watched && !current;
}

export function automaticSkipSegment(segments: readonly SkipSegment[], position: number, duration: number, settings: WebPlayerSettings): SkipSegment | null {
  if (!settings.skipIntroEnabled || !Number.isFinite(duration) || duration <= 0) return null;
  return segments.find((item) => settings.autoSkipSegmentTypes.includes(item.kind === "credits" ? "outro" : item.kind)
    && position >= item.start && position < Math.min(item.end, duration) - 1) ?? null;
}

/** Wait budget starts with the request, not after the slowest addon finishes. */
export function resolveAutoStream(
  load: (onBatch: (streams: Stream[]) => void) => Promise<Stream[]>,
  select: (streams: Stream[]) => Stream | null,
  timeoutSeconds: number,
): Promise<Stream | null> {
  return new Promise((resolve, reject) => {
    let latest: Stream[] = [];
    let expired = timeoutSeconds <= 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (complete: boolean) => {
      if (settled || (!expired && !complete)) return;
      const choice = select(latest);
      if (!choice && !complete) return;
      settled = true;
      clearTimeout(timer);
      resolve(choice);
    };
    if (timeoutSeconds < 2147483647) timer = setTimeout(() => { expired = true; finish(false); }, Math.max(0, timeoutSeconds) * 1000);
    Promise.resolve().then(() => load((streams) => { latest = streams; finish(false); })).then((streams) => {
      latest = streams; finish(true);
    }, (error) => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
  });
}
