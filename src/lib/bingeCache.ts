/**
 * The source a series was last watched from.
 *
 * A binge group names a release able to serve a whole run, so once one episode
 * has been played there is rarely a decision left to make for the next: the
 * same group means the same quality, the same audio and the same host. Nuvio
 * keeps this per series in `BingeGroupCacheRepository` for the same reason —
 * so continuing does not put a list of sources in front of you first.
 *
 * Kept on the device rather than synced. It describes what this browser can
 * reach and what it chose, which is not necessarily true of another.
 */

const KEY = "nuvio-web-binge-groups";
/** Enough for any plausible number of series on the go, and bounded. */
const LIMIT = 60;

/**
 * `seq` orders these, not `at`.
 *
 * Several series can be written within one millisecond, which leaves their
 * timestamps equal and the order down to whatever the object happens to
 * iterate in — and that flips once the list has been pruned and rewritten. A
 * counter that only ever climbs says which is newer without needing a clock
 * fine enough or an iteration order that holds still.
 */
type Entry = { group: string; at: number; seq?: number };

function read(): Record<string, Entry> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, Entry>)
      : {};
  } catch {
    return {};
  }
}

export function rememberBingeGroup(metaId: string, group?: string) {
  if (!metaId || !group) return;
  try {
    const all = read();
    const next =
      Math.max(0, ...Object.values(all).map((entry) => entry?.seq ?? 0)) + 1;
    all[metaId] = { group, at: Date.now(), seq: next };
    // Oldest out first, so a long history cannot grow without bound.
    const entries = Object.entries(all).sort(
      (left, right) => (right[1]?.seq ?? 0) - (left[1]?.seq ?? 0),
    );
    localStorage.setItem(
      KEY,
      JSON.stringify(Object.fromEntries(entries.slice(0, LIMIT))),
    );
  } catch {
    // Without it, continuing asks which source to use, as it did before.
  }
}

export function bingeGroupFor(metaId: string): string | undefined {
  return read()[metaId]?.group;
}
