/**
 * How hard the app is allowed to lean on one addon host.
 *
 * A home screen is many catalogs, and one addon commonly supplies most of
 * them. Nothing held those requests back, so opening the app fired all of them
 * at one host in the same instant and a rate limiter answered 429 to whichever
 * lost — which reads as "that addon is broken" rather than "we asked too fast".
 *
 * Two rules, both per host so a slow addon cannot hold up the others: a cap on
 * requests in flight, and a wait when the host says to wait.
 */

/** Requests allowed in flight per host at once. */
export const MAX_IN_FLIGHT_PER_HOST = 4;
/** How many times a request is retried after the host asks us to back off. */
export const MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 30_000;

/** The bucket a URL is limited in. Falls back to the whole URL if unparseable. */
export function hostKey(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** Statuses worth trying again — the host is asking for later, not refusing. */
export function isRetryable(status: number): boolean {
  return status === 429 || status === 503;
}

/**
 * How long to wait before trying again.
 *
 * `Retry-After` is authoritative when the host sends one, in either of the two
 * forms it is allowed to take. Without it the wait doubles per attempt, so a
 * host that says nothing is not hammered at a fixed rate.
 */
export function retryAfterMs(
  header: string | null | undefined,
  attempt: number,
  now = Date.now(),
): number {
  const seconds = Number(header);
  if (header && Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  if (header) {
    const at = Date.parse(header);
    if (Number.isFinite(at))
      return Math.min(Math.max(0, at - now), MAX_BACKOFF_MS);
  }
  return Math.min(500 * 2 ** attempt, 8_000);
}

export type HostLimiter = <T>(url: string, work: () => Promise<T>) => Promise<T>;

/**
 * Runs at most `maxConcurrent` per host, queueing the rest in order.
 *
 * A finishing request hands its slot straight to whoever is waiting rather
 * than releasing and re-taking it, so the count cannot drift under contention.
 */
export function createHostLimiter(
  maxConcurrent = MAX_IN_FLIGHT_PER_HOST,
): HostLimiter {
  const active = new Map<string, number>();
  const waiting = new Map<string, Array<() => void>>();

  const release = (key: string) => {
    const queue = waiting.get(key);
    const next = queue?.shift();
    if (queue && !queue.length) waiting.delete(key);
    if (next) {
      next();
      return;
    }
    const count = (active.get(key) ?? 1) - 1;
    if (count > 0) active.set(key, count);
    else active.delete(key);
  };

  return async function run<T>(url: string, work: () => Promise<T>): Promise<T> {
    const key = hostKey(url);
    const count = active.get(key) ?? 0;
    if (count >= maxConcurrent) {
      await new Promise<void>((resolve) => {
        const queue = waiting.get(key) ?? [];
        queue.push(resolve);
        waiting.set(key, queue);
      });
    } else {
      active.set(key, count + 1);
    }
    try {
      return await work();
    } finally {
      release(key);
    }
  };
}
