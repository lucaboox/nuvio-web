import {
  tmdbImage,
  tmdbJson,
  tmdbUrl,
  type MetadataEnrichmentConfig,
  // Explicit extension: Vite resolves this either way, but Node's test runner
  // does not, and this module is tested directly.
} from "./metadataEnrichment.ts";
import type { CatalogSection, Meta } from "../types";

/**
 * A person, and everything they have been in.
 *
 * Mirrors the desktop client's `PersonDetail` field for field, and groups the
 * credits the way its screen does — Popular, Latest, Upcoming — so an actor
 * opened on the phone, the desktop and the web reads the same. The grouping is
 * not incidental: a raw filmography sorted one way buries either the work
 * someone is known for or the work they have just done, and both are what you
 * came to the page for.
 */
export type PersonDetail = {
  tmdbId: number;
  name: string;
  biography?: string;
  birthday?: string;
  deathday?: string;
  placeOfBirth?: string;
  profilePhoto?: string;
  knownFor?: string;
  credits: Meta[];
  /**
   * TMDB's popularity per credit, keyed by `Meta.id`.
   *
   * Alongside the credits rather than on them: `Meta` is the shape every poster
   * card in the app renders, and it has no business carrying one provider's
   * sort key. Keeping it here also leaves `personSections` a pure function of
   * this object, which is what makes the grouping testable at all.
   */
  popularity: Record<string, number>;
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

/**
 * Whether to read this person's crew credits rather than their cast credits.
 *
 * A director opened from a title's crew wants the films they directed, not the
 * three they had a cameo in. TMDB says which they are known for, and the caller
 * can override when it knows better — the Director card on a details page knows
 * it is a director even when TMDB has them filed under Acting.
 */
export function prefersCrew(knownForDepartment?: string, role?: string): boolean {
  const named = role?.trim().toLowerCase();
  if (named === "creator" || named === "director" || named === "writer") return true;
  const department = knownForDepartment?.trim().toLowerCase();
  if (!department) return false;
  return department !== "acting" && department !== "actors";
}

/** One TMDB credit, as a Meta the ordinary poster cards can render. */
function creditToMeta(credit: Json, type: "movie" | "tv"): Meta | null {
  const id = number(credit.id);
  // `title` for a film, `name` for a show — TMDB does not use one field for
  // both, and a credit with neither is not something we can open.
  const name = text(credit.title) ?? text(credit.name);
  if (!id || !name) return null;
  const released = text(credit.release_date) ?? text(credit.first_air_date);
  return {
    // The id a Stremio addon would use, so opening one of these goes through
    // exactly the same path as opening it from a catalog row.
    id: `tmdb:${id}`,
    type: type === "tv" ? "series" : "movie",
    name,
    poster: tmdbImage(credit.poster_path, "w342"),
    background: tmdbImage(credit.backdrop_path, "w780"),
    description: text(credit.overview),
    releaseInfo: released?.slice(0, 4),
    released,
    genres: [],
    cast: [],
    director: [],
    writer: [],
    trailers: [],
    externalRatings: [],
    videos: [],
    manifestUrl: "",
    addonName: "TMDB",
  };
}

function mapCredits(
  entries: Json[],
  type: "movie" | "tv",
  popularity: Record<string, number>,
): Meta[] {
  const mapped: Meta[] = [];
  for (const entry of entries) {
    if (entry.media_type && entry.media_type !== type) continue;
    const meta = creditToMeta(entry, type);
    if (!meta) continue;
    // The highest wins where a person is credited twice on one title: the two
    // rows carry the same title's popularity anyway, and taking the larger
    // means a missing value on one of them cannot demote it.
    popularity[meta.id] = Math.max(
      popularity[meta.id] ?? 0,
      number(entry.popularity) ?? 0,
    );
    mapped.push(meta);
  }
  return mapped;
}

/**
 * The preferred bucket, falling back to the other when TMDB has nothing in it.
 *
 * A writer with no crew credits filed under this department would otherwise get
 * an empty page, which reads as the lookup having failed.
 */
const select = (preferCrew: boolean, cast: Meta[], crew: Meta[]) => {
  const preferred = preferCrew ? crew : cast;
  return preferred.length ? preferred : preferCrew ? cast : crew;
};

/**
 * Everything TMDB knows about a person.
 *
 * Two requests, issued together: the person, and their combined credits. Both
 * go through the shared cache, so returning to someone you just looked at costs
 * nothing.
 */
export async function loadPersonDetail(
  tmdbId: number,
  config: MetadataEnrichmentConfig["tmdb"],
  role?: string,
): Promise<PersonDetail> {
  if (!config.enabled || !config.apiKey.trim())
    throw new Error("TMDB metadata must be enabled to browse a person.");

  const [personResult, creditsResult] = await Promise.allSettled([
    tmdbJson(tmdbUrl(`person/${tmdbId}`, config.apiKey, config.language)),
    tmdbJson(
      tmdbUrl(`person/${tmdbId}/combined_credits`, config.apiKey, config.language),
    ),
  ]);
  if (personResult.status === "rejected")
    throw personResult.reason instanceof Error
      ? personResult.reason
      : new Error("Could not load this person.");
  const person = json(personResult.value) ?? {};
  // Credits are allowed to fail on their own. The identity and biography are
  // still worth showing, and an empty filmography says so plainly.
  const credits =
    creditsResult.status === "fulfilled" ? (json(creditsResult.value) ?? {}) : {};

  let biography = text(person.biography);
  // TMDB returns an empty biography rather than falling back, so a non-English
  // language setting silently costs you the whole biography. Ask again in
  // English rather than showing nothing.
  if (!biography && !/^en\b/i.test(config.language.trim() || "en")) {
    biography = await tmdbJson(tmdbUrl(`person/${tmdbId}`, config.apiKey, "en"))
      .then((value) => text(json(value)?.biography))
      .catch(() => undefined);
  }

  const knownFor = text(person.known_for_department);
  const preferCrew = prefersCrew(knownFor, role);
  const cast = list(credits.cast);
  const crew = list(credits.crew);
  const popularity: Record<string, number> = {};
  const merged = [
    ...select(
      preferCrew,
      mapCredits(cast, "movie", popularity),
      mapCredits(crew, "movie", popularity),
    ),
    ...select(
      preferCrew,
      mapCredits(cast, "tv", popularity),
      mapCredits(crew, "tv", popularity),
    ),
  ];
  // A person credited twice on one title — writer and director, say — appears
  // once.
  const seen = new Set<string>();
  const unique = merged.filter((meta) => {
    if (seen.has(meta.id)) return false;
    seen.add(meta.id);
    return true;
  });

  return {
    tmdbId: number(person.id) ?? tmdbId,
    name: text(person.name) ?? "Unknown",
    biography,
    birthday: text(person.birthday),
    deathday: text(person.deathday),
    placeOfBirth: text(person.place_of_birth),
    profilePhoto: tmdbImage(person.profile_path, "w500"),
    knownFor,
    credits: unique,
    popularity,
  };
}

/**
 * The filmography as rows, ordered the way both other clients order it.
 *
 * Popular first because it is what identifies someone; then what they have most
 * recently been in; then what is still to come. An empty group is dropped
 * rather than shown empty.
 */
export function personSections(person: PersonDetail): CatalogSection[] {
  const today = new Date().toISOString().slice(0, 10);
  const dated = (meta: Meta) => meta.released ?? "";
  const groups = [
    {
      key: "popular",
      name: "Popular",
      items: [...person.credits].sort(
        (left, right) =>
          (person.popularity[right.id] ?? 0) - (person.popularity[left.id] ?? 0),
      ),
    },
    {
      key: "latest",
      name: "Latest",
      items: person.credits
        .filter((meta) => dated(meta) && dated(meta) <= today)
        .sort((left, right) => dated(right).localeCompare(dated(left))),
    },
    {
      key: "upcoming",
      name: "Upcoming",
      items: person.credits
        .filter((meta) => dated(meta) > today)
        .sort((left, right) => dated(left).localeCompare(dated(right))),
    },
  ];
  return groups
    .filter((group) => group.items.length > 0)
    .map((group) => ({
      key: `person:${person.tmdbId}:${group.key}`,
      name: group.name,
      type: "mixed",
      manifestUrl: "",
      addonName: "TMDB",
      catalogId: group.key,
      items: group.items,
    }));
}

/** "1962 – 2024", or just the birth year, or nothing. */
export function lifespan(person: PersonDetail): string {
  const format = (value?: string) => {
    if (!value) return "";
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
  };
  return [format(person.birthday), format(person.deathday)]
    .filter(Boolean)
    .join(" – ");
}
