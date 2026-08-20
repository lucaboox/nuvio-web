import type { RequestOptions, RequestResponse } from "../platform/types.ts";

/**
 * The browser's answer to `platform.request`.
 *
 * Everything here is a browser fact rather than a rule of the contract: that a
 * blocked request arrives as a `TypeError` with nothing in it, that credentials
 * have to be refused explicitly or they ride along, that `fetch` has no timeout
 * of its own. A shell doing its HTTP in Rust meets none of these and should not
 * inherit the handling for them.
 */
export async function webRequest(
  url: string,
  options: RequestOptions = {},
): Promise<RequestResponse> {
  const controller = new AbortController();
  const upstream = options.signal;
  const abort = () => controller.abort();
  if (upstream?.aborted) controller.abort();
  else upstream?.addEventListener("abort", abort, { once: true });
  const timer =
    options.timeoutMs == null
      ? undefined
      : setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      // Both are off by default in a browser and must not be on here: these
      // addresses come from installed addons, and neither a session cookie nor
      // the page we were on is theirs to receive.
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });

    // Checked before reading and again after: a host may declare nothing, or
    // declare a small body and send a large one.
    const declared = Number(headers["content-length"] ?? 0);
    if (options.maxBytes && declared > options.maxBytes)
      throw new Error("Response is too large.");
    const body = await response.text();
    if (options.maxBytes && body.length > options.maxBytes)
      throw new Error("Response is too large.");

    return { ok: response.ok, status: response.status, headers, body };
  } catch (error) {
    // A cross-origin refusal and a dead network are the same opaque TypeError,
    // by design — the browser will not say which. Naming both beats reporting
    // "Failed to fetch" to someone who has just installed an addon.
    if (error instanceof TypeError)
      throw new Error(
        "Browser blocked this request (usually CORS or network failure).",
      );
    throw error;
  } finally {
    if (timer != null) clearTimeout(timer);
    upstream?.removeEventListener("abort", abort);
  }
}
