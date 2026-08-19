/**
 * What this browser can actually play.
 *
 * Matroska is the recurring problem. Chromium demuxes .mkv well enough that
 * H.264 video usually shows, but it ships no AC3/EAC3/DTS/TrueHD decoder — so
 * the file plays silently rather than failing, which reads as a bug in the
 * app. Safari refuses the container outright, so nothing starts at all.
 */

const MKV = /\.(mkv|m2ts|ts|avi|wmv|flv|ogv|mpg|mpeg|vob|divx)(\?|#|$)/i;
const MP4ISH = /\.(mp4|m4v|mov|webm)(\?|#|$)/i;

export type PlayabilityVerdict = {
  /** False when the container will not open in this browser at all. */
  playable: boolean;
  /** Set when it may open but is likely to have unsupported audio. */
  audioRisk: boolean;
  reason: string;
};

export const isAppleWebKit = () =>
  /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent) ||
    /iPad|iPhone|iPod/.test(navigator.userAgent);

/** The local remuxer understands Matroska only, not every legacy type. */
export function isMatroskaSource(url: string, filename?: string): boolean {
  return [filename, url].some((value) =>
    /\.mkv(?:$|[?#\s])/i.test(value ?? ""),
  );
}

/** What the decoding player needs to exist at all. */
export const hasWebCodecs = () =>
  typeof VideoDecoder !== "undefined" && typeof AudioDecoder !== "undefined";

/**
 * Prefer decoding Matroska ourselves on every browser that can.
 *
 * Chromium can demux many MKVs natively, but it commonly accepts the video
 * while silently rejecting its AC-3/E-AC-3 audio. Waiting for native playback
 * to fail therefore never reaches the compatibility audio track this can
 * select.
 *
 * Gated on WebCodecs, which is what the player actually uses. It used to be
 * gated on MediaSource — true of the remuxer this replaced, and meaningless
 * now: no container is written and MSE is never touched. On an iPhone, where
 * `window.MediaSource` is absent, that stale check sent every .mkv down the
 * native path to be refused by a Safari that cannot open the container.
 */
export function shouldUseRemuxFallback(url: string, filename?: string): boolean {
  return isMatroskaSource(url, filename) && hasWebCodecs();
}

export function assessPlayback(url: string, filename?: string): PlayabilityVerdict {
  const target = `${filename ?? ""} ${url}`;
  if (MP4ISH.test(target) || !MKV.test(target))
    return { playable: true, audioRisk: false, reason: "" };

  if (isAppleWebKit())
    return {
      playable: false,
      audioRisk: true,
      reason:
        "Safari and iOS cannot open Matroska (.mkv) files at all. Use an external player, or pick a source in MP4.",
    };

  // Chromium opens the container but has no licensed decoder for the audio
  // codecs these files usually carry.
  return {
    playable: true,
    audioRisk: true,
    reason:
      "This is an .mkv. Your browser can usually show the video but has no decoder for AC3, EAC3, DTS or TrueHD audio, so it may play silently.",
  };
}

/**
 * Chromium counts decoded bytes per track. Video climbing while audio stays at
 * zero means the audio codec was rejected — the only reliable way to tell,
 * since no error fires and `audioTracks` is not implemented.
 */
export function audioIsSilent(element: HTMLVideoElement): boolean {
  const media = element as HTMLVideoElement & {
    webkitAudioDecodedByteCount?: number;
    webkitVideoDecodedByteCount?: number;
  };
  if (typeof media.webkitAudioDecodedByteCount !== "number") return false;
  return (
    (media.webkitVideoDecodedByteCount ?? 0) > 0 &&
    media.webkitAudioDecodedByteCount === 0
  );
}
