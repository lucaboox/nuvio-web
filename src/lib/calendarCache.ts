import { platform } from "../platform";
import type { Meta, Video } from "../types";

/**
 * Persists the library metadata the release calendar is built from.
 *
 * This is what makes Stremio's calendar feel instant and ours not: theirs is
 * computed from metadata the client already holds, so no request stands
 * between opening the page and seeing it. Ours resolved every title over the
 * network on every visit, and no amount of scheduling makes that immediate.
 *
 * So the resolved set is kept, redisplayed straight away on the next visit,
 * and refreshed behind what is already on screen. Episode lists do change —
 * that is the whole point of a calendar — so a stored set is trusted only for
 * a few hours before it is rebuilt in the background.
 */

const KEY = "nuvio.calendar.metas";
/** Bumped when the stored shape changes, so old records are ignored. */
const VERSION = 2;
/** How long a stored set is used without rebuilding it behind the page. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Only what the grid draws, plus enough for the details view to reopen the
 * title. Everything else — cast, description, trailers, ratings — is re-fetched
 * by that view anyway, and storing it would multiply the record for nothing.
 */
type StoredVideo = Pick<
  Video,
  "id" | "title" | "season" | "episode" | "released" | "thumbnail"
>;

type StoredMeta = Pick<
  Meta,
  | "id"
  | "type"
  | "name"
  | "poster"
  | "posterShape"
  | "background"
  | "logo"
  | "released"
  | "releaseInfo"
  | "manifestUrl"
  | "addonName"
> & { videos: StoredVideo[] };

type StoredCalendar = {
  version: number;
  savedAt: number;
  scope: string;
  metas: StoredMeta[];
};

function trim(meta: Meta): StoredMeta {
  return {
    id: meta.id,
    type: meta.type,
    name: meta.name,
    poster: meta.poster,
    posterShape: meta.posterShape,
    background: meta.background,
    logo: meta.logo,
    released: meta.released,
    releaseInfo: meta.releaseInfo,
    manifestUrl: meta.manifestUrl,
    addonName: meta.addonName,
    videos: meta.videos.map((video) => ({
      id: video.id,
      title: video.title,
      season: video.season,
      episode: video.episode,
      released: video.released,
      thumbnail: video.thumbnail,
    })),
  };
}

/** Restores the fields `Meta` requires, which the stored form leaves out. */
function restore(stored: StoredMeta): Meta {
  return {
    ...stored,
    genres: [],
    cast: [],
    director: [],
    writer: [],
    trailers: [],
    externalRatings: [],
    videos: stored.videos.map((video) => ({ ...video })),
  };
}

export type CachedCalendar = {
  metas: Meta[];
  /** True when the set should be rebuilt behind whatever it renders. */
  stale: boolean;
};

/**
 * Reads the stored set for this profile and addon selection.
 *
 * A record saved under a different scope is ignored rather than shown: it
 * belongs to another profile or another set of addons, and showing one
 * profile's library to another is worse than a slow calendar.
 */
export async function readCalendarMetas(
  scope: string,
): Promise<CachedCalendar | null> {
  try {
    const stored = await platform.storage.get<StoredCalendar>(KEY);
    if (!stored || stored.version !== VERSION || stored.scope !== scope)
      return null;
    if (!Array.isArray(stored.metas) || !stored.metas.length) return null;
    return {
      metas: stored.metas.map(restore),
      stale: Date.now() - stored.savedAt > MAX_AGE_MS,
    };
  } catch {
    // Storage being unavailable costs a slow calendar, not a broken one.
    return null;
  }
}

export async function writeCalendarMetas(
  scope: string,
  metas: Meta[],
): Promise<void> {
  try {
    await platform.storage.set<StoredCalendar>(KEY, {
      version: VERSION,
      savedAt: Date.now(),
      scope,
      metas: metas.map(trim),
    });
  } catch {
    // Same: the calendar still works, it just will not be instant next time.
  }
}
