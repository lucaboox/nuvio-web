/**
 * What this browser will actually decode, asked of it directly.
 *
 * The player only finds out whether a file is decodable after it has read the
 * container, so a failure before that says nothing about codecs — which leaves
 * "it cannot be decoded" and "it never got that far" looking identical from a
 * phone. This answers the first question on its own, in advance, and costs one
 * synchronous-ish call per codec.
 */

/** The codecs worth naming, with a representative configuration for each. */
const VIDEO: Array<[string, string]> = [
  ["H.264", "avc1.640028"],
  ["HEVC", "hvc1.1.6.L93.B0"],
  ["VP9", "vp09.00.10.08"],
  ["AV1", "av01.0.04M.08"],
];
/**
 * No AC-3 or E-AC-3 here on purpose.
 *
 * No browser decodes them, so `isConfigSupported` says no everywhere — but the
 * player registers its own decoder for them, so saying "this browser cannot
 * decode AC-3" inside a playback error would imply a file that plays fine
 * cannot. What happens to Dolby audio is reported by the player itself, which
 * knows whether its own decoder loaded.
 */
const AUDIO: Array<[string, string]> = [
  ["AAC", "mp4a.40.2"],
  ["Opus", "opus"],
];

export type DecoderSupport = Record<string, boolean | null>;

/** Names the two groups, so "no HEVC" is visible at a glance. */
export function summariseDecoders(support: DecoderSupport): string {
  const names = Object.keys(support);
  const yes = names.filter((name) => support[name] === true);
  const no = names.filter((name) => support[name] === false);
  if (!yes.length && !no.length) return "";
  const parts: string[] = [];
  if (yes.length) parts.push(`can decode ${yes.join(", ")}`);
  if (no.length) parts.push(`cannot decode ${no.join(", ")}`);
  return `This browser ${parts.join("; ")}.`;
}

const ask = async (
  check: (config: never) => Promise<{ supported?: boolean }>,
  config: unknown,
  timeoutMs: number,
): Promise<boolean | null> => {
  try {
    // Bounded: a decoder that declines to answer must not become another wait.
    const result = await Promise.race([
      check(config as never),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    return result === null ? null : (result.supported ?? false);
  } catch {
    // A configuration the browser rejects outright is a no, not an unknown.
    return false;
  }
};

export async function probeDecoders(timeoutMs = 3000): Promise<DecoderSupport> {
  const support: DecoderSupport = {};
  const video =
    typeof VideoDecoder === "undefined" ? null : VideoDecoder.isConfigSupported;
  const audio =
    typeof AudioDecoder === "undefined" ? null : AudioDecoder.isConfigSupported;
  await Promise.all([
    ...VIDEO.map(async ([name, codec]) => {
      support[name] = video
        ? await ask(video, { codec, width: 1920, height: 1080 }, timeoutMs)
        : false;
    }),
    ...AUDIO.map(async ([name, codec]) => {
      support[name] = audio
        ? await ask(
            audio,
            { codec, sampleRate: 48000, numberOfChannels: 2 },
            timeoutMs,
          )
        : false;
    }),
  ]);
  return support;
}
