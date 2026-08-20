import { platform } from "../platform/index.ts";
import type { CollectionCatalogSource, Meta } from "../types";

/**
 * Resolves TMDB-backed collection sources.
 *
 * A Nuvio collection folder can point at TMDB rather than an installed addon —
 * a list, a movie collection, a studio, a network, a person's credits, or a
 * discover query. Those are not catalogs on any addon, so the addon path can
 * never serve them; they are fetched from TMDB directly here.
 *
 * Mirrors `TmdbCollectionSourceResolver.kt` so a folder built on one client
 * shows the same titles in the same order on the other.
 */

const API = "https://api.themoviedb.org/3";
const IMAGE = "https://image.tmdb.org/t/p";

export type TmdbPage = { items: Meta[]; nextPage: number | null };

type TmdbItem = {
  id?: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  job?: string;
};

const image = (path: string | undefined, size: string) =>
  path?.trim() ? `${IMAGE}/${size}${path}` : undefined;

/** TMDB's own media type, which decides both the endpoint and the Stremio type. */
function mediaTypeOf(source: CollectionCatalogSource): "movie" | "tv" {
  const declared = (source.mediaType ?? source.type ?? "").toLowerCase();
  if (declared === "tv" || declared === "series") return "tv";
  return "movie";
}

function sourceTypeOf(source: CollectionCatalogSource): string {
  return (source.tmdbSourceType ?? "DISCOVER").toUpperCase();
}

/**
 * The sort key TMDB's discover endpoint accepts, which differs by media type:
 * a TV query has no primary_release_date, and a movie query has no
 * first_air_date. Nuvio translates between them rather than failing.
 */
function discoverSort(sortBy: string | undefined, media: "movie" | "tv") {
  const value = sortBy?.trim();
  if (!value || value === "original") return "popularity.desc";
  if (media === "movie" && value === "first_air_date.desc")
    return "primary_release_date.desc";
  if (media === "tv" && value === "primary_release_date.desc")
    return "first_air_date.desc";
  return value;
}

function toMeta(
  item: TmdbItem,
  media: "movie" | "tv",
  addonName: string,
): Meta | null {
  const name =
    item.title?.trim() ||
    item.name?.trim() ||
    item.original_title?.trim() ||
    item.original_name?.trim();
  if (!name || item.id == null) return null;
  const date = media === "tv" ? item.first_air_date : item.release_date;
  return {
    // The same identity Nuvio uses, so a title opened here and there resolves
    // through the same addons.
    id: `tmdb:${item.id}`,
    type: media === "tv" ? "series" : "movie",
    name,
    poster: image(item.poster_path, "w500") ?? image(item.backdrop_path, "w780"),
    background: image(item.backdrop_path, "w1280"),
    banner: image(item.backdrop_path, "w1280"),
    posterShape: "poster",
    description: item.overview?.trim() || undefined,
    releaseInfo: date?.slice(0, 4),
    released: date || undefined,
    imdbRating:
      item.vote_average != null
        ? String(Math.round(item.vote_average * 10) / 10)
        : undefined,
    genres: [],
    cast: [],
    director: [],
    writer: [],
    trailers: [],
    externalRatings: [],
    videos: [],
    manifestUrl: "",
    addonName,
  } satisfies Meta;
}

/** Applied after fetching, for the source types TMDB cannot sort server-side. */
function sortLocally(items: Meta[], sortBy: string | undefined): Meta[] {
  const value = sortBy?.trim();
  if (!value || value === "original" || value === "popularity.desc") return items;
  const sorted = [...items];
  if (value === "vote_average.desc")
    sorted.sort(
      (left, right) =>
        Number(right.imdbRating ?? -1) - Number(left.imdbRating ?? -1),
    );
  else if (value === "primary_release_date.desc" || value === "first_air_date.desc")
    sorted.sort((left, right) =>
      (right.released ?? "").localeCompare(left.released ?? ""),
    );
  return sorted;
}

async function get<T>(
  endpoint: string,
  apiKey: string,
  query: Record<string, string | number | undefined>,
): Promise<T> {
  const params = new URLSearchParams({ api_key: apiKey });
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && String(value).trim() !== "")
      params.set(key, String(value));
  // The key is withheld; everything else is what decides which titles come
  // back, so two sources returning identical results is visible here.
  const shown = new URLSearchParams(params);
  shown.delete("api_key");
  const response = await platform.request(`${API}/${endpoint}?${params}`);
  if (!response.ok) {
    // 401 is the one worth naming: it means the key, not the source.
    if (response.status === 401)
      throw new Error("TMDB rejected the API key. Check it in Settings.");
    throw new Error(`TMDB returned HTTP ${response.status}`);
  }
  return JSON.parse(response.body) as T;
}

/**
 * Nuvio stores filters under its own camelCase field names, which are not what
 * TMDB accepts — and TMDB ignores parameters it does not recognise rather than
 * rejecting them. Passing them through verbatim therefore dropped every filter
 * silently, so a studio, a network and a plain discover source all returned the
 * same popular list. Mirrors `buildDiscoverQuery`.
 */
function discoverQuery(
  source: CollectionCatalogSource,
  media: "movie" | "tv",
  language: string,
  page: number,
): Record<string, string | number | undefined> {
  const kind = sourceTypeOf(source);
  const filters = (source.filters ?? {}) as Record<string, string | number | undefined>;
  const movie = media === "movie";
  const query: Record<string, string | number | undefined> = {
    language,
    page,
    sort_by: discoverSort(source.sortBy, media),
    // The source's own id wins over any filter carrying the same field.
    with_companies:
      (kind === "COMPANY" ? source.tmdbId : undefined) ?? filters.withCompanies,
    without_companies: filters.withoutCompanies,
    with_networks:
      (kind === "NETWORK" ? source.tmdbId : undefined) ?? filters.withNetworks,
    with_genres: filters.withGenres,
    without_genres: filters.withoutGenres,
    "vote_count.gte": filters.voteCountGte,
    "vote_average.gte": filters.voteAverageGte,
    "vote_average.lte": filters.voteAverageLte,
    with_original_language: filters.withOriginalLanguage,
    with_origin_country: filters.withOriginCountry,
    with_keywords: filters.withKeywords,
    without_keywords: filters.withoutKeywords,
    // Movies filter on year; series on the year they first aired.
    year: movie ? filters.year : undefined,
    first_air_date_year: movie ? undefined : filters.year,
    [movie ? "primary_release_date.gte" : "first_air_date.gte"]:
      filters.releaseDateGte,
    [movie ? "primary_release_date.lte" : "first_air_date.lte"]:
      filters.releaseDateLte,
  };

  // Watch providers only mean anything alongside a region, and TMDB returns
  // nothing at all when one is given without the other.
  const withProviders = String(filters.withWatchProviders ?? "").trim();
  const withoutProviders = String(filters.withoutWatchProviders ?? "").trim();
  if (withProviders || withoutProviders) {
    query.with_watch_providers = withProviders || undefined;
    query.without_watch_providers = withoutProviders || undefined;
    query.watch_region = String(filters.watchRegion ?? "").trim() || "US";
    if (withProviders)
      query.with_watch_monetization_types = "flatrate|free|ads|rent|buy";
  }
  return query;
}

export async function resolveTmdbSource(
  source: CollectionCatalogSource,
  apiKey: string,
  page = 1,
  language = "en-US",
): Promise<TmdbPage> {
  const kind = sourceTypeOf(source);
  const media = mediaTypeOf(source);
  const label = source.title ?? `TMDB ${kind.toLowerCase()}`;

  if (kind === "LIST") {
    if (!source.tmdbId) throw new Error("TMDB list source has no list id.");
    const body = await get<{ items?: TmdbItem[]; page?: number; total_pages?: number }>(
      `list/${source.tmdbId}`,
      apiKey,
      { language, page },
    );
    // A list holds both films and shows, so each entry declares its own type.
    const items = (body.items ?? [])
      .map((item) =>
        toMeta(item, item.media_type?.toLowerCase() === "tv" ? "tv" : "movie", label),
      )
      .filter((meta): meta is Meta => meta !== null);
    const current = body.page ?? page;
    return {
      items: sortLocally(items, source.sortBy),
      nextPage:
        current < (body.total_pages ?? current) && items.length ? current + 1 : null,
    };
  }

  if (kind === "COLLECTION") {
    if (!source.tmdbId) throw new Error("TMDB collection source has no id.");
    const body = await get<{ parts?: TmdbItem[] }>(
      `collection/${source.tmdbId}`,
      apiKey,
      { language },
    );
    const items = (body.parts ?? [])
      .map((item) => toMeta(item, "movie", label))
      .filter((meta): meta is Meta => meta !== null);
    // A collection is returned whole; there is no second page to ask for.
    return { items: sortLocally(items, source.sortBy), nextPage: null };
  }

  if (kind === "PERSON" || kind === "DIRECTOR") {
    if (!source.tmdbId) throw new Error("TMDB person source has no id.");
    const body = await get<{ cast?: TmdbItem[]; crew?: TmdbItem[] }>(
      `person/${source.tmdbId}/combined_credits`,
      apiKey,
      { language },
    );
    const chosen =
      kind === "DIRECTOR"
        ? (body.crew ?? []).filter(
            (credit) => credit.job?.toLowerCase() === "director",
          )
        : (body.cast ?? []);
    const items = chosen
      .map((item) =>
        toMeta(item, item.media_type?.toLowerCase() === "tv" ? "tv" : "movie", label),
      )
      .filter((meta): meta is Meta => meta !== null);
    const seen = new Set<string>();
    const unique = items.filter((meta) => {
      const key = `${meta.type}:${meta.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { items: sortLocally(unique, source.sortBy), nextPage: null };
  }

  // COMPANY, NETWORK and DISCOVER all resolve through discover.
  const body = await get<{
    results?: TmdbItem[];
    page?: number;
    total_pages?: number;
  }>(
    media === "tv" ? "discover/tv" : "discover/movie",
    apiKey,
    discoverQuery(source, kind === "NETWORK" ? "tv" : media, language, page),
  );
  const items = (body.results ?? [])
    .map((item) => toMeta(item, kind === "NETWORK" ? "tv" : media, label))
    .filter((meta): meta is Meta => meta !== null);
  const current = body.page ?? page;
  return {
    items,
    nextPage:
      current < (body.total_pages ?? current) && items.length ? current + 1 : null,
  };
}
