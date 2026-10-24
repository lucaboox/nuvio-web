import { languageName } from "./languageName.ts";
import type { Meta, Video } from "../types";

export type BrowserSubtitleCue = {
  start: number;
  end: number;
  text: string;
};

function timestampSeconds(value: string): number | null {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4].padEnd(3, "0"));
  if (![hours, minutes, seconds, milliseconds].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function plainCueText(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .trim();
}

/**
 * The dialogue out of an ASS/SSA script, which is what most anime subtitles
 * are. Read as plain text: styling, positioning and karaoke are dropped. Two
 * things would otherwise read as noise without a renderer — fansubs layer the
 * same line several times for outlines and effects, so duplicates collapse;
 * and signs drawn as vector shapes (\p1) are coordinates, so they are skipped.
 */
function parseAssSubtitles(source: string): BrowserSubtitleCue[] {
  const cues: BrowserSubtitleCue[] = [];
  const seen = new Set<string>();
  let format = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];
  let inEvents = false;
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inEvents = line.toLowerCase() === "[events]";
      continue;
    }
    if (!inEvents) continue;
    if (/^format\s*:/i.test(line)) {
      format = line
        .slice(line.indexOf(":") + 1)
        .split(",")
        .map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue\s*:/i.test(line)) continue;
    const fields = line.slice(line.indexOf(":") + 1).split(",");
    // Text is the last field and may itself contain commas.
    const head = fields.slice(0, format.length - 1);
    const body = fields.slice(format.length - 1).join(",");
    if (/\{[^}]*\\p[1-9]/.test(body)) continue;
    const field = (name: string) => head[format.indexOf(name)] ?? "";
    const start = timestampSeconds(field("start"));
    const end = timestampSeconds(field("end"));
    const text = body
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\[Nn]/g, "\n")
      .replace(/\\h/g, " ")
      .split("\n")
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n");
    if (start == null || end == null || end <= start || !text) continue;
    const key = `${start}|${end}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cues.push({ start, end, text });
  }
  return cues.sort((left, right) => left.start - right.start);
}

/** Parses WebVTT, SRT and ASS/SSA into safe cues for video or canvas output. */
export function parseBrowserSubtitles(source: string): BrowserSubtitleCue[] {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (/^\s*\[script info\]/i.test(normalized) || /^dialogue\s*:/im.test(normalized))
    return parseAssSubtitles(normalized);
  const cues: BrowserSubtitleCue[] = [];
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [startText, endText = ""] = lines[timingIndex].split(/\s+-->\s+/, 2);
    const start = timestampSeconds(startText);
    const end = timestampSeconds(endText);
    const text = plainCueText(lines.slice(timingIndex + 1));
    if (start == null || end == null || end <= start || !text) continue;
    cues.push({ start, end, text });
  }
  return cues.sort((left, right) => left.start - right.start);
}

/** How far back an earlier cue is looked for that may still be on screen. */
const OVERLAP_WINDOW = 12;

/**
 * Finds the text on screen at a playback position without walking the entire
 * subtitle file on every animation frame. The binary search lands on the last
 * cue that has started; a few before it are checked too, because ASS scripts
 * routinely overlap a sign with the dialogue under it, and showing only the
 * newer of the two would drop a line mid-sentence.
 */
export function activeBrowserSubtitleText(
  cues: BrowserSubtitleCue[],
  time: number,
): string {
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (cues[middle].start <= time) low = middle + 1;
    else high = middle;
  }
  const showing: string[] = [];
  for (let index = low - 1; index >= Math.max(0, low - OVERLAP_WINDOW); index -= 1) {
    const cue = cues[index];
    if (time < cue.end && !showing.includes(cue.text)) showing.unshift(cue.text);
  }
  return showing.join("\n");
}

/**
 * The ids to ask subtitle addons with, most specific first.
 *
 * Anime catalogs name episodes by Kitsu or MAL ids, which the big subtitle
 * addons do not understand — OpenSubtitles only knows IMDb. The Kitsu addon
 * maps each episode to an IMDb season and episode, so that mapping is offered
 * as a second id for the addons that would otherwise have nothing to say.
 */
export function subtitleRequestIds(
  meta: Pick<Meta, "id" | "imdbId">,
  video?: Pick<Video, "id" | "imdbId" | "imdbSeason" | "imdbEpisode">,
): string[] {
  const ids = [video?.id || meta.id];
  if (video?.imdbId)
    ids.push(
      video.imdbSeason != null && video.imdbEpisode != null
        ? `${video.imdbId}:${video.imdbSeason}:${video.imdbEpisode}`
        : video.imdbId,
    );
  else if (!video && meta.imdbId) ids.push(meta.imdbId);
  return [...new Set(ids.filter(Boolean))];
}

/**
 * Which of `ids` an addon accepts, by the prefixes it declares. One that
 * declares none is asked with the first; one that matches none is not asked,
 * rather than sent an id it can only answer with nothing.
 */
export function idForPrefixes(
  ids: readonly string[],
  prefixes: readonly string[] | undefined,
): string | undefined {
  if (!prefixes?.length) return ids[0];
  return ids.find((id) => prefixes.some((prefix) => id.startsWith(prefix)));
}

/** Same conservative forced-track inference used by the native client. */
export function isForcedSubtitle(
  id: string,
  language: string,
  url = "",
): boolean {
  if (language.trim().toLowerCase() === "forced") return true;
  const text = `${id} ${language} ${url}`.toLowerCase();
  return text.includes("forced") || (text.includes("songs") && text.includes("sign"));
}

export type BrowserSubtitleOption = {
  id: string;
  lang: string;
  url?: string;
};

/**
 * Mirrors Nuvio's forced-subtitle selection policy for external browser tracks.
 * A primary preference of Off is final, regardless of a stale fallback value.
 */
export function chooseBrowserSubtitle(
  tracks: BrowserSubtitleOption[],
  preferredLanguage: string,
  secondaryLanguage: string,
  deviceLanguages: readonly string[],
  audioLanguage: string | undefined,
  useForcedSubtitles: boolean,
): number {
  const preferred = preferredLanguage.trim().toLowerCase();
  if (!preferred || preferred === "none") return -1;
  const normalizedAudio = languageName(audioLanguage).toLowerCase();
  if (useForcedSubtitles && !normalizedAudio) return -1;

  const targets = [
    ...(preferred === "forced"
      ? normalizedAudio ? [normalizedAudio] : []
      : preferred === "device"
        ? deviceLanguages
        : [preferred]),
    secondaryLanguage,
  ]
    .map((value) => languageName(value).toLowerCase())
    .filter(Boolean);
  const forcedOnly =
    preferred === "forced" ||
    (useForcedSubtitles && targets[0] === normalizedAudio);
  return tracks.findIndex(
    (track) =>
      targets.includes(languageName(track.lang).toLowerCase()) &&
      isForcedSubtitle(track.id, track.lang, track.url) === forcedOnly,
  );
}
