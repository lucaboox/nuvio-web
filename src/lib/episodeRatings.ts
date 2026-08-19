/**
 * Per-episode IMDb scores, by way of a Worker.
 *
 * The two services these come from send no cross-origin headers, so a page
 * cannot read them directly. The Worker asks on our behalf, applies the same
 * rules the official clients apply, and hands back a flat map.
 *
 * This replaces an earlier attempt that fell back to TMDB's vote average off
 * the season payload — a different measure, shown under an IMDb mark, which is
 * why it was removed rather than corrected.
 */

const WORKER_URL = "https://nuvio-imdb-ratings.lucaboox.workers.dev";
/** Matches the Worker's own budget, so a reopened page asks nobody. */
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Keyed `season:episode`, matching how the episode list looks them up. */
export type EpisodeRatings = Map<string, number>;

const cache = new Map<string, { at: number; ratings: EpisodeRatings }>();
const inFlight = new Map<string, Promise<EpisodeRatings>>();

/**
 * The show's own IMDb id, where the id is one.
 *
 * Addon ids carry episode coordinates after a colon — `tt0944947:1:2` — and
 * only the show part identifies the series.
 */
export function imdbIdFrom(value: string | undefined): string {
  const head = (value ?? "").trim().split(":")[0].toLowerCase();
  return /^tt\d{5,12}$/.test(head) ? head : "";
}

/** TMDB ids appear as `tmdb:1399` on some addons, and bare elsewhere. */
export function tmdbIdFrom(value: string | undefined): string {
  const raw = (value ?? "").trim().toLowerCase();
  const tagged = /^tmdb:(\d{1,9})$/.exec(raw);
  if (tagged) return tagged[1];
  return /^\d{1,9}$/.test(raw) ? raw : "";
}

/** The query the Worker takes, or empty when there is nothing to ask about. */
export function ratingsQuery(imdbId: string, tmdbId: string): string {
  const parts: string[] = [];
  if (imdbId) parts.push(`imdb=${encodeURIComponent(imdbId)}`);
  if (tmdbId) parts.push(`tmdb=${encodeURIComponent(tmdbId)}`);
  return parts.join("&");
}

/**
 * One decimal, always.
 *
 * Rounded through tenths as an integer exactly as the official clients do, so
 * the same score reads the same on every device: 8.25 is 8.3, and 8 is "8.0"
 * rather than "8".
 */
export function formatRating(rating: number): string {
  const tenths = Math.round(rating * 10);
  return `${Math.trunc(tenths / 10)}.${Math.abs(tenths % 10)}`;
}

export async function loadEpisodeRatings(
  metaId: string,
  tmdbId?: string,
): Promise<EpisodeRatings> {
  const imdb = imdbIdFrom(metaId);
  const tmdb = tmdbIdFrom(tmdbId) || tmdbIdFrom(metaId);
  const query = ratingsQuery(imdb, tmdb);
  if (!query) return new Map();

  const cached = cache.get(query);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.ratings;

  // Shared, so opening a show twice while the first ask is in the air makes
  // one request rather than two.
  const existing = inFlight.get(query);
  if (existing) return existing;

  const task = (async () => {
    try {
      const response = await fetch(`${WORKER_URL}/season-ratings?${query}`);
      if (!response.ok) return new Map<string, number>();
      const payload = (await response.json()) as {
        ratings?: Record<string, number>;
      };
      const ratings: EpisodeRatings = new Map(
        Object.entries(payload.ratings ?? {}),
      );
      cache.set(query, { at: Date.now(), ratings });
      return ratings;
    } catch {
      // No badges rather than an error: a score is decoration, and the
      // episode list has to render without one.
      return new Map<string, number>();
    } finally {
      inFlight.delete(query);
    }
  })();
  inFlight.set(query, task);
  return task;
}
