import { platform } from "../platform/index.ts";
import { timed, type DetailsTrace } from "./detailsDebug.ts";
import type { ExternalRating, Meta, MetaTrailer, Person, Video } from "../types";

export type MetadataEnrichmentConfig = {
  tmdb: {
    enabled: boolean;
    apiKey: string;
    language: string;
    useArtwork: boolean;
    useBasicInfo: boolean;
    useDetails: boolean;
    useReleaseDates: boolean;
    useCredits: boolean;
    useEpisodes: boolean;
    useTrailers: boolean;
  };
  mdbList: {
    enabled: boolean;
    apiKey: string;
    providers: string[];
  };
};

type Json = Record<string, unknown>;
const json = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
const list = (value: unknown): Json[] =>
  Array.isArray(value) ? value.map(json).filter((item): item is Json => !!item) : [];
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const image = (path: unknown, size: string) =>
  text(path) ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
const isSeries = (type: string) => /series|show|tv/i.test(type);

const cache = new Map<string, Promise<unknown>>();
async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const response = await platform.request(url, { timeoutMs: 8_000 });
  if (!response.ok)
    throw new Error(`Metadata provider returned ${response.status}`);
  return JSON.parse(response.body);
}

async function cachedJson(url: string, trace?: DetailsTrace): Promise<unknown> {
  const cached = cache.has(url);
  // Only known provider routes, never query parameters (which carry API keys).
  const resource = new URL(url);
  const label = resource.hostname === "api.themoviedb.org"
    ? `TMDB ${resource.pathname.replace(/^\/3\//, "")}` : "MDBList ratings";
  return timed(trace, label, async () => {
    let request = cache.get(url);
    if (!request) {
      request = fetchJsonWithTimeout(url);
      cache.set(url, request);
      if (cache.size > 160) cache.delete(cache.keys().next().value as string);
      request.catch(() => cache.delete(url));
    }
    return request;
  }, cached ? "cache / shared request" : "network");
}

/**
 * The TMDB layer, shared with the person page.
 *
 * `person.ts` is the same layer seen from a different entry point, and it needs
 * this module's cache rather than one of its own: opening an actor from a title
 * whose credits were just fetched should not re-ask TMDB for what is already in
 * memory here.
 */
export { cachedJson as tmdbJson, tmdbUrl, image as tmdbImage };

const imdbId = (value: string): string | undefined => {
  const found = value.match(/tt\d+/i)?.[0];
  return found?.toLowerCase();
};

function tmdbIdFrom(value: string): number | undefined {
  const match = value.match(/^tmdb:(\d+)/i) || value.match(/^(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

const normalizeLanguage = (language: string) => {
  const raw = language.trim().replace("_", "-") || "en";
  const [code, region] = raw.split("-", 2);
  const normalized = region
    ? `${code.toLowerCase()}-${region.toUpperCase()}`
    : code.toLowerCase();
  return normalized === "es-419" ? "es-MX" : normalized;
};

function tmdbUrl(
  path: string,
  apiKey: string,
  language: string,
  params: Record<string, string> = {},
) {
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("language", normalizeLanguage(language));
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  return url.toString();
}

async function resolveTmdbId(
  meta: Meta,
  config: MetadataEnrichmentConfig["tmdb"],
  trace?: DetailsTrace,
): Promise<number | undefined> {
  const direct = tmdbIdFrom(meta.id);
  if (direct) return direct;
  const imdb = imdbId(meta.id);
  if (!imdb) return undefined;
  const found = json(
    await cachedJson(
      tmdbUrl(`find/${imdb}`, config.apiKey, config.language, {
        external_source: "imdb_id",
      }),
      trace,
    ),
  );
  const rows = list(found?.[isSeries(meta.type) ? "tv_results" : "movie_results"]);
  return number(rows[0]?.id);
}

/**
 * The show's TMDB id, for callers that need one and have only an IMDb id.
 *
 * Shares `resolveTmdbId`'s cache, so asking here costs nothing once metadata
 * enrichment has already looked the same title up.
 */
export async function tmdbIdForMeta(
  meta: Meta,
  config: MetadataEnrichmentConfig["tmdb"],
): Promise<string> {
  const direct = tmdbIdFrom(meta.id);
  if (direct) return String(direct);
  if (!config.enabled || !config.apiKey) return "";
  return String((await resolveTmdbId(meta, config)) ?? "");
}

/** Resolve the identifier expected by Nuvio plugin getStreams handlers. */
export async function resolvePluginTmdbId(
  meta: Meta,
  config: MetadataEnrichmentConfig["tmdb"],
): Promise<string> {
  const direct = tmdbIdFrom(meta.id);
  if (direct) return String(direct);
  if (!config.enabled || !config.apiKey) return meta.id;
  return String((await resolveTmdbId(meta, config)) ?? meta.id);
}

function selectedLogo(rows: Json[], language: string): Json | undefined {
  const normalized = normalizeLanguage(language);
  const code = normalized.split("-")[0];
  const region = normalized.split("-")[1] || (code === "pt" ? "PT" : code === "es" ? "ES" : undefined);
  return rows
    .map((row, index) => ({
      row,
      index,
      rank: [
        row.iso_639_1 === code && row.iso_3166_1 === region,
        row.iso_639_1 === code && row.iso_3166_1 == null,
        row.iso_639_1 === code,
        row.iso_639_1 === "en",
        row.iso_639_1 == null,
      ].reduce((score, match, position) => score + (match ? 1 << (5 - position) : 0), 0),
    }))
    .sort((left, right) => right.rank - left.rank || left.index - right.index)[0]
    ?.row;
}

function ageRating(payload: Json, series: boolean): string | undefined {
  const groups = list(
    json(payload[series ? "content_ratings" : "release_dates"])?.results,
  );
  const group = groups.find((item) => item.iso_3166_1 === "US") || groups[0];
  if (!group) return undefined;
  if (series) return text(group.rating);
  return list(group.release_dates)
    .map((item) => text(item.certification))
    .find(Boolean);
}

/**
 * How many cast members are worth keeping.
 *
 * `aggregate_credits` bills a show's cast across every season it ever had, and
 * a season's own credits include every guest — so both can run to hundreds of
 * people where the old `credits` endpoint returned a couple of dozen. Rendering
 * that many cards blocked the page for seconds on a phone when the season
 * picker changed, which is the whole reason there is a number here.
 */
const TMDB_CAST_LIMIT = 40;

function tmdbPeople(payload: Json, series: boolean): {
  cast: Person[];
  directors: string[];
  writers: string[];
} {
  const people: Person[] = [];
  const directors: string[] = [];
  const writers: string[] = [];
  if (series) {
    for (const creator of list(payload.created_by)) {
      const name = text(creator.name);
      if (!name) continue;
      directors.push(name);
      people.push({
        name,
        role: "Creator",
        photo: image(creator.profile_path, "w500"),
        tmdbId: number(creator.id),
      });
    }
  }
  const credits = json(payload.credits);
  // `aggregate_credits` is TMDB's proper endpoint for a show: it bills the cast
  // across every season and gives each person their roles with episode counts,
  // where plain `credits` returns a shorter flat "series cast". It is the list
  // themoviedb.org itself shows, and the reason ours looked thinner.
  const aggregate = series ? json(payload.aggregate_credits) : null;
  const aggregateCast = list(aggregate?.cast);
  for (const member of list(credits?.crew)) {
    const name = text(member.name);
    const job = text(member.job) || "";
    if (!name) continue;
    if (job.toLowerCase() === "director") {
      directors.push(name);
      if (!series)
        people.push({
          name,
          role: "Director",
          photo: image(member.profile_path, "w500"),
          tmdbId: number(member.id),
        });
    } else if (/writer|screenplay/i.test(job)) {
      writers.push(name);
    }
  }
  for (const member of aggregateCast.length ? aggregateCast : list(credits?.cast)) {
    const name = text(member.name);
    if (!name) continue;
    people.push({
      name,
      // An aggregate entry carries `roles[]` rather than one `character`; the
      // first is the billed one.
      role: text(member.character) ?? text(list(member.roles)[0]?.character),
      photo: image(member.profile_path, "w500"),
      tmdbId: number(member.id),
    });
  }
  const seen = new Set<string>();
  return {
    cast: people
      .filter((person) => {
        const key = `${person.name.toLowerCase()}|${person.role || ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      // TMDB returns these in billing order, so this keeps the people the show
      // is actually about.
      .slice(0, TMDB_CAST_LIMIT),
    directors: [...new Set(directors)],
    writers: [...new Set(writers)],
  };
}

/** TMDB scores an unrated episode 0, which is absence rather than a score. */
function episodeScore(item: Json): string | undefined {
  const score = number(item.vote_average);
  return score != null && score > 0 ? score.toFixed(1) : undefined;
}

function tmdbTrailers(payload: Json): MetaTrailer[] {
  return list(json(payload.videos)?.results)
    .filter((item) => text(item.site)?.toLowerCase() === "youtube" && text(item.key))
    .map((item) => ({
      id: String(item.id || item.key),
      key: String(item.key),
      name: text(item.name) || "Trailer",
      site: "YouTube",
      trailerType: text(item.type) || "Trailer",
      displayName: text(item.name),
    }));
}

/**
 * The cast of one season, for a show whose lineup changes between them.
 *
 * An anthology is the clear case, but any long-running show gains and loses
 * people, and the show-level list bills them all together — so the row could
 * show someone who has not appeared for four years while you are looking at the
 * newest season.
 *
 * Returns an empty list rather than throwing: TMDB has no season credits for
 * plenty of shows, and the caller falls back to the show's own cast, which is
 * the right answer when a season has nothing of its own to say.
 */
export async function loadSeasonCast(
  tmdbId: string,
  season: number,
  config: MetadataEnrichmentConfig["tmdb"],
): Promise<Person[]> {
  if (!config.enabled || !config.apiKey.trim() || !/^\d+$/.test(tmdbId))
    return [];
  try {
    const payload = json(
      await cachedJson(
        tmdbUrl(
          `tv/${tmdbId}/season/${season}/aggregate_credits`,
          config.apiKey,
          config.language,
        ),
      ),
    );
    const cast: Person[] = [];
    // Bounded for the same reason as above: a season's aggregate credits list
    // every guest, and this list is rebuilt every time the picker moves.
    for (const member of list(payload?.cast).slice(0, TMDB_CAST_LIMIT)) {
      const name = text(member.name);
      if (!name) continue;
      cast.push({
        name,
        role: text(list(member.roles)[0]?.character) ?? text(member.character),
        photo: image(member.profile_path, "w500"),
        tmdbId: number(member.id),
      });
    }
    return cast;
  } catch {
    return [];
  }
}

/** Case- and punctuation-insensitive, so "J. K. Simmons" matches "J.K. Simmons". */
const nameKey = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The addon's cast, with TMDB filling the gaps — not replacing it.
 *
 * TMDB used to win outright, which is why this client showed fewer actors than
 * the official one: the official client never asks TMDB for credits at all, and
 * shows whatever the addon put in `app_extras.cast`. So the addon decides who
 * appears and in what order.
 *
 * TMDB is still worth having, because an addon commonly sends names and nothing
 * else — and a cast member with no `tmdbId` cannot be opened, so deferring
 * wholesale would have quietly cost the actor pages. Anyone TMDB knows about
 * who the addon did not mention is appended rather than dropped.
 */
export function mergeCast(addon: Person[], tmdb: Person[]): Person[] {
  if (!addon.length) return tmdb;
  if (!tmdb.length) return addon;
  const byName = new Map(tmdb.map((person) => [nameKey(person.name), person]));
  const merged = addon.map((person) => {
    const match = byName.get(nameKey(person.name));
    if (!match) return person;
    byName.delete(nameKey(person.name));
    return {
      ...person,
      role: person.role ?? match.role,
      photo: person.photo ?? match.photo,
      tmdbId: person.tmdbId ?? match.tmdbId,
    };
  });
  return [...merged, ...byName.values()];
}

export function applyTmdbPayload(
  meta: Meta,
  payload: Json,
  images: Json | null,
  config: MetadataEnrichmentConfig["tmdb"],
): Meta {
  const series = isSeries(meta.type);
  let next = { ...meta };
  if (config.useArtwork) {
    const logo = selectedLogo(list(images?.logos), config.language);
    next = {
      ...next,
      background: image(payload.backdrop_path, "w1280") || next.background,
      poster: image(payload.poster_path, "w500") || next.poster,
      logo: image(logo?.file_path, "w500") || next.logo,
    };
  }
  if (config.useBasicInfo) {
    const genres = list(payload.genres)
      .map((item) => text(item.name))
      .filter((item): item is string => !!item);
    const rating = number(payload.vote_average);
    next = {
      ...next,
      name: text(payload[series ? "name" : "title"]) || next.name,
      description: text(payload.overview) || next.description,
      imdbRating:
        next.imdbRating || (rating == null ? undefined : rating.toFixed(1)),
      genres: genres.length ? genres : next.genres,
    };
  }
  if (config.useDetails) {
    const runtime = number(payload.runtime) || number((payload.episode_run_time as unknown[])?.[0]);
    next = {
      ...next,
      status: text(payload.status) || next.status,
      ageRating: ageRating(payload, series) || next.ageRating,
      runtime: runtime == null ? next.runtime : `${runtime}m`,
      language: text(payload.original_language) || next.language,
    };
  }
  if (config.useReleaseDates) {
    const released = text(payload[series ? "first_air_date" : "release_date"]);
    next = {
      ...next,
      releaseInfo: released || next.releaseInfo,
      released: released || next.released,
    };
  }
  if (config.useCredits) {
    const people = tmdbPeople(payload, series);
    next = {
      ...next,
      cast: mergeCast(next.cast, people.cast),
      director: people.directors.length ? people.directors : next.director,
      writer: people.writers.length ? people.writers : next.writer,
    };
  }
  if (config.useTrailers) {
    const trailers = tmdbTrailers(payload);
    if (trailers.length) next = { ...next, trailers };
  }
  return next;
}

async function enrichEpisodes(
  meta: Meta,
  tmdbId: number,
  config: MetadataEnrichmentConfig["tmdb"],
  trace?: DetailsTrace,
): Promise<Meta> {
  if (
    (!config.useEpisodes && !config.useReleaseDates) ||
    !isSeries(meta.type) ||
    !meta.videos.length
  )
    return meta;
  const seasons = [...new Set(meta.videos.map((item) => item.season).filter((item): item is number => item != null))];
  const results = await Promise.allSettled(
    seasons.map(async (season) => ({
      season,
      payload: json(
        await cachedJson(
          tmdbUrl(`tv/${tmdbId}/season/${season}`, config.apiKey, config.language),
          trace,
        ),
      ),
    })),
  );
  const episodeMap = new Map<string, Json>();
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.payload) continue;
    for (const episode of list(result.value.payload.episodes)) {
      const number = episode.episode_number;
      if (typeof number === "number")
        episodeMap.set(`${result.value.season}:${number}`, episode);
    }
  }
  return {
    ...meta,
    videos: meta.videos.map((video): Video => {
      const item = episodeMap.get(`${video.season}:${video.episode}`);
      if (!item) return video;
      return {
        ...video,
        title: config.useEpisodes ? text(item.name) || video.title : video.title,
        overview: config.useEpisodes
          ? text(item.overview) || video.overview
          : video.overview,
        released: config.useReleaseDates
          ? text(item.air_date) || video.released
          : video.released,
        thumbnail: config.useEpisodes
          ? image(item.still_path, "w500") || video.thumbnail
          : video.thumbnail,
        runtime: config.useEpisodes
          ? number(item.runtime) || video.runtime
          : video.runtime,
        // The season payload already carries a score per episode, and this is
        // the only per-episode rating available to a browser: addons supply a
        // rating for the show but not for its episodes, and the service the
        // native clients use for that sends no CORS headers.
        // The addon's own score wins: it is an actual IMDb rating, where
        // TMDB's vote average is a different measure that merely looks alike.
        imdbRating: config.useEpisodes
          ? video.imdbRating ?? episodeScore(item)
          : video.imdbRating,
        ratingSource: config.useEpisodes
          ? video.ratingSource ?? (episodeScore(item) ? "tmdb" : undefined)
          : video.ratingSource,
      };
    }),
  };
}

async function enrichMdbList(
  meta: Meta,
  imdb: string | undefined,
  config: MetadataEnrichmentConfig["mdbList"],
  trace?: DetailsTrace,
): Promise<Meta> {
  if (!config.enabled || !config.apiKey || !imdb) return meta;
  const media = isSeries(meta.type) ? "show" : "movie";
  // The native clients use MDBList's older per-provider POST route. In a web
  // page that request is preflighted because it has a JSON body, and MDBList's
  // OPTIONS response is currently 405. The current single-title endpoint is a
  // simple GET and returns every provider score in one response, so it works in
  // browsers and is considerably cheaper than eight separate requests.
  const url = new URL(`https://api.mdblist.com/imdb/${media}/${imdb}/`);
  url.searchParams.set("apikey", config.apiKey);
  const payload = await cachedJson(url.toString(), trace);
  const fetched = mdbListRatings(payload, config.providers);
  if (!fetched.length) return meta;

  // Preserve any addon-supplied providers that MDBList did not return while
  // allowing the explicitly enabled MDBList providers to be authoritative.
  const merged = new Map(
    meta.externalRatings.map((rating) => [
      mdbListProvider(rating.source),
      rating,
    ]),
  );
  for (const rating of fetched) merged.set(rating.source, rating);
  return { ...meta, externalRatings: [...merged.values()] };
}

const MDBLIST_PROVIDER_ALIASES: Record<string, string> = {
  imdb: "imdb",
  internetmoviedatabase: "imdb",
  tmdb: "tmdb",
  themoviedb: "tmdb",
  trakt: "trakt",
  letterboxd: "letterboxd",
  tomatoes: "tomatoes",
  tomato: "tomatoes",
  rottentomatoes: "tomatoes",
  rtomatoes: "tomatoes",
  audience: "audience",
  audiencescore: "audience",
  popcorn: "audience",
  popcornmeter: "audience",
  rtaudience: "audience",
  metacritic: "metacritic",
  mal: "mal",
  myanimelist: "mal",
};

function mdbListProvider(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return MDBLIST_PROVIDER_ALIASES[normalized] || normalized;
}

function mdbListDisplayValue(provider: string, item: Json): number | undefined {
  const value = number(item.value) ?? number(item.rating);
  const score = number(item.score);
  // These services are conventionally displayed on their native decimal
  // scale. MDBList's other providers are displayed as whole percentages.
  if (["imdb", "letterboxd", "mal"].includes(provider)) {
    const decimal = value ?? (score != null ? score / 10 : undefined);
    return decimal != null && decimal > 10 ? decimal / 10 : decimal;
  }
  return score ?? value;
}

/** Normalize both MDBList's current array response and older keyed shapes. */
export function mdbListRatings(
  payload: unknown,
  requestedProviders: string[],
): ExternalRating[] {
  const root = json(payload);
  if (!root) return [];
  const requested = new Set(requestedProviders.map(mdbListProvider));
  const found = new Map<string, ExternalRating>();
  const accept = (source: string, item: Json) => {
    const provider = mdbListProvider(source);
    if (!requested.has(provider)) return;
    const value = mdbListDisplayValue(provider, item);
    if (value != null && value >= 0)
      found.set(provider, { source: provider, value });
  };

  const ratings = root.ratings;
  if (Array.isArray(ratings)) {
    for (const item of list(ratings)) {
      const source =
        text(item.source) || text(item.provider) || text(item.name) || "";
      if (source) accept(source, item);
    }
  } else {
    const keyed = json(ratings);
    if (keyed) {
      for (const [source, raw] of Object.entries(keyed)) {
        const item = json(raw);
        if (item) accept(source, item);
        else if (typeof raw === "number") accept(source, { value: raw });
      }
    }
  }

  // Some MDBList API revisions also expose flattened rating fields.
  for (const provider of requested) {
    if (found.has(provider)) continue;
    const aliases = [
      `${provider}_rating`,
      provider === "tomatoes" ? "rtomatoes" : "",
      provider === "audience" ? "rtaudience" : "",
    ].filter(Boolean);
    for (const key of aliases) {
      const value = number(root[key]);
      if (value != null) {
        accept(provider, { value });
        break;
      }
    }
  }

  return requestedProviders
    .map(mdbListProvider)
    .map((provider) => found.get(provider))
    .filter((rating): rating is ExternalRating => !!rating);
}

/** Addon metadata first, TMDB second, MDBList ratings last — matching Nuvio. */
export async function enrichMetadata(
  meta: Meta,
  config: MetadataEnrichmentConfig,
  trace?: DetailsTrace,
): Promise<Meta> {
  let next = meta;
  let resolvedImdb = imdbId(meta.id);
  if (config.tmdb.enabled && config.tmdb.apiKey) {
    try {
      const id = await resolveTmdbId(meta, config.tmdb, trace);
      if (id) {
        const media = isSeries(meta.type) ? "tv" : "movie";
        const language = normalizeLanguage(config.tmdb.language);
        const languageCode = language.split("-")[0];
        const [payload, imagePayload] = await Promise.all([
          cachedJson(
            tmdbUrl(`${media}/${id}`, config.tmdb.apiKey, language, {
              append_to_response:
                media === "tv"
                  ? // Both: `aggregate_credits` bills the cast across every
                    // season, while the crew this screen reads (director,
                    // writer) is only on `credits`.
                    "aggregate_credits,credits,videos,content_ratings,external_ids"
                  : "credits,videos,release_dates,external_ids",
            }),
            trace,
          ),
          cachedJson(
            tmdbUrl(`${media}/${id}/images`, config.tmdb.apiKey, language, {
              include_image_language: `${languageCode},${language},en,null`,
            }),
            trace,
          ).catch(() => null),
        ]);
        const details = json(payload);
        if (details) {
          next = applyTmdbPayload(next, details, json(imagePayload), config.tmdb);
          resolvedImdb =
            text(json(details.external_ids)?.imdb_id) || resolvedImdb;
          next = await enrichEpisodes(next, id, config.tmdb, trace);
        }
      }
    } catch {
      // Enrichment is optional; addon metadata remains the authoritative fallback.
    }
  }
  return enrichMdbList(next, resolvedImdb, config.mdbList, trace).catch(() => next);
}
