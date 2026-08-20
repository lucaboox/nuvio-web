import {
  loadProgress,
  loadWatchedItems,
  progressDeltaCursor,
  pullProgressDelta,
  pullWatchedDelta,
  watchedDeltaCursor,
} from "./account";
import { platform } from "../platform/index.ts";
import type { ProgressRow, WatchedItem } from "../types";

/**
 * Snapshot-once, then deltas.
 *
 * The first load for a profile takes a full pull and records the log cursor;
 * every load after that asks only for events since that cursor. The cached
 * rows live in IndexedDB, so a returning session starts from disk and reaches
 * the network only for what changed.
 *
 * Anything unexpected falls back to a full snapshot. Correct-but-slow beats a
 * cache that has quietly drifted from the server.
 */
type Cached<T> = { cursor: number; rows: T[]; profileIndex: number };

const key = (name: string, profileIndex: number) =>
  `watch-sync:${name}:${profileIndex}`;

async function sync<T>(
  name: string,
  profileIndex: number,
  snapshot: () => Promise<T[]>,
  cursorOf: (profileIndex: number) => Promise<number | null>,
  drain: (
    profileIndex: number,
    since: number,
    rows: T[],
  ) => Promise<{ cursor: number; rows: T[] }>,
): Promise<T[]> {
  const storeKey = key(name, profileIndex);
  const cached = await platform.storage
    .get<Cached<T>>(storeKey)
    .catch(() => null);

  if (cached && cached.profileIndex === profileIndex) {
    try {
      const next = await drain(profileIndex, cached.cursor, cached.rows);
      await platform.storage
        .set(storeKey, { ...next, profileIndex })
        .catch(() => undefined);
      return next.rows;
    } catch {
      // Fall through to a snapshot rather than serving a stale cache.
    }
  }

  // Cursor first: a write landing during the snapshot is then replayed as a
  // delta instead of falling into the gap between the two calls.
  const cursor = await cursorOf(profileIndex).catch(() => null);
  const rows = await snapshot();
  if (cursor != null)
    await platform.storage
      .set(storeKey, { cursor, rows, profileIndex })
      .catch(() => undefined);
  return rows;
}

export const syncProgress = (profileIndex: number): Promise<ProgressRow[]> =>
  sync(
    "progress",
    profileIndex,
    () => loadProgress(profileIndex),
    progressDeltaCursor,
    async (profile, since, rows) => {
      const result = await pullProgressDelta(profile, since, rows);
      return { cursor: result.cursor, rows: result.rows };
    },
  );

export const syncWatched = (profileIndex: number): Promise<WatchedItem[]> =>
  sync(
    "watched",
    profileIndex,
    () => loadWatchedItems(profileIndex),
    watchedDeltaCursor,
    async (profile, since, rows) => {
      const result = await pullWatchedDelta(profile, since, rows);
      return { cursor: result.cursor, rows: result.items };
    },
  );

/** Drops the caches, forcing a fresh snapshot. Used on sign-out. */
export async function clearWatchSyncCache(profileIndex: number) {
  await Promise.all(
    ["progress", "watched"].map((name) =>
      platform.storage.set(key(name, profileIndex), null).catch(() => undefined),
    ),
  );
}
