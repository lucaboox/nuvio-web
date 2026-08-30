import type { Stream } from "../types";

/**
 * The Debrid rule surface Nuvio syncs, as this client needs it.
 *
 * Read from the account's settings blob under `debrid_settings`, so the rules
 * set on the Android or TV client are the rules applied here.
 */
export type DebridRules = {
  debridEnabled: boolean;
  debridPreferredResolverProviderId: string;
  debridStreamMaxResults: number;
  debridStreamSortMode: "DEFAULT" | "QUALITY_DESC" | "SIZE_DESC" | "SIZE_ASC";
  debridStreamMinimumQuality: "ANY" | "P720" | "P1080" | "P2160";
  debridStreamDolbyVisionFilter: "ANY" | "EXCLUDE" | "ONLY";
  debridStreamHdrFilter: "ANY" | "EXCLUDE" | "ONLY";
  debridStreamCodecFilter: "ANY" | "H264" | "HEVC" | "AV1";
};

/**
 * Applies the same legacy Debrid rule surface synced by official Nuvio, but
 * only to addon `clientResolve` Debrid entries. Ordinary Stremio HTTP sources
 * retain their addon order and are never filtered by these controls.
 */
export function applyDebridStreamSettings(
  streams: Stream[],
  settings?: DebridRules | null,
): Stream[] {
  if (!settings) return streams;
  const indexed = streams
    .map((stream, index) => ({ stream, index }))
    .filter(({ stream }) => isDebridResolveStream(stream));
  if (indexed.length === 0) return streams;

  if (!settings.debridEnabled) {
    return streams.filter((stream) => !isDebridResolveStream(stream));
  }

  const preferred = normalizeProvider(settings.debridPreferredResolverProviderId);
  let selected = indexed
    .map(({ stream }) => stream)
    .filter((stream) => isCachedDebridCandidate(stream))
    .filter((stream) => !preferred || normalizeProvider(stream.clientResolve?.service) === preferred)
    .filter((stream) => passesDebridFilters(stream, settings));

  selected = sortDebridStreams(selected, settings.debridStreamSortMode);
  const limit = Math.max(0, Math.min(100, Math.trunc(settings.debridStreamMaxResults || 0)));
  if (limit > 0) selected = selected.slice(0, limit);

  // Preserve the position of the first Debrid result relative to normal addon
  // groups while replacing the Debrid subset with its filtered/sorted form.
  const first = indexed[0].index;
  const ordinary = streams.filter((stream) => !isDebridResolveStream(stream));
  const insertion = streams.slice(0, first).filter((stream) => !isDebridResolveStream(stream)).length;
  ordinary.splice(insertion, 0, ...selected);
  return ordinary;
}

export function isDebridResolveStream(stream: Stream): boolean {
  return stream.clientResolve?.type?.trim().toLowerCase() === "debrid";
}

function isCachedDebridCandidate(stream: Stream): boolean {
  return isDebridResolveStream(stream) && stream.clientResolve?.isCached === true;
}

function passesDebridFilters(stream: Stream, settings: DebridRules): boolean {
  const resolution = streamResolution(stream);
  const minimum = {
    ANY: 0,
    P720: 720,
    P1080: 1080,
    P2160: 2160,
  }[settings.debridStreamMinimumQuality] ?? 0;
  if (minimum > 0 && resolution < minimum) return false;

  const tags = parsedHdr(stream);
  const hasDolbyVision = tags.some((tag) => /^(?:dv|dv_only|hdr_dv|dolby\s*vision)$/i.test(tag));
  const hasHdr = tags.some((tag) => /^(?:hdr|hdr10|hdr10_plus|hdr10\+|hlg|hdr_only|hdr_dv)$/i.test(tag));
  if (!passesFeatureFilter(hasDolbyVision, settings.debridStreamDolbyVisionFilter)) return false;
  if (!passesFeatureFilter(hasHdr, settings.debridStreamHdrFilter)) return false;

  const wantedCodec = settings.debridStreamCodecFilter;
  if (wantedCodec !== "ANY" && streamCodec(stream) !== wantedCodec) return false;
  return true;
}

function passesFeatureFilter(present: boolean, mode: "ANY" | "EXCLUDE" | "ONLY"): boolean {
  if (mode === "ONLY") return present;
  if (mode === "EXCLUDE") return !present;
  return true;
}

function sortDebridStreams(
  streams: Stream[],
  mode: DebridRules["debridStreamSortMode"],
): Stream[] {
  if (mode === "DEFAULT") return streams;
  return streams
    .map((stream, index) => ({ stream, index }))
    .sort((left, right) => {
      let compared = 0;
      if (mode === "QUALITY_DESC") {
        compared = streamResolution(right.stream) - streamResolution(left.stream);
        if (!compared) compared = qualityRank(right.stream) - qualityRank(left.stream);
        if (!compared) compared = streamSize(right.stream) - streamSize(left.stream);
      } else {
        compared = streamSize(left.stream) - streamSize(right.stream);
        if (mode === "SIZE_DESC") compared *= -1;
      }
      return compared || left.index - right.index;
    })
    .map(({ stream }) => stream);
}

function normalizeProvider(provider?: string): string {
  return String(provider ?? "").trim().toLowerCase().replace(/^debrid:/, "");
}

function streamText(stream: Stream): string {
  const raw = stream.clientResolve?.stream?.raw;
  return [
    stream.name,
    stream.title,
    stream.description,
    stream.behaviorHints?.filename,
    stream.clientResolve?.filename,
    stream.clientResolve?.torrentName,
    raw?.filename,
    raw?.torrentName,
    raw?.parsed?.raw_title,
    raw?.parsed?.parsed_title,
  ]
    .filter(Boolean)
    .join(" ");
}

function streamResolution(stream: Stream): number {
  const raw = stream.clientResolve?.stream?.raw?.parsed?.resolution ?? streamText(stream);
  const match = String(raw).match(/\b(2160|1440|1080|720|576|480|360)p?\b/i);
  if (match) return Number(match[1]);
  return /\b4k\b/i.test(String(raw)) ? 2160 : 0;
}

function streamSize(stream: Stream): number {
  const raw = stream.clientResolve?.stream?.raw;
  return raw?.size ?? raw?.folderSize ?? stream.behaviorHints?.videoSize ?? 0;
}

function parsedHdr(stream: Stream): string[] {
  const parsed = stream.clientResolve?.stream?.raw?.parsed?.hdr;
  if (parsed?.length) return parsed;
  const text = streamText(stream);
  return [
    /\b(?:dolby[ ._-]?vision|dovi|dv)\b/i.test(text) ? "DV" : "",
    /\b(?:hdr10\+?|hdr|hlg)\b/i.test(text) ? "HDR" : "",
  ].filter(Boolean);
}

function streamCodec(stream: Stream): "ANY" | "H264" | "HEVC" | "AV1" {
  const codec = `${stream.clientResolve?.stream?.raw?.parsed?.codec ?? ""} ${streamText(stream)}`;
  if (/\b(?:av1)\b/i.test(codec)) return "AV1";
  if (/\b(?:hevc|h[ ._-]?265|x265)\b/i.test(codec)) return "HEVC";
  if (/\b(?:avc|h[ ._-]?264|x264)\b/i.test(codec)) return "H264";
  return "ANY";
}

function qualityRank(stream: Stream): number {
  const quality = `${stream.clientResolve?.stream?.raw?.parsed?.quality ?? ""} ${streamText(stream)}`;
  const rules = [
    /blu.?ray.*remux|remux.*blu.?ray/i,
    /blu.?ray/i,
    /web.?dl/i,
    /webrip/i,
    /hdrip/i,
    /hd.?rip/i,
    /dvdrip/i,
    /hdtv/i,
    /\bcam\b/i,
    /\bts\b/i,
    /\btc\b/i,
    /\bscr\b/i,
  ];
  const index = rules.findIndex((rule) => rule.test(quality));
  return index < 0 ? 0 : rules.length - index;
}
