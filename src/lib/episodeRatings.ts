/**
 * Per-episode IMDb scores, by way of a Worker.
 *
 * The service sends no cross-origin headers, so a page cannot read it
 * directly. The Worker asks on our behalf and hands back a flat map.
 *
 * Looked up by TMDB id even though the scores are IMDb's: the service merges
 * IMDb ratings with TMDB artwork, and TMDB's id is the key it files them
 * under. The official clients try an IMDb-keyed service first, which has been
 * answering 502 behind an expired certificate since August 2026 — so they have
 * been reaching this same service by this same route regardless.
 *
 * This replaces an earlier attempt that read TMDB's own vote average off the
 * season payload. That was a different measure shown under an IMDb mark; these
 * are the real scores.
 */

import { platform } from "../platform/index.ts";

const WORKER_URL = "https://nuvio-imdb-ratings.lucaboox.workers.dev";
/** Matches the Worker's own budget, so a reopened page asks nobody. */
const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * The upstream's own shape, flattened.
 *
 * The Worker does this server-side for browsers, so this is the same rule
 * written twice — unavoidably, since the Worker is a separate deployment that
 * cannot import from here. Kept identical on purpose: a score that differs
 * between the desktop and the web because two flatteners disagreed would be
 * very hard to trace back to this.
 *
 * A zero vote average means "nobody has rated this", not "rated zero". Every
 * Nuvio client drops those, and a 0.0 badge on an unaired episode is worse than
 * no badge at all.
 */
export function toRatingMap(payload: unknown): EpisodeRatings {
  const ratings: EpisodeRatings = new Map();
  if (!Array.isArray(payload)) return ratings;
  for (const season of payload) {
    for (const episode of season?.episodes ?? []) {
      const seasonNumber = episode?.season_number;
      const episodeNumber = episode?.episode_number;
      const score = episode?.vote_average;
      if (typeof seasonNumber !== "number" || typeof episodeNumber !== "number")
        continue;
      if (typeof score !== "number" || !Number.isFinite(score) || score <= 0)
        continue;
      ratings.set(`${seasonNumber}:${episodeNumber}`, score);
    }
  }
  return ratings;
}

/** Keyed `season:episode`, matching how the episode list looks them up. */
export type EpisodeRatings = Map<string, number>;

const cache = new Map<string, { at: number; ratings: EpisodeRatings }>();
const inFlight = new Map<string, Promise<EpisodeRatings>>();

/** What the Worker will accept: a plain TMDB id and nothing else. */
export function tmdbIdFrom(value: string | undefined): string {
  const raw = (value ?? "").trim();
  return /^\d{1,9}$/.test(raw) ? raw : "";
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

/**
 * @param tmdbId the show's TMDB id, which the caller resolves — metadata
 * enrichment already looks it up and caches it, so this costs nothing extra.
 */
export async function loadEpisodeRatings(
  tmdbId: string,
): Promise<EpisodeRatings> {
  const tmdb = tmdbIdFrom(tmdbId);
  if (!tmdb) return new Map();

  const cached = cache.get(tmdb);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.ratings;

  // Shared, so opening a show twice while the first ask is in the air makes
  // one request rather than two.
  const existing = inFlight.get(tmdb);
  if (existing) return existing;

  const task = (async () => {
    try {
      // The Worker exists because a page cannot call the ratings host itself.
      // A shell can, and going straight there spends no Cloudflare budget on a
      // hop it never needed — so where the shell was built with an address, it
      // is used, and the Worker is the browser's path only.
      //
      // The two answer in different shapes: the Worker flattens server-side
      // and returns `{ ratings }`, while the service itself returns a season
      // array. Which was asked decides which is parsed.
      const direct = platform.ratings?.seasonRatingsBase;
      const response = await platform.request(
        direct
          ? `${direct}/api/shows/${encodeURIComponent(tmdb)}/season-ratings`
          : `${WORKER_URL}/season-ratings?tmdb=${encodeURIComponent(tmdb)}`,
      );
      if (!response.ok) return new Map<string, number>();
      const body = JSON.parse(response.body) as unknown;
      const ratings: EpisodeRatings = direct
        ? toRatingMap(body)
        : new Map(
            Object.entries(
              (body as { ratings?: Record<string, number> })?.ratings ?? {},
            ),
          );
      cache.set(tmdb, { at: Date.now(), ratings });
      return ratings;
    } catch {
      // No badges rather than an error: a score is decoration, and the
      // episode list has to render without one.
      return new Map<string, number>();
    } finally {
      inFlight.delete(tmdb);
    }
  })();
  inFlight.set(tmdb, task);
  return task;
}
