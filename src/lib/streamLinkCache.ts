import type { Stream } from "../types";

/**
 * "Reuse last stream" — a device-local record of the last link played for a
 * given episode, mirroring Nuvio's `StreamLinkCacheRepository`.
 *
 * What it saves is a round trip through the addon and, for a debrid source, a
 * resolution against Torbox or its equivalent. Pressing play on the next
 * episode of something you are working through should not have to ask the
 * internet what it already knew a minute ago.
 *
 * Deliberately not synced, and deliberately not in `platform.storage`: a
 * resolved playback URL is usually tied to the device or session that asked for
 * it, so handing it to another client is useless at best. `localStorage` rather
 * than IndexedDB because every reader here is on the path to starting playback
 * and wants an answer now, not a promise — the same reasoning as `bingeCache`.
 */
export type CachedStreamLink = {
  url: string;
  streamName: string;
  addonName: string;
  cachedAtMs: number;
  requestHeaders?: Record<string, string>;
  filename?: string;
  videoSize?: number;
  infoHash?: string;
  fileIdx?: number;
  bingeGroup?: string;
};

export const DEFAULT_REUSE_CACHE_HOURS = 24;
const STORAGE_PREFIX = "nuvio.streamLink.";

/**
 * Query keys that mark a URL as carrying short-lived playback credentials,
 * copied from Nuvio's `PlaybackUrlCredentials`.
 *
 * Caching a signed debrid link only to have it 403 on the next play is worse
 * than never having cached it: the failure arrives after the user has committed
 * to watching, and looks like the source being dead rather than the link having
 * aged out. A URL that carries one of these is not stored at all.
 */
const CREDENTIAL_KEYS = new Set([
  "accesskey", "accesssignature", "accesssig", "access_token", "accesstoken",
  "auth", "authkey", "authsig", "authsignature", "auth_token", "authtoken",
  "e", "exp", "expiration", "expire", "expires", "expiresat", "expiresin",
  "expires_in", "expiry", "hmac", "jwt", "keypairid", "policy", "sig",
  "signature", "signed", "st", "t", "token",
]);
const CREDENTIAL_FRAGMENTS = ["token", "signature", "expires", "expiry"];

export function hasExpiringCredentials(url: string): boolean {
  const query = url.split("?").slice(1).join("?").split("#")[0];
  if (!query.trim()) return false;
  return query.split(/[&;]/).some((parameter) => {
    const rawKey = parameter.split("=")[0].trim().toLowerCase();
    if (!rawKey) return false;
    const compact = rawKey.replace(/[-_.]/g, "");
    return (
      CREDENTIAL_KEYS.has(rawKey) ||
      CREDENTIAL_KEYS.has(compact) ||
      CREDENTIAL_FRAGMENTS.some(
        (fragment) => rawKey.includes(fragment) || compact.includes(fragment),
      )
    );
  });
}

/**
 * The cache key for one playable thing.
 *
 * An episode is keyed by its series, season and number as well as its own id,
 * because the same video id can appear under more than one addon's numbering.
 * Mirrors `StreamLinkCacheRepository.contentKey` so the two clients agree.
 */
export function contentKey(
  type: string,
  videoId: string,
  parentMetaId?: string,
  season?: number,
  episode?: number,
): string {
  const normalized = type.toLowerCase();
  return parentMetaId?.trim() && season != null && episode != null
    ? `${normalized}|${parentMetaId.trim()}|s${season}|e${episode}|${videoId}`
    : `${normalized}|${videoId}`;
}

const storageKey = (key: string) => STORAGE_PREFIX + key;

export function saveStreamLink(key: string, stream: Stream) {
  const url = stream.url ?? "";
  // Dropped rather than stored, and any previous entry cleared with it, so an
  // older link cannot be served in place of the one just refused.
  if (url && hasExpiringCredentials(url)) {
    removeStreamLink(key);
    return;
  }
  // An entry with neither a URL nor an infoHash cannot be played back from.
  if (!url && !stream.infoHash) return;

  const entry: CachedStreamLink = {
    url,
    streamName: stream.name || stream.title || "Last used source",
    addonName: stream.addonName,
    cachedAtMs: Date.now(),
    requestHeaders: stream.behaviorHints?.proxyHeaders?.request,
    filename: stream.behaviorHints?.filename,
    videoSize: stream.behaviorHints?.videoSize,
    infoHash: stream.infoHash,
    fileIdx: stream.fileIdx,
    bingeGroup: stream.behaviorHints?.bingeGroup,
  };
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // A full store must not break playback.
  }
}

export function removeStreamLink(key: string) {
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    // ignored — see saveStreamLink
  }
}

/**
 * The entry for `key`, if it is still worth using.
 *
 * Everything that disqualifies an entry also evicts it, so a cache that has
 * gone stale empties itself rather than being re-read and re-rejected on every
 * play.
 */
export function getValidStreamLink(
  key: string,
  maxAgeMs: number,
): CachedStreamLink | null {
  if (maxAgeMs <= 0) return null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey(key));
  } catch {
    return null;
  }
  if (!raw) return null;

  let entry: CachedStreamLink;
  try {
    entry = JSON.parse(raw) as CachedStreamLink;
  } catch {
    removeStreamLink(key);
    return null;
  }

  const age = Date.now() - entry.cachedAtMs;
  if (!entry.cachedAtMs || age > maxAgeMs) {
    removeStreamLink(key);
    return null;
  }
  // Re-checked on the way out as well as on the way in: the rules for what
  // counts as credentialed can change under an entry that is already stored.
  if (entry.url && hasExpiringCredentials(entry.url)) {
    removeStreamLink(key);
    return null;
  }
  if (!entry.url && !entry.infoHash) {
    removeStreamLink(key);
    return null;
  }
  return entry;
}

/** Rebuilds a playable stream from a cache entry. */
export function cachedStreamToSource(entry: CachedStreamLink): Stream {
  return {
    name: entry.streamName,
    title: entry.streamName,
    description: "",
    url: entry.url || undefined,
    infoHash: entry.infoHash,
    fileIdx: entry.fileIdx,
    addonName: entry.addonName,
    behaviorHints: {
      filename: entry.filename,
      videoSize: entry.videoSize,
      bingeGroup: entry.bingeGroup,
      notWebReady: false,
      proxyHeaders: { request: entry.requestHeaders },
    },
  };
}
