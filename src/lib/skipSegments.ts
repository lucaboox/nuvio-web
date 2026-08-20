/**
 * Intro, recap and credits timings, so they can be skipped.
 *
 * The desktop client reaches four services for this. Three are unusable from a
 * browser — its own IntroDb sends no CORS headers at all, and AniSkip needs an
 * anime id resolved through a second service that is anime-only anyway. This
 * one answers to an IMDb id directly, which is the id the app already holds,
 * and sends CORS headers, so it needs no key, no proxy and no id resolution.
 */

import { platform } from "../platform/index.ts";

const BASE = "https://api.theintrodb.org/v3/media";
const CACHE_TTL_MS = 30 * 60 * 1000;

export type SkipKind = "intro" | "recap" | "credits" | "preview";

export type SkipSegment = {
  kind: SkipKind;
  /** Seconds. */
  start: number;
  /** Seconds, or Infinity where the segment runs to the end of the file. */
  end: number;
};

type Interval = { start_ms?: number | null; end_ms?: number | null };
type Response = Partial<Record<SkipKind, Interval[]>>;

const KINDS: SkipKind[] = ["intro", "recap", "credits", "preview"];

const cache = new Map<string, { at: number; segments: SkipSegment[] }>();
const inFlight = new Map<string, Promise<SkipSegment[]>>();

/** `tt1234:1:1` and `tt1234` name the same title. */
function imdbId(value?: string): string | undefined {
  const id = value?.trim().split(":")[0];
  return id?.toLowerCase().startsWith("tt") ? id : undefined;
}

/**
 * Reads the service's intervals.
 *
 * Both ends are nullable and mean different things: a missing start is a
 * segment that begins with the file, and a missing end is one that runs to
 * the end of it. Treating either as zero would put a skip button over the
 * wrong part of the episode.
 */
export function parseSkipSegments(payload: unknown): SkipSegment[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as Response;
  const segments: SkipSegment[] = [];
  for (const kind of KINDS)
    for (const interval of body[kind] ?? []) {
      const start = (interval.start_ms ?? 0) / 1000;
      const end =
        interval.end_ms == null ? Number.POSITIVE_INFINITY : interval.end_ms / 1000;
      if (!Number.isFinite(start) || start < 0) continue;
      if (end <= start) continue;
      segments.push({ kind, start, end });
    }
  return segments;
}

/**
 * The segment covering this moment, if it is one worth offering to skip.
 *
 * Credits and previews are not offered: leaving them is what the next-episode
 * card is for, and a button that skips to the very end of the file would end
 * playback rather than advance it. A short tail is left unoffered so the
 * button does not appear for a second at the very end of an intro.
 */
export function activeSkipSegment(
  segments: readonly SkipSegment[],
  position: number,
): SkipSegment | null {
  return (
    segments.find(
      (segment) =>
        (segment.kind === "intro" || segment.kind === "recap") &&
        position >= segment.start &&
        position < segment.end - 1,
    ) ?? null
  );
}

/** Where the next-episode card should appear, when the credits are known. */
export function creditsStart(segments: readonly SkipSegment[]): number | null {
  const credits = segments
    .filter((segment) => segment.kind === "credits")
    .map((segment) => segment.start);
  return credits.length ? Math.min(...credits) : null;
}

export const skipLabel = (kind: SkipKind) =>
  kind === "recap" ? "Skip recap" : "Skip intro";

/**
 * Timings for one episode, or an empty list when there are none.
 *
 * Never throws and never reports: a missing answer means no button, which is
 * the state everything was in before this existed.
 */
export async function loadSkipSegments(
  id?: string,
  season?: number,
  episode?: number,
): Promise<SkipSegment[]> {
  const imdb = imdbId(id);
  if (!imdb) return [];
  const key = `${imdb}:${season ?? ""}:${episode ?? ""}`;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.segments;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const task = (async () => {
    const query = new URLSearchParams({ imdb_id: imdb });
    if (season != null && episode != null) {
      query.set("season", String(season));
      query.set("episode", String(episode));
    }
    let segments: SkipSegment[] = [];
    try {
      const response = await platform.request(`${BASE}?${query.toString()}`);
      // Anything it does not know answers with an error status, which is not
      // worth distinguishing from having no timings.
      if (response.ok) segments = parseSkipSegments(JSON.parse(response.body));
    } catch {
      // Offline, blocked, or the service is down. No button.
    }
    cache.set(key, { at: Date.now(), segments });
    inFlight.delete(key);
    return segments;
  })();
  inFlight.set(key, task);
  return task;
}
