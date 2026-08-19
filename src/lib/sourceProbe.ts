/**
 * Asks the server one small question before the player commits to the file.
 *
 * The decoding player reads the container over range requests, and when that
 * cannot happen it does not fail — it stalls, because there is nothing to
 * decode and no error to raise. Every reason it stalls is a plain HTTP one:
 * the link expired, the host refuses cross-origin reads, the page is https and
 * the source is not. All of them are visible in a single one-byte request, and
 * all of them are worth saying precisely rather than blaming the file.
 */

export type SourceProbe = { ok: true; ranges: boolean } | { ok: false; reason: string };

/**
 * A page on https may not fetch http, and the browser blocks it before the
 * request is made — silently, from the page's point of view.
 */
export function mixedContentProblem(
  pageProtocol: string,
  url: string,
): string | null {
  if (pageProtocol !== "https:") return null;
  if (!/^http:\/\//i.test(url)) return null;
  return "This source is served over plain http:// while Nuvio is on https://, so the browser refuses to load it. Pick another source, or open it in an external player.";
}

/** What an HTTP status means for a stream, in the terms that matter here. */
export function statusReason(status: number): string {
  if (status === 401 || status === 403)
    return `The host refused this link (${status}). Debrid links expire, so re-fetching the sources usually fixes it.`;
  if (status === 404 || status === 410)
    return `This link is no longer there (${status}). Fetch the sources again and pick a fresh one.`;
  if (status === 429)
    return "The host is rate-limiting this device (429). Wait a moment and try again.";
  if (status >= 500)
    return `The host had an error serving this link (${status}). Try another source.`;
  return `The host answered ${status}, which this player cannot read. Try another source.`;
}

/**
 * One byte, so the answer costs nothing and arrives quickly.
 *
 * A 206 also confirms range requests work, which the reader depends on: a host
 * that ignores Range hands back the whole file for every seek.
 */
export async function probeSource(
  url: string,
  headers?: Record<string, string>,
  timeoutMs = 15_000,
  fetchImpl: typeof fetch = fetch,
): Promise<SourceProbe> {
  const mixed = mixedContentProblem(
    typeof location === "undefined" ? "https:" : location.protocol,
    url,
  );
  if (mixed) return { ok: false, reason: mixed };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { ...(headers ?? {}), Range: "bytes=0-0" },
      signal: controller.signal,
    });
    // Nothing here reads the body; letting it stream would download the file.
    void response.body?.cancel().catch(() => undefined);
    if (response.status === 206) return { ok: true, ranges: true };
    if (response.ok) return { ok: true, ranges: false };
    return { ok: false, reason: statusReason(response.status) };
  } catch {
    if (controller.signal.aborted)
      return {
        ok: false,
        reason:
          "The host did not answer in time. It may be slow, or the link may have expired — fetch the sources again, or try an external player.",
      };
    // fetch rejects with an opaque TypeError for every network-level refusal,
    // and cross-origin policy is far and away the usual one.
    return {
      ok: false,
      reason:
        "The browser could not reach this source. The host most likely does not allow other sites to read it (CORS), which no in-browser player can work around — use an external player, or pick another source.",
    };
  } finally {
    clearTimeout(timer);
  }
}
