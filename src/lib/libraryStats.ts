import type { Meta } from "../types";

export type WatchedTally = { watched: number; total: number };

/** How much of the library has been watched, overall and per type. */
export type LibraryTally = {
  all: WatchedTally;
  movie: WatchedTally;
  series: WatchedTally;
};

/**
 * Counts the library's watched titles, by the same rule the posters use for
 * their watched badge: a title-level mark (`watchKey(id)`, which for a whole
 * title is the id itself). A series counts once the show is marked watched,
 * not when some of its episodes are, so the numbers and the badges agree.
 */
export function tallyWatched(
  items: Pick<Meta, "id" | "type">[],
  watched: ReadonlySet<string>,
): LibraryTally {
  const tally: LibraryTally = {
    all: { watched: 0, total: 0 },
    movie: { watched: 0, total: 0 },
    series: { watched: 0, total: 0 },
  };
  for (const item of items) {
    const seen = watched.has(item.id);
    const buckets = [tally.all];
    if (item.type === "movie") buckets.push(tally.movie);
    else if (item.type === "series") buckets.push(tally.series);
    for (const bucket of buckets) {
      bucket.total += 1;
      if (seen) bucket.watched += 1;
    }
  }
  return tally;
}
