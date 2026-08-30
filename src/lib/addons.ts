import { resolveTmdbSource } from "./tmdbCollections";
import {
  createHostLimiter,
  hostKey,
  isRetryable,
  retryAfterMs,
  runPool,
  MAX_RETRIES,
} from "./requestPolicy.ts";
import { mediaTypeLabel, type HomeLayout } from "./account";
import { platform } from "../platform/index.ts";
import type {
  AddonManifest,
  AddonRow,
  CatalogSection,
  CollectionCatalogSource,
  CollectionFolder,
  InstalledAddon,
  ManifestCatalog,
  Meta,
  Stream,
  Video,
} from "../types";

const JSON_LIMIT = 6 * 1024 * 1024;

function safeAddonUrl(value: string): URL {
  const url = new URL(value.trim());
  if (url.username || url.password)
    throw new Error("Addon URLs cannot contain credentials.");
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Addons must use HTTPS (localhost may use HTTP).");
  }
  return url;
}

export function normalizeManifestUrl(value: string): string {
  const url = safeAddonUrl(value);
  if (!url.pathname.endsWith("manifest.json")) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/manifest.json`;
  }
  return url.toString();
}

/** Nuvio delegates configuration to the addon's own endpoint. */
export function addonConfigureUrl(manifestUrl: string): string {
  const url = safeAddonUrl(normalizeManifestUrl(manifestUrl));
  url.search = "";
  url.hash = "";
  url.pathname = `${url.pathname.replace(/manifest\.json\/?$/i, "").replace(/\/+$/, "")}/configure`;
  return url.toString();
}

/** Shared by every addon request, so the whole app counts as one caller. */
const limitPerHost = createHostLimiter();

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** One attempt, with its own timeout so a retry starts the clock again. */
async function fetchJsonOnce<T>(
  url: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<T> {
  const response = await platform.request(url, {
    signal,
    timeoutMs,
    maxBytes: JSON_LIMIT,
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`) as Error & {
      status?: number;
      retryAfter?: string | null;
    };
    error.status = response.status;
    // The retry schedule reads this, so a host asking for later still gets
    // waited for rather than retried on our own timetable.
    error.retryAfter = response.headers["retry-after"] ?? null;
    throw error;
  }
  return JSON.parse(response.body) as T;
}

/**
 * Every addon request goes through here, which is what makes the limit mean
 * anything: a home screen full of catalogs from one addon queues against
 * itself instead of arriving all at once and being rate-limited.
 */
async function fetchJson<T>(
  url: string,
  timeoutMs = 14_000,
  signal?: AbortSignal,
): Promise<T> {
  safeAddonUrl(url);
  return limitPerHost(url, async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fetchJsonOnce<T>(url, timeoutMs, signal);
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (
          attempt >= MAX_RETRIES ||
          status === undefined ||
          !isRetryable(status) ||
          signal?.aborted
        )
          throw error;
        // The host asked for later, so wait the time it named rather than
        // trying again straight away and earning another 429.
        await wait(
          retryAfterMs((error as { retryAfter?: string | null }).retryAfter, attempt),
          signal,
        );
      }
    }
  });
}

function resourceUrl(
  manifestUrl: string,
  resource: string,
  type: string,
  id: string,
  extras: Record<string, string | number> = {},
): string {
  const url = new URL(normalizeManifestUrl(manifestUrl));
  const base = url.pathname.replace(/manifest\.json$/, "");
  const suffix = Object.entries(extras)
    .filter(([, value]) => value !== "")
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");
  url.pathname = `${base}${resource}/${encodeURIComponent(type)}/${encodeURIComponent(id)}${suffix ? `/${suffix}` : ""}.json`;
  return url.toString();
}

/**
 * An episode's score, or nothing.
 *
 * Cinemeta sends the string "0" for every episode it has no rating for — all
 * 32 of Reacher's, for instance — so a badge built straight from the field
 * reads "IMDb 0" across a whole show. Zero is absence here, not a score, and
 * an addon that sends no rating at all should look the same as one that sends
 * zero rather than different.
 */
function episodeRating(value: Record<string, unknown>): string | undefined {
  const raw = value.imdbRating ?? value.imdb_rating ?? value.rating;
  if (raw == null || String(raw).trim() === "") return undefined;
  const score = Number(raw);
  return Number.isFinite(score) && score > 0 ? String(raw) : undefined;
}

function mapVideo(value: Record<string, unknown>): Video {
  return {
    id: String(value.id ?? ""),
    title: String(value.title ?? value.name ?? "Episode"),
    season: value.season == null ? undefined : Number(value.season),
    episode: value.episode == null ? undefined : Number(value.episode),
    released: value.released ? String(value.released) : undefined,
    thumbnail: value.thumbnail ? String(value.thumbnail) : undefined,
    overview: value.overview ? String(value.overview) : undefined,
    runtime: value.runtime == null ? undefined : Number(value.runtime),
    imdbRating: episodeRating(value),
    // Only an addon-supplied score is an IMDb one; enrichment marks its own.
    ratingSource: episodeRating(value) ? "imdb" : undefined,
    available: value.available !== false,
  };
}

function stringList(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return [
    ...new Set(
      items
        .map((item) =>
          typeof item === "object" && item
            ? String((item as Record<string, unknown>).name ?? "")
            : String(item),
        )
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function linkedNames(value: Record<string, unknown>, categories: string[]) {
  return Array.isArray(value.links)
    ? value.links
        .map((item) => item as Record<string, unknown>)
        .filter((item) =>
          categories.includes(String(item.category ?? "").toLowerCase()),
        )
        .map((item) => String(item.name ?? "").trim())
        .filter(Boolean)
    : [];
}

export function mapMeta(
  value: Record<string, unknown>,
  manifestUrl: string,
  addonName: string,
): Meta {
  const appExtras =
    typeof value.app_extras === "object" && value.app_extras
      ? (value.app_extras as Record<string, unknown>)
      : {};
  const castSource = appExtras.cast ?? value.cast;
  const cast = Array.isArray(castSource)
    ? castSource
        .map((person) => {
          if (typeof person === "string") return { name: person };
          const row = person as Record<string, unknown>;
          return {
            name: String(row.name ?? ""),
            role: row.character
              ? String(row.character)
              : row.role
                ? String(row.role)
                : undefined,
            photo: row.photo
              ? String(row.photo)
              : row.profilePath
                ? String(row.profilePath)
                : undefined,
            tmdbId: row.tmdbId == null ? undefined : Number(row.tmdbId),
          };
        })
        .filter((person) => person.name)
    : typeof castSource === "string"
      ? castSource
          .split(",")
          .map((name) => ({ name: name.trim() }))
          .filter((person) => person.name)
      : [];
  for (const name of linkedNames(value, ["cast", "actor", "actors"]))
    if (
      !cast.some((person) => person.name.toLowerCase() === name.toLowerCase())
    )
      cast.push({ name });
  const directors = [
    ...stringList(value.director),
    ...stringList(appExtras.directors),
    ...linkedNames(value, ["director", "directors"]),
  ];
  const writers = [
    ...stringList(value.writer),
    ...stringList(appExtras.writers),
    ...linkedNames(value, ["writer", "writers", "screenplay"]),
  ];
  const trailers = Array.isArray(value.trailers)
    ? value.trailers
        .map((item) => item as Record<string, unknown>)
        .map((item) => {
          const key = String(
            item.key ?? item.source ?? item.ytId ?? item.ytid ?? "",
          );
          return {
            id: String(item.id ?? key),
            key,
            name: String(item.name ?? "Trailer"),
            site: String(item.site ?? "YouTube"),
            trailerType: String(item.type ?? "Trailer"),
            displayName: item.displayName
              ? String(item.displayName)
              : item.display_name
                ? String(item.display_name)
                : undefined,
          };
        })
        .filter((item) => item.key)
    : [];
  const externalRatings = Array.isArray(value.externalRatings)
    ? value.externalRatings
        .map((item) => item as Record<string, unknown>)
        .map((item) => ({
          source: String(item.source ?? ""),
          value: Number(item.value ?? 0),
        }))
        .filter((item) => item.source && Number.isFinite(item.value))
    : [];
  return {
    id: String(value.id ?? ""),
    type: String(value.type ?? "movie"),
    name: String(value.name ?? "Untitled"),
    poster: value.poster ? String(value.poster) : undefined,
    posterShape: value.posterShape ? String(value.posterShape) : undefined,
    background: value.background
      ? String(value.background)
      : value.banner
        ? String(value.banner)
        : undefined,
    banner: value.banner ? String(value.banner) : undefined,
    logo: value.logo ? String(value.logo) : undefined,
    description: value.description ? String(value.description) : undefined,
    releaseInfo: value.releaseInfo ? String(value.releaseInfo) : undefined,
    released: value.released ? String(value.released) : undefined,
    imdbRating: value.imdbRating ? String(value.imdbRating) : undefined,
    genres: Array.isArray(value.genres) ? value.genres.map(String) : [],
    runtime: value.runtime ? String(value.runtime) : undefined,
    cast,
    director: [...new Set(directors)],
    writer: [...new Set(writers)],
    status: value.status ? String(value.status) : undefined,
    ageRating: value.ageRating ? String(value.ageRating) : undefined,
    language: value.language ? String(value.language) : undefined,
    trailers,
    externalRatings,
    defaultVideoId:
      typeof value.behaviorHints === "object" && value.behaviorHints
        ? String(
            (value.behaviorHints as Record<string, unknown>).defaultVideoId ??
              "",
          ) || undefined
        : undefined,
    videos: Array.isArray(value.videos)
      ? (value.videos as Array<Record<string, unknown>>).map((video) =>
          mapVideo(video),
        )
      : [],
    manifestUrl,
    addonName,
  };
}

function supports(
  manifest: AddonManifest,
  resource: string,
  type?: string,
): boolean {
  return (manifest.resources ?? []).some((item) => {
    if (typeof item === "string") return item === resource;
    return (
      item.name === resource &&
      (!type || !item.types?.length || item.types.includes(type))
    );
  });
}

/**
 * Turns a browser fetch failure into something a user can act on.
 *
 * The native clients reach addons a browser cannot, so "works on desktop,
 * empty on web" is the normal shape of this bug — and `TypeError: Failed to
 * fetch` is all the platform says about the two most common reasons.
 */
function explainAddonFailure(url: string, error: unknown): string {
  const message = error instanceof Error ? error.message : "Manifest failed";
  if (/^http:/i.test(url.trim()) && !/^(localhost|127\.0\.0\.1|\[::1\])/i.test(new URL(url).hostname))
    return "Served over HTTP. A page on HTTPS cannot load it — the addon needs HTTPS.";
  if (message === "Failed to fetch" || /NetworkError|Load failed/i.test(message))
    return "Unreachable from a browser. Usually the addon sends no CORS header (Access-Control-Allow-Origin), or it is offline.";
  return message;
}

export async function loadInstalledAddons(
  rows: AddonRow[],
): Promise<InstalledAddon[]> {
  return Promise.all(
    rows.map(async (row) => {
      try {
        const url = normalizeManifestUrl(row.url);
        const manifest = await fetchJson<AddonManifest>(url);
        return { ...row, url, name: manifest.name || row.name, manifest };
      } catch (error) {
        return { ...row, error: explainAddonFailure(row.url, error) };
      }
    }),
  );
}

/** Home catalogs fetched at once, across every addon. */
const HOME_CONCURRENCY = 6;

/**
 * How long one home catalog is waited for.
 *
 * Shorter than the 14s a deliberate action gets, because nothing is on screen
 * yet: this is the wait the user reads as "the app is broken". A host that has
 * not answered in eight seconds is not about to.
 */
const HOME_CATALOG_TIMEOUT_MS = 8_000;

/**
 * Failures from one host before the rest of its catalogs are abandoned.
 *
 * Two, not one, so a single catalog that 404s does not condemn the addon it
 * came from.
 */
const HOST_FAILURE_LIMIT = 2;

/**
 * Fetches every browsable catalog across the installed addons.
 *
 * `onSection` fires as each catalog lands so the home screen paints rows while
 * the rest are still in flight — waiting for all of them was what made the page
 * sit blank on a slow connection.
 */
export async function loadHome(
  addons: InstalledAddon[],
  onSection?: (section: CatalogSection) => void,
  layout?: HomeLayout | null,
): Promise<{ sections: CatalogSection[]; errors: string[] }> {
  const isKnownFutureRelease = (meta: Meta): boolean => {
    const now = new Date();
    const released = meta.released?.trim();
    if (released && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(released)) {
      const timestamp = Date.parse(released);
      if (Number.isFinite(timestamp)) return timestamp > now.getTime();
    }
    const releaseInfo = meta.releaseInfo?.trim();
    if (releaseInfo && /^\d{4}$/.test(releaseInfo)) {
      return Number(releaseInfo) > now.getFullYear();
    }
    return false;
  };
  const sections: CatalogSection[] = [];
  const errors: string[] = [];
  // Reported, not just skipped. An enabled addon with no manifest contributes
  // no catalogs, and this used to drop it in silence — so a user whose addons
  // all failed saw an empty home page and no message at all, which is the
  // hardest possible version of this to diagnose from a bug report.
  for (const addon of addons)
    if (addon.enabled && !addon.manifest)
      errors.push(`${addon.name ?? addon.url}: ${addon.error ?? "manifest did not load"}`);

  // Every catalog that will not appear, and the reason. A catalog held back by
  // a required extra and one switched off in the layout are indistinguishable
  // on screen — both are simply absent — so they are separated here.
  const skipped: Array<{ catalog: string; reason: string; detail?: string }> = [];

  const targets = addons
    .filter((addon) => addon.enabled && addon.manifest)
    .flatMap((addon) =>
      (addon.manifest!.catalogs ?? [])
        .filter((catalog) => {
          const required = (catalog.extra ?? []).filter((extra) => extra.isRequired);
          if (!required.length) return true;
          // Matches Nuvio's own home filter, which drops any catalog needing an
          // input the home screen has no way to supply.
          skipped.push({
            catalog: `${addon.manifest!.name}: ${catalog.type}/${catalog.id}`,
            reason: "needs a required extra",
            detail: required.map((extra) => extra.name).join(", "),
          });
          return false;
        })
        .map((catalog) => ({
          addon,
          catalog,
          prefKey: `${addon.manifest!.id}:${catalog.type}:${catalog.id}`,
        })),
    )
    // A catalog the layout does not mention is new to this device, so it stays
    // visible — matching how the other clients treat an unknown key.
    .filter(({ addon, catalog, prefKey }) => {
      if (layout?.enabledOf.get(prefKey) !== false) return true;
      skipped.push({
        catalog: `${addon.manifest!.name}: ${catalog.type}/${catalog.id}`,
        reason: "switched off in the home layout",
        detail: prefKey,
      });
      return false;
    });


  // Ordered before batching, so the rows the user put on top are the ones
  // fetched first and therefore the ones that paint first.

  if (layout)
    targets.sort(
      (a, b) =>
        (layout.orderOf.get(a.prefKey) ?? Number.MAX_SAFE_INTEGER) -
        (layout.orderOf.get(b.prefKey) ?? Number.MAX_SAFE_INTEGER),
    );
  /**
   * Failures so far per host, and the reason the pool is worth having.
   *
   * One addon supplies most of a home screen, so a host that has stopped
   * answering is not one timeout but a dozen — and the user waits through every
   * one of them to reach a page the working addons could have filled in
   * seconds. After the budget is spent its remaining catalogs are given up on
   * without being asked.
   */
  const failures = new Map<string, number>();
  await runPool(targets, HOME_CONCURRENCY, async ({ addon, catalog }) => {
    const host = hostKey(addon.url);
    if ((failures.get(host) ?? 0) >= HOST_FAILURE_LIMIT) {
      skipped.push({
        catalog: `${addon.manifest!.name}: ${catalog.type}/${catalog.id}`,
        reason: "host stopped answering",
        detail: host,
      });
      return;
    }
    try {
      const catalogUrl = resourceUrl(addon.url, "catalog", catalog.type, catalog.id);
      const payload = await fetchJson<{
        metas?: Array<Record<string, unknown>>;
      }>(catalogUrl, HOME_CATALOG_TIMEOUT_MS);
      const prefKey = `${addon.manifest!.id}:${catalog.type}:${catalog.id}`;
      const base = catalog.name || catalog.id;
      const section = {
        key: prefKey,
        // A row renamed in Nuvio wins outright; otherwise the type suffix
        // disambiguates the several catalogs all called "Popular".
        name:
          layout?.customTitleOf.get(prefKey) ??
          (layout?.showCatalogType !== false
            ? `${base} - ${mediaTypeLabel(catalog.type)}`
            : base),
        type: catalog.type,
        manifestUrl: addon.url,
        addonName: addon.manifest!.name,
        catalogId: catalog.id,
        items: (payload.metas ?? [])
          .map((meta) => mapMeta(meta, addon.url, addon.manifest!.name))
          .filter(
            (meta) =>
              layout?.hideUnreleasedContent !== true || !isKnownFutureRelease(meta),
          )
          .slice(0, 24),
      } satisfies CatalogSection;
      if (!section.items.length) return;
      sections.push(section);
      onSection?.(section);
    } catch (error) {
      const spent = (failures.get(host) ?? 0) + 1;
      failures.set(host, spent);
      errors.push(
        `${addon.name ?? addon.url}: ${error instanceof Error ? error.message : "catalog failed"}`,
      );
      // Said once, when the budget runs out, rather than once per catalog left.
      if (spent === HOST_FAILURE_LIMIT)
        errors.push(`${addon.name ?? addon.url}: skipping its remaining catalogs.`);
    }
  });
  return { sections, errors };
}

/** TMDB's fixed page size, which its offset arithmetic depends on. */
const TMDB_PAGE = 20;

/** One collection source resolved against the installed addons. */
export type CollectionSourceView = {
  source: CollectionCatalogSource;
  key: string;
  label: string;
  addonName: string;
  supportsPagination: boolean;
};

/**
 * A catalog's kind, appended only when its own name does not already say it.
 * Plenty of addons name both catalogs after the service — two entries both
 * reading "HBO Max" is unusable, while "HBO Max Movies" needs nothing added.
 */
export function catalogTypeSuffix(name: string, contentType: string): string {
  const label =
    contentType === "series"
      ? "Series"
      : contentType === "movie"
        ? "Movies"
        : contentType.charAt(0).toUpperCase() + contentType.slice(1);
  const haystack = name.toLowerCase();
  const spoken = [label.toLowerCase(), contentType.toLowerCase()];
  // "Movies" should also match a name that says "Movie", and vice versa.
  if (label === "Movies") spoken.push("movie", "film");
  if (label === "Series") spoken.push("serie", "shows", "tv");
  return spoken.some((word) => haystack.includes(word)) ? "" : ` ${label}`;
}

/**
 * Labels each source the way Nuvio's folder tabs do: the catalog's own name,
 * plus its kind and the genre when the source pins one.
 */
/**
 * A stable string for a filter set, used to tell two otherwise identical
 * sources apart. Sorted by key so the same filters always produce the same
 * string regardless of the order they were serialised in.
 */
function stableFilterKey(filters?: Record<string, string | number>): string {
  if (!filters) return "";
  return Object.keys(filters)
    .sort()
    .map((key) => `${key}=${filters[key]}`)
    .join("&");
}

export function describeCollectionSources(
  folder: CollectionFolder,
  addons: InstalledAddon[],
): CollectionSourceView[] {
  return folder.catalogSources.flatMap((source) => {
    // TMDB and Trakt sources belong to no installed addon, so requiring one
    // dropped them here — before a tab existed, before a request was made, and
    // with nothing to report. The folder simply came back empty.
    const provider = (source.provider || "addon").toLowerCase();
    if (provider !== "addon") {
      const kind = (source.tmdbSourceType ?? "list").toLowerCase();
      // Mirrors Nuvio's catalogRouteKey, filters included. Nuvio ends its TMDB
      // key with filters.hashCode() for a reason: a channel's sources differ
      // only by their filters, so leaving them out collapsed every one of them
      // onto the same key — and picking a single catalog then matched all of
      // them, which is exactly what "All catalogs" already does.
      const key =
        provider === "tmdb"
          ? `tmdb_${kind}_${source.tmdbId ?? ""}_${source.mediaType ?? ""}_${source.sortBy ?? ""}_${stableFilterKey(source.filters)}`
          : `trakt_${source.traktListId ?? ""}_${source.mediaType ?? ""}_${source.sortBy ?? ""}_${source.sortHow ?? ""}`;
      return [
        {
          source,
          key,
          label:
            source.title?.trim() ||
            `${provider === "tmdb" ? "TMDB" : "Trakt"} ${kind}`,
          addonName: provider === "tmdb" ? "TMDB" : "Trakt",
          // Only the paged TMDB endpoints; a collection or a person's credits
          // come back whole.
          supportsPagination:
            provider === "tmdb" && ["list", "discover", "company", "network"].includes(kind),
        },
      ];
    }
    const addon = addons.find(
      (item) => item.enabled && item.manifest?.id === source.addonId,
    );
    const catalog = addon?.manifest?.catalogs?.find(
      (item) => item.type === source.type && item.id === source.catalogId,
    );
    if (!addon?.manifest || !catalog) return [];
    const rawName = catalog.name?.trim() || catalog.id;
    const base = `${rawName}${catalogTypeSuffix(rawName, source.type)}`;
    const genre = source.genre?.trim();
    return [
      {
        source,
        key: `${source.addonId}:${source.type}:${source.catalogId}:${genre ?? ""}`,
        label: genre ? `${base} · ${genre}` : base,
        addonName: addon.manifest.name,
        supportsPagination: (catalog.extra ?? []).some(
          (extra) => extra.name.toLowerCase() === "skip",
        ),
      },
    ];
  });
}

/**
 * Fetches one page from each of the given sources in parallel and merges them.
 *
 * Source order is meaningful, so results are restored to it rather than left
 * in completion order, and duplicates across sources are dropped keeping the
 * first appearance.
 */
export async function loadCollectionSources(
  sources: CollectionCatalogSource[],
  addons: InstalledAddon[],
  skip = 0,
  /** TMDB API key from the profile's provider credentials, when one is saved. */
  tmdbApiKey = "",
  /** Where in `sources` to resume. "All" pages through the list with this. */
  sourceOffset = 0,
): Promise<{
  items: Meta[];
  errors: string[];
  nextSkip?: number;
  nextSourceOffset?: number;
}> {
  const errors: string[] = [];
  const seen = new Set<string>();
  const items: Meta[] = [];
  let tmdbHasMore = false;

  const fetchSource = async (source: CollectionCatalogSource) => {
    // TMDB and Trakt sources are lists on those services, not catalogs on an
    // installed addon, and this client cannot read them yet. Saying so is the
    // point: they used to be resolved as addon sources with a blank addonId
    // and reported as "Collection addon  is not installed", which is both
    // wrong and unactionable.
    if (source.provider === "tmdb") {
      if (!tmdbApiKey.trim()) {
        errors.push(
          `${source.title ?? "TMDB source"}: add a TMDB API key in Settings to load this.`,
        );
        return [] as Meta[];
      }
      try {
        // TMDB pages; the addon path uses an item offset. Converting by item
        // count stalled as soon as a page came back short — 19 items meant
        // floor(19/20)+1 = page 1 again, the same titles, and the view decided
        // it had reached the end. The offset therefore counts pages, not items.
        const page = Math.floor(skip / TMDB_PAGE) + 1;
        const result = await resolveTmdbSource(source, tmdbApiKey.trim(), page);
        if (result.nextPage) tmdbHasMore = true;
        return result.items;
      } catch (error) {
        errors.push(
          `${source.title ?? "TMDB source"}: ${error instanceof Error ? error.message : "TMDB request failed"}`,
        );
        return [] as Meta[];
      }
    }
    if (source.provider && source.provider !== "addon") {
      errors.push(
        `${source.title ?? source.provider.toUpperCase()}: ${source.provider.toUpperCase()} collection sources are not supported in the web client yet.`,
      );
      return [] as Meta[];
    }
    const addon = addons.find(
      (item) => item.enabled && item.manifest?.id === source.addonId,
    );
    if (!addon?.manifest) {
      errors.push(`Collection addon ${source.addonId || "(unnamed)"} is not installed`);
      return [] as Meta[];
    }
    const extras: Record<string, string | number> = {};
    if (source.genre?.trim()) extras.genre = source.genre.trim();
    if (skip) extras.skip = skip;
    try {
      const payload = await fetchJson<{
        metas?: Array<Record<string, unknown>>;
      }>(
        resourceUrl(addon.url, "catalog", source.type, source.catalogId, extras),
      );
      return (payload.metas ?? []).map((meta) =>
        mapMeta(meta, addon.url, addon.manifest!.name),
      );
    } catch (error) {
      errors.push(
        `${addon.manifest.name}: ${error instanceof Error ? error.message : "catalog failed"}`,
      );
      return [] as Meta[];
    }
  };

  // A few at a time, stopping once the page is full.
  //
  // This used to be Promise.all over every source. A collection with three
  // thousand of them opened three thousand fetches at once, and since a browser
  // runs about six per host the rest sat in a queue — each already counting
  // down the 14s timeout that starts when the request is created, not when it
  // is sent. Nearly all of them therefore aborted before they were ever sent,
  // so a large collection reliably came back empty and took the tab down with
  // it.
  const CONCURRENCY = 6;
  const TARGET_ITEMS = 120;
  let cursor = Math.max(0, sourceOffset);
  while (cursor < sources.length && items.length < TARGET_ITEMS) {
    const slice = sources.slice(cursor, cursor + CONCURRENCY);
    cursor += slice.length;
    const batch = await Promise.all(slice.map(fetchSource));
    for (const metas of batch)
      for (const item of metas) {
        const key = `${item.type}:${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
  }
  const byProvider: Record<string, number> = {};
  for (const source of sources)
    byProvider[source.provider || "addon"] =
      (byProvider[source.provider || "addon"] ?? 0) + 1;
  return {
    items,
    errors,
    // Only meaningful when TMDB reported another page; addon sources keep using
    // the item-offset paging they already had.
    nextSkip: tmdbHasMore ? skip + TMDB_PAGE : undefined,
    // Where the next call should resume. Without this the page budget meant
    // "All" only ever saw the first few sources: it filled up, stopped, and
    // every later request started from the beginning again.
    nextSourceOffset: cursor < sources.length ? cursor : undefined,
  };
}

export async function loadCatalog(
  section: CatalogSection,
  skip = 0,
  search = "",
): Promise<Meta[]> {
  const extras: Record<string, string | number> = {};
  if (skip) extras.skip = skip;
  if (search) extras.search = search;
  const payload = await fetchJson<{ metas?: Array<Record<string, unknown>> }>(
    resourceUrl(
      section.manifestUrl,
      "catalog",
      section.type,
      section.catalogId,
      extras,
    ),
  );
  return (payload.metas ?? []).map((meta) =>
    mapMeta(meta, section.manifestUrl, section.addonName),
  );
}

export async function resolveMeta(
  seed: Meta,
  addons: InstalledAddon[],
): Promise<Meta> {
  const ordered = [...addons].sort(
    (left, right) =>
      Number(right.url === seed.manifestUrl) -
      Number(left.url === seed.manifestUrl),
  );
  for (const addon of ordered) {
    if (
      !addon.enabled ||
      !addon.manifest ||
      !supports(addon.manifest, "meta", seed.type)
    )
      continue;
    try {
      const payload = await fetchJson<{ meta?: Record<string, unknown> }>(
        resourceUrl(addon.url, "meta", seed.type, seed.id),
      );
      if (payload.meta)
        return mapMeta(payload.meta, addon.url, addon.manifest.name);
    } catch {
      // Continue through metadata providers in installed priority order.
    }
  }
  return seed;
}

export type AddonSearchGroup = {
  key: string;
  name: string;
  type: string;
  addonName: string;
  items: Meta[];
};

export type AddonSearchResult = {
  items: Meta[];
  groups: AddonSearchGroup[];
};

export async function searchAddons(
  query: string,
  addons: InstalledAddon[],
): Promise<AddonSearchResult> {
  const sections = addons
    .filter((addon) => addon.enabled && addon.manifest)
    .flatMap((addon) =>
      (addon.manifest!.catalogs ?? [])
        .filter((catalog) =>
          (catalog.extra ?? []).some((extra) => extra.name === "search"),
        )
        .map(
          (catalog) =>
            ({
              key: "",
              name: catalog.name || catalog.id,
              type: catalog.type,
              manifestUrl: addon.url,
              addonName: addon.manifest!.name,
              catalogId: catalog.id,
              items: [],
            }) satisfies CatalogSection,
        ),
    );
  const groups = await Promise.all(
      sections.slice(0, 12).map(async (section, index) => {
        const found = await loadCatalog(section, 0, query).catch(() => []);
        const items = [
          ...new Map(
            found.map((item) => [`${item.type}:${item.id}`, item]),
          ).values(),
        ];
        return {
          key: `${section.manifestUrl}:${section.type}:${section.catalogId}:${index}`,
          name: section.name,
          type: section.type,
          addonName: section.addonName,
          items,
        } satisfies AddonSearchGroup;
      }),
    );
  const items = [
    ...new Map(
      groups
        .flatMap((group) => group.items)
        .map((item) => [`${item.type}:${item.id}`, item]),
    ).values(),
  ];
  return { items, groups };
}

export async function loadStreams(
  type: string,
  id: string,
  addons: InstalledAddon[],
  signal?: AbortSignal,
): Promise<Stream[]> {
  const targets = addons.filter(
    (addon) =>
      addon.enabled &&
      addon.manifest &&
      supports(addon.manifest, "stream", type),
  );
  const groups = await Promise.all(
    targets.map(async (addon) => {
      try {
        const payload = await fetchJson<{
          streams?: Array<Record<string, unknown>>;
        }>(resourceUrl(addon.url, "stream", type, id), 20_000, signal);
        return (payload.streams ?? []).map((stream): Stream => ({
          name: String(stream.name ?? addon.manifest!.name),
          title: String(stream.title ?? ""),
          description: String(stream.description ?? ""),
          url: stream.url ? String(stream.url) : undefined,
          externalUrl: stream.externalUrl
            ? String(stream.externalUrl)
            : undefined,
          infoHash: stream.infoHash ? String(stream.infoHash) : undefined,
          fileIdx: stream.fileIdx == null ? undefined : Number(stream.fileIdx),
          addonName: addon.manifest!.name,
          addonLogo: addon.manifest!.logo,
          behaviorHints:
            typeof stream.behaviorHints === "object"
              ? (stream.behaviorHints as Stream["behaviorHints"])
              : undefined,
          // Passed through rather than parsed. Only a shell that can reach a
          // Debrid service does anything with it, and the filters read fields
          // this client has no other reason to know about.
          clientResolve:
            typeof stream.clientResolve === "object" && stream.clientResolve
              ? (stream.clientResolve as Stream["clientResolve"])
              : undefined,
        }));
      } catch {
        return [];
      }
    }),
  );
  return groups.flat();
}

export type DiscoverCatalog = {
  key: string;
  addonName: string;
  manifestUrl: string;
  contentType: string;
  catalogId: string;
  catalogName: string;
  genreOptions: string[];
  genreRequired: boolean;
  supportsPagination: boolean;
};

/**
 * Whether a catalog can be browsed without a search term, mirroring the
 * desktop client's `supports_discover`: a required `search` disqualifies it,
 * `skip` never does, and a required `genre` is fine as long as the manifest
 * actually lists options to pick from.
 */
function supportsDiscover(catalog: ManifestCatalog): boolean {
  const extras = catalog.extra ?? [];
  if (extras.some((extra) => extra.name === "search" && extra.isRequired))
    return false;
  return !extras.some((extra) => {
    if (extra.name === "genre")
      return !!extra.isRequired && (extra.options ?? []).length === 0;
    if (extra.name === "skip" || extra.name === "search") return false;
    return !!extra.isRequired;
  });
}

/**
 * Catalogs for the Discover filters, in installed-addon priority and each
 * manifest's own catalog order. Deliberately unsorted — sorting would make the
 * picker disagree with the addon configuration and with the other clients.
 */
export function discoverCatalogs(addons: InstalledAddon[]): DiscoverCatalog[] {
  const seen = new Set<string>();
  const result: DiscoverCatalog[] = [];
  for (const addon of addons) {
    if (!addon.enabled || !addon.manifest) continue;
    for (const catalog of addon.manifest.catalogs ?? []) {
      if (!supportsDiscover(catalog)) continue;
      const key = `${addon.manifest.id}:${catalog.type}:${catalog.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const genre = (catalog.extra ?? []).find(
        (extra) => extra.name === "genre",
      );
      result.push({
        key,
        addonName: addon.manifest.name,
        manifestUrl: addon.url,
        contentType: catalog.type,
        catalogId: catalog.id,
        catalogName: catalog.name?.trim() || catalog.id,
        genreOptions: genre?.options ?? [],
        genreRequired: !!genre?.isRequired,
        supportsPagination: (catalog.extra ?? []).some(
          (extra) => extra.name.toLowerCase() === "skip",
        ),
      });
    }
  }
  return result;
}

export async function loadDiscoverCatalog(
  catalog: DiscoverCatalog,
  genre?: string,
  skip = 0,
): Promise<Meta[]> {
  const extras: Record<string, string | number> = {};
  if (genre) extras.genre = genre;
  if (skip) extras.skip = skip;
  const payload = await fetchJson<{ metas?: Array<Record<string, unknown>> }>(
    resourceUrl(
      catalog.manifestUrl,
      "catalog",
      catalog.contentType,
      catalog.catalogId,
      extras,
    ),
  );
  return (payload.metas ?? []).map((meta) =>
    mapMeta(meta, catalog.manifestUrl, catalog.addonName),
  );
}
