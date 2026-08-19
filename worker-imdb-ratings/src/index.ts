/**
 * Episode ratings, fetched where a browser cannot fetch them.
 *
 * The two services Nuvio reads per-episode scores from send no cross-origin
 * headers, so a page cannot call them at all — the reason the web client has
 * been showing TMDB's vote average, which is a different measure wearing an
 * IMDb badge. This asks on the page's behalf and hands back the real numbers.
 *
 * It also keeps the upstream addresses out of the app. They are build secrets
 * in the official clients, and the web client is served from a public
 * repository where anything it fetched directly would be published with it.
 *
 * What it receives: which show you opened. That is more than the return relay
 * ever sees, which is why it is a separate Worker rather than another route on
 * that one — the relay's guarantee is that it learns nothing about what is
 * being watched, and this would have made that untrue.
 */

export interface Env {
  /**
   * The ratings service, looked up by TMDB id.
   *
   * It serves IMDb's own scores — the payload carries `tconst` and
   * `num_votes`, IMDb's fields, under TMDB-shaped names — merged with TMDB
   * artwork, which is why TMDB's id is the key.
   *
   * Set with `wrangler secret put IMDB_RATINGS_BASE_URL`.
   */
  IMDB_RATINGS_BASE_URL: string;
  /**
   * Per-IP limiter, applied before any upstream work.
   *
   * The origin allowlist is a header check, and a header proves nothing about
   * who is calling — it keeps other people's pages out, not other people. This
   * is what keeps a day's request budget from being spent by one caller.
   */
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Hosts allowed to read an answer, comma separated. */
  ALLOWED_APP_HOSTS: string;
  /** Further hosts, kept out of the repository. */
  EXTRA_APP_HOSTS?: string;
}

/**
 * Ratings change slowly and a wrong one for a few hours is no loss, so both
 * the edge and the browser hold onto them. This is what keeps a day of
 * browsing inside a request budget: the same show reopened costs nothing.
 */
const EDGE_TTL_SECONDS = 12 * 60 * 60;
const BROWSER_TTL_SECONDS = 6 * 60 * 60;
/** Long enough that an upstream hiccup does not become a blank page. */
const STALE_TTL_SECONDS = 24 * 60 * 60;

const TMDB_ID = /^\d{1,9}$/;

type UpstreamEpisode = {
  season_number?: number | null;
  episode_number?: number | null;
  vote_average?: number | null;
};
type UpstreamSeason = { episodes?: UpstreamEpisode[] | null };

/** `season:episode` → score, which is the shape the episode list looks up. */
export type RatingMap = Record<string, number>;

/**
 * Tidies a base address that came from a shell.
 *
 * `echo "https://host" | wrangler secret put` keeps the quotes on Windows —
 * cmd.exe treats them as part of the string — and the stored value then builds
 * a URL that cannot parse. Costing nothing to strip is cheaper than expecting
 * everyone to know which shell they are in.
 */
export function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim()
    .replace(/\/+$/, "");
}

/**
 * Flattened here rather than in the browser, so the rule that decides what
 * counts as a rating lives in one place.
 *
 * A zero vote average means "nobody has rated this", not "rated zero" — every
 * client drops those, and a 0.0 badge on an unaired episode is worse than no
 * badge at all.
 */
export function toRatingMap(payload: unknown): RatingMap {
  if (!Array.isArray(payload)) return {};
  const ratings: RatingMap = {};
  for (const season of payload as UpstreamSeason[]) {
    for (const episode of season?.episodes ?? []) {
      const seasonNumber = episode?.season_number;
      const episodeNumber = episode?.episode_number;
      const score = episode?.vote_average;
      if (typeof seasonNumber !== "number" || typeof episodeNumber !== "number")
        continue;
      if (typeof score !== "number" || !Number.isFinite(score) || score <= 0)
        continue;
      ratings[`${seasonNumber}:${episodeNumber}`] = score;
    }
  }
  return ratings;
}

function allowedHosts(env: Env) {
  return `${env.ALLOWED_APP_HOSTS},${env.EXTRA_APP_HOSTS ?? ""}`
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

/** Only the hosts this was configured for may read an answer back. */
function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get("Origin") ?? "";
  let host = "";
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
  if (!allowedHosts(env).includes(host)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    // Readable from the page, which is the only place anyone will look.
    "Access-Control-Expose-Headers": "X-Nuvio-Cache",
    Vary: "Origin",
  };
}

/**
 * Reports how it went as well as what it got.
 *
 * An empty map and a failed request looked identical from the browser, which
 * made "no ratings for this show" and "the upstream is down" the same screen —
 * the diagnosis that cost days on the player. `upstream` never names the host,
 * only what it did.
 */
async function fetchSeasonRatings(
  baseUrl: string | undefined,
  showId: string,
): Promise<{ ratings: RatingMap; upstream: string }> {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return { ratings: {}, upstream: "not configured" };
  const response = await fetch(`${base}/api/shows/${showId}/season-ratings`, {
    headers: { Accept: "application/json" },
    // Cached at the edge as well as in front of it, so a cold browser for a
    // show someone else opened still costs no upstream request.
    cf: { cacheTtl: EDGE_TTL_SECONDS, cacheEverything: true },
  }).catch((error: unknown) => {
    // A dead certificate and a refused connection both land here.
    return error instanceof Error ? error.message : "unreachable";
  });
  if (typeof response === "string")
    return { ratings: {}, upstream: `unreachable: ${response}` };
  if (!response.ok) return { ratings: {}, upstream: `HTTP ${response.status}` };
  const payload = await response.json().catch(() => null);
  if (payload === null) return { ratings: {}, upstream: "unreadable body" };
  const ratings = toRatingMap(payload);
  return {
    ratings,
    upstream: Object.keys(ratings).length ? "ok" : "ok, no ratings for this show",
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (!cors) return new Response("Not allowed", { status: 403 });
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET")
      return new Response("Method not allowed", { status: 405, headers: cors });

    const url = new URL(request.url);
    if (url.pathname !== "/season-ratings")
      return new Response("Not found", { status: 404, headers: cors });

    // Before the cache lookup and before any upstream call: a cached answer
    // still costs a request against the day's budget, so limiting only the
    // expensive path would not protect it.
    const caller = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const allowed = await env.RATE_LIMITER.limit({ key: caller }).then(
      (result) => result.success,
      // A limiter that errors must not take the Worker down with it.
      () => true,
    );
    if (!allowed)
      return new Response(JSON.stringify({ error: "Too many requests." }), {
        status: 429,
        headers: { ...cors, "Content-Type": "application/json", "Retry-After": "60" },
      });

    // Validated rather than passed through: this becomes a path on another
    // host, and anything that is not plainly an id has no business there.
    const tmdbId = (url.searchParams.get("tmdb") ?? "").trim();
    const tmdb = TMDB_ID.test(tmdbId) ? tmdbId : "";
    if (!tmdb)
      return new Response(JSON.stringify({ error: "Give a tmdb id." }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    // Keyed on the id alone, so two origins asking about one show share an
    // answer and the Origin header does not fragment the cache.
    const cacheKey = new Request(
      `https://ratings.invalid/season-ratings?tmdb=${tmdb}`,
      { method: "GET" },
    );
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
      const body = await cached.text();
      return new Response(body, {
        headers: {
          ...cors,
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${BROWSER_TTL_SECONDS}`,
          "X-Nuvio-Cache": "hit",
        },
      });
    }

    const { ratings, upstream } = await fetchSeasonRatings(
      env.IMDB_RATINGS_BASE_URL,
      tmdb,
    );

    const body = JSON.stringify({ ratings, upstream });
    // An empty answer is cached too, but briefly: a show with no ratings yet
    // should not be asked about on every open, and should not be written off
    // for half a day either.
    const found = Object.keys(ratings).length > 0;
    ctx.waitUntil(
      cache.put(
        cacheKey,
        new Response(body, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${found ? STALE_TTL_SECONDS : 900}`,
          },
        }),
      ),
    );
    return new Response(body, {
      headers: {
        ...cors,
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${found ? BROWSER_TTL_SECONDS : 900}`,
        "X-Nuvio-Cache": "miss",
      },
    });
  },
};
