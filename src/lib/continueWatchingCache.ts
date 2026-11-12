import type { Meta } from "../types";
import { getValue, setValue } from "./idb.ts";

/**
 * The titles Continue Watching was last built from, kept between launches.
 *
 * The row used to be rebuilt from nothing on every open: one metadata request
 * per title, up to eighty of them, after every home catalog had loaded. On an
 * addon like AIOMetadata that was several seconds of an empty row, and the
 * burst it took is what its rate limiter answers. Nuvio keeps the enriched
 * row on the device and shows it straight away (ContinueWatchingEnrichment-
 * Cache); this does the same, then refreshes behind it — and only the titles
 * old enough to have changed.
 */
export type CachedTitle = { meta: Meta; at: number };

const KEY = (profileIndex: number) => `nuvio-cw-titles:${profileIndex}`;
const LIMIT = 100;

/** A film's details do not change; a series gains episodes. */
export function isFresh(entry: CachedTitle, now = Date.now()): boolean {
  const age = now - entry.at;
  return entry.meta.type === "movie" ? age < 7 * 86_400_000 : age < 6 * 3_600_000;
}

export async function loadCachedTitles(profileIndex: number): Promise<Map<string, CachedTitle>> {
  try {
    const stored = await getValue<CachedTitle[]>(KEY(profileIndex));
    return new Map((stored ?? []).filter((entry) => entry?.meta?.id).map((entry) => [entry.meta.id, entry]));
  } catch {
    return new Map();
  }
}

/** Saves what the row was built from, newest first, dropping what it no longer shows. */
export async function saveCachedTitles(
  profileIndex: number,
  entries: CachedTitle[],
): Promise<void> {
  try {
    await setValue(
      KEY(profileIndex),
      entries.slice(0, LIMIT).map(({ meta, at }) => ({
        // Cast and trailers are for the details page, which fetches its own.
        meta: { ...meta, cast: [], trailers: [] },
        at,
      })),
    );
  } catch {
    // Storage refused (private mode, quota): the row still loads, just slower.
  }
}
