// Extension included so Node's resolver finds it under the test runner, which
// does not resolve like the bundler does.
import { probeSource, statusReason } from "./sourceProbe.ts";
import { readRetryDelay } from "./requestPolicy.ts";
import {
  ALL_FORMATS,
  AudioBufferSink,
  CanvasSink,
  Input,
  UrlSource,
  type InputAudioTrack,
  type InputVideoTrack,
  type WrappedCanvas,
} from "mediabunny";

/**
 * Plays what the browser will not, by decoding it rather than repackaging it.
 *
 * Everything before this tried to hand the browser a file it would accept:
 * Matroska rewritten as fragmented MP4, fed through Media Source. That fails
 * for reasons that have nothing to do with whether the machine can decode the
 * video — a codec string whose prefix disagrees with the sample entry, a MIME
 * type Media Source declines, an initialization segment rejected without a
 * reason. Chromium decodes 4K HEVC quite happily; it just would not accept it
 * through that door.
 *
 * So this opens a different one. Frames are decoded with WebCodecs and drawn
 * to a canvas, audio is decoded to buffers and played through Web Audio, and
 * no container is ever written. There is no MIME type to get wrong.
 *
 * The cost is real and worth stating: no hardware-accelerated video element,
 * no AirPlay, no picture-in-picture, no background audio. It is the fallback,
 * not the default — anything the browser plays natively should still be given
 * to a <video> element instead.
 */

/**
 * How long a startup step may take before it is called a failure.
 *
 * Reading a large Matroska header is many round trips and legitimately slow on
 * a phone, so it gets its own budget — the probe has already established by
 * then that the host answers at all, which is what the short budgets are for.
 */
const STAGE_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 90_000;

/** Registered once per page, and only when something actually needs it. */
let dolbyDecoder: Promise<void> | null = null;
function ensureDolbyDecoder() {
  dolbyDecoder ??= import("@mediabunny/ac3")
    .then(({ registerAc3Decoder }) => registerAc3Decoder())
    .catch(() => {
      // Dolby audio then reports itself undecodable, which is said plainly
      // rather than playing silence.
    });
  return dolbyDecoder;
}

export type PlayerState =
  | "loading"
  | "buffering"
  | "ready"
  | "ended"
  | "error";

export type PlayerStatus = { state: PlayerState; message: string };

export type MediabunnyPlayerOptions = {
  requestHeaders?: Record<string, string>;
  startPositionSeconds?: number;
  /**
   * Languages to prefer, best first, as two-letter codes. A file's first audio
   * track is not its main one — a release with French first will play French
   * to everybody unless asked otherwise.
   */
  preferredLanguages?: string[];
  onTime?(currentTime: number, duration: number): void;
  onEnded?(): void;
  onAudioTracks?(tracks: AudioTrackChoice[], selected: number): void;
};

export type AudioTrackChoice = { id: number; label: string };

/**
 * Three-letter codes whose two-letter form is not their first two letters.
 *
 * Matroska tags tracks with ISO 639-2 while people and browsers ask in 639-1,
 * and the two only coincide by accident: "eng" does shorten to "en", but "ger"
 * is "de", "spa" is "es" and "jpn" is "ja". Truncating looks like it works
 * until it silently stops matching, which is the same failure as having no
 * preference at all.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  alb: "sq", sqi: "sq", ara: "ar", arm: "hy", hye: "hy", baq: "eu", eus: "eu",
  ben: "bn", bul: "bg", bur: "my", mya: "my", chi: "zh", zho: "zh", cze: "cs",
  ces: "cs", dan: "da", dut: "nl", nld: "nl", eng: "en", est: "et", fin: "fi",
  fre: "fr", fra: "fr", geo: "ka", kat: "ka", ger: "de", deu: "de", gre: "el",
  ell: "el", heb: "he", hin: "hi", hrv: "hr", hun: "hu", ice: "is", isl: "is",
  ind: "id", ita: "it", jpn: "ja", kor: "ko", lav: "lv", lit: "lt", mac: "mk",
  mkd: "mk", may: "ms", msa: "ms", nor: "no", per: "fa", fas: "fa", pol: "pl",
  por: "pt", rum: "ro", ron: "ro", rus: "ru", slo: "sk", slk: "sk", slv: "sl",
  spa: "es", srp: "sr", swe: "sv", tam: "ta", tel: "te", tha: "th", tur: "tr",
  ukr: "uk", urd: "ur", vie: "vi", wel: "cy", cym: "cy",
};

/** "en-GB", "eng" and "en" are the same request. */
const normalizeLanguage = (value: string) => {
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return LANGUAGE_ALIASES[base] ?? base.slice(0, 2);
};

/**
 * Picks the track to open with.
 *
 * Playable first, then language. A disc-sourced release commonly leads with a
 * TrueHD or Atmos track that nothing in a browser can decode, followed by the
 * AC-3 mix that everything can — so choosing on language alone lands on the
 * one that produces silence. A track that cannot be decoded is not a candidate
 * at all, whatever language it claims.
 *
 * `decodable` is optional so the choice can still be reasoned about without
 * it; where it is absent every track is treated as a candidate.
 */
export function chooseAudioTrack(
  languages: string[],
  preferred: string[],
  decodable?: boolean[],
): number {
  const available = languages.map(normalizeLanguage);
  const playable = languages
    .map((_, index) => index)
    .filter((index) => decodable?.[index] !== false);

  for (const want of preferred.map(normalizeLanguage).filter(Boolean)) {
    const match = playable.find((index) => available[index] === want);
    if (match !== undefined) return match;
  }
  // No preferred language among the playable ones: the file's own order
  // decides, but still only among tracks that will actually make a sound.
  if (playable.length) return playable[0];
  return 0;
}

/**
 * Folds any channel layout down to stereo without losing a channel.
 *
 * Web Audio will downmix on its own, but only correctly if the channels are in
 * the order it assumes — SMPTE's L R C LFE Ls Rs. Decoders do not agree on
 * that: AC-3's native order is L C R Ls Rs LFE, and handing one to the other
 * puts the centre channel where the right channel is expected. Since dialogue
 * lives almost entirely in the centre, getting that wrong is exactly the
 * failure where the music plays and nobody speaks.
 *
 * Rather than guess the order, every channel is mixed into both sides. A known
 * layout gets the ITU coefficients and proper stereo placement; an unknown one
 * still contributes to both, which may place a voice imprecisely but can never
 * silence it. Losing the dialogue is the one outcome worth ruling out
 * structurally rather than hoping for.
 */
function downmixToStereo(
  buffer: AudioBuffer,
  context: AudioContext,
): AudioBuffer {
  if (buffer.numberOfChannels <= 2) return buffer;

  const frames = buffer.length;
  const stereo = context.createBuffer(2, frames, buffer.sampleRate);
  const left = stereo.getChannelData(0);
  const right = stereo.getChannelData(1);

  // ITU-R BS.775: side channels at -3dB, centre split equally between both.
  const HALF_POWER = Math.SQRT1_2;
  // 5.1 as Web Audio reads it. Anything else falls through to the even mix
  // below, which is imprecise but complete.
  const smpte51 = buffer.numberOfChannels === 6;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    let toLeft = HALF_POWER;
    let toRight = HALF_POWER;
    if (smpte51) {
      // L, R, C, LFE, Ls, Rs
      if (channel === 0) (toLeft = 1), (toRight = 0);
      else if (channel === 1) (toLeft = 0), (toRight = 1);
      else if (channel === 2) (toLeft = HALF_POWER), (toRight = HALF_POWER);
      // The LFE carries no dialogue and muddies a stereo mix; the standard
      // downmix drops it.
      else if (channel === 3) continue;
      else if (channel === 4) (toLeft = HALF_POWER), (toRight = 0);
      else if (channel === 5) (toLeft = 0), (toRight = HALF_POWER);
    }
    for (let frame = 0; frame < frames; frame += 1) {
      left[frame] += source[frame] * toLeft;
      right[frame] += source[frame] * toRight;
    }
  }

  // Summing channels can exceed full scale, and clipping sounds far worse than
  // being a little quiet.
  let peak = 0;
  for (const channel of [left, right])
    for (let frame = 0; frame < frames; frame += 1) {
      const value = Math.abs(channel[frame]);
      if (value > peak) peak = value;
    }
  if (peak > 1) {
    const scale = 1 / peak;
    for (const channel of [left, right])
      for (let frame = 0; frame < frames; frame += 1) channel[frame] *= scale;
  }
  return stereo;
}

export class MediabunnyPlayer {
  private input: Input | null = null;
  private videoTrack: InputVideoTrack | null = null;
  private audioTrack: InputAudioTrack | null = null;
  private audioOptions: InputAudioTrack[] = [];
  private audioDecodable: boolean[] = [];
  private audioCodecs: (string | null)[] = [];
  private audioChannels: number[] = [];
  private audioIndex = 0;
  private videoSink: CanvasSink | null = null;
  private audioSink: AudioBufferSink | null = null;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;

  private stopped = false;
  private playing = false;
  private generation = 0;
  private queuedNodes = new Set<AudioBufferSourceNode>();
  private frameHandle: number | null = null;

  /** Where playback sits when paused, and the origin the audio clock counts from. */
  private pausedAt = 0;
  private contextStartTime = 0;
  private startedFrom = 0;
  private volume = 1;
  private muted = false;

  duration = 0;

  private url: string;
  private canvas: HTMLCanvasElement;
  private onStatus: (status: PlayerStatus) => void;
  private options: MediabunnyPlayerOptions;

  // Assigned rather than declared as parameter properties: the test runner
  // strips types without compiling them, and that is the one TypeScript-only
  // syntax it cannot strip. Keeping it out means this module can be tested
  // like every other one here.
  constructor(
    url: string,
    canvas: HTMLCanvasElement,
    onStatus: (status: PlayerStatus) => void,
    options: MediabunnyPlayerOptions = {},
  ) {
    this.url = url;
    this.canvas = canvas;
    this.onStatus = onStatus;
    this.options = options;
  }

  get currentTime() {
    if (!this.playing || !this.context) return this.pausedAt;
    return this.startedFrom + (this.context.currentTime - this.contextStartTime);
  }

  get paused() {
    return !this.playing;
  }

  /**
   * Runs one step of startup, named and bounded.
   *
   * Named because the status text is the only thing visible when this stalls,
   * and "Reading the stream…" for the whole of a chain this long says nothing
   * about where it stopped. Bounded because none of these reject when they go
   * wrong on a browser that dislikes the file — they simply never settle, and
   * `.catch()` does nothing for a promise that never resolves. That is the
   * difference between a player that says what went wrong and one that spins.
   */
  private async stage<T>(
    label: string,
    work: () => Promise<T>,
    budgetMs = STAGE_TIMEOUT_MS,
    detail: () => string = () => "",
  ): Promise<T> {
    this.report("loading", label);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `Gave up ${label.replace(/…$/, "").toLowerCase()} after ${Math.round(budgetMs / 1000)}s.${detail()} Try another source, or an external player.`,
                ),
              ),
            budgetMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async start() {
    // Frames are decoded with WebCodecs; without it there is nothing to fall
    // back to, and saying so beats stalling on a decoder that will never
    // answer. Safari only gained VideoDecoder in 16.4.
    if (typeof VideoDecoder === "undefined") {
      this.report(
        "error",
        "This browser has no WebCodecs support, which this player needs to decode the file. Update your browser, or use an external player.",
      );
      return;
    }
    // Before anything commits to the file. Everything below reads it over
    // range requests, and a host that will not serve them does not fail here —
    // it stalls, with no status to report and nothing to decode.
    const reachable = await this.stage("Checking the source…", () =>
      probeSource(this.url, this.options.requestHeaders),
    );
    if (!reachable.ok) {
      this.report("error", reachable.reason);
      return;
    }
    // Deliberately not a reason to refuse: the reader falls back to reading
    // sequentially, which is slower but works, and the probe cannot tell the
    // difference between a host that has no ranges and one that simply did not
    // say so. It is only worth mentioning if something later actually fails.
    const rangeNote =
      reachable.ranges === "no"
        ? " This host does not appear to serve ranges, so the file has to be read from the start."
        : "";

    // Before any track is asked whether it can be decoded, because the answer
    // for Dolby depends on this. No browser's own AudioDecoder handles AC-3 or
    // E-AC-3, and most of what needs this player at all carries one of them —
    // without this they would report themselves undecodable and play silent.
    // Loaded on demand: it is around a megabyte, and a file with ordinary
    // audio should never pay for it.
    await this.stage("Loading the Dolby decoder…", ensureDolbyDecoder);
    // What the reader's own requests did, so a failure can be described by
    // what the host said rather than by which step was waiting on it.
    let lastStatus = 0;
    let lastNetworkError = "";
    const input = new Input({
      formats: ALL_FORMATS,
      source: new UrlSource(this.url, {
        requestInit: this.options.requestHeaders
          ? { headers: this.options.requestHeaders }
          : undefined,
        // Its default retries forever unless it suspects CORS, so a host that
        // fails any other way is waited on rather than reported. This gives up
        // and lets the error through.
        getRetryDelay: readRetryDelay,
        fetchFn: async (resource, init) => {
          try {
            const response = await fetch(resource, init);
            if (!response.ok) lastStatus = response.status;
            return response;
          } catch (error) {
            lastNetworkError =
              error instanceof Error ? error.message : String(error);
            throw error;
          }
        },
      }),
    });
    this.input = input;
    /** Whatever the host last said, ready to append to a failure. */
    const hostSaid = () =>
      (lastStatus
        ? ` ${statusReason(lastStatus)}`
        : lastNetworkError
          ? ` The last request failed with: ${lastNetworkError}.`
          : "") + rangeNote;

    const [video, audioTracks] = await this.stage(
      "Reading the stream…",
      () =>
        Promise.all([
          input.getPrimaryVideoTrack(),
          input.getAudioTracks(),
        ]).catch((error: unknown) => {
          const detail = hostSaid();
          throw detail
            ? new Error(`Could not read this stream.${detail}`)
            : error;
        }),
      READ_TIMEOUT_MS,
      hostSaid,
    );
    this.audioOptions = audioTracks;
    // Asked of every track up front rather than of the chosen one afterwards:
    // it is what decides the choice, not a check on it.
    this.audioDecodable = await this.stage(
      "Checking which audio this browser can decode…",
      () => Promise.all(audioTracks.map((track) => track.canDecode().catch(() => false))),
    );
    this.audioCodecs = await Promise.all(
      audioTracks.map((track) =>
        track.getCodec().catch(() => null),
      ),
    );
    this.audioChannels = await Promise.all(
      audioTracks.map((track) => track.getNumberOfChannels().catch(() => 0)),
    );
    this.audioIndex = chooseAudioTrack(
      audioTracks.map((track) => track.languageCode || ""),
      this.options.preferredLanguages ?? [],
      this.audioDecodable,
    );
    const audio = this.audioDecodable[this.audioIndex]
      ? (audioTracks[this.audioIndex] ?? null)
      : null;

    // Asked before anything is decoded, so an unplayable track is reported as
    // such rather than as a stall.
    const trouble: string[] = [];
    this.videoTrack = (await this.stage(
      "Checking whether this browser can decode the video…",
      async () => (video && (await video.canDecode().catch(() => false)) ? video : null),
    )) as InputVideoTrack | null;
    if (video && !this.videoTrack) trouble.push("its video");
    this.audioTrack = audio;
    if (audioTracks.length && !audio) trouble.push("its audio");

    if (!this.videoTrack && !this.audioTrack) {
      this.report(
        "error",
        trouble.length
          ? `This browser cannot decode ${trouble.join(" or ")}. Try an external player.`
          : "This file contains no video or audio track that could be read.",
      );
      return;
    }

    this.duration = await this.stage(
      "Measuring the stream…",
      () => input.computeDuration().catch(() => 0),
      READ_TIMEOUT_MS,
    );

    if (this.audioTrack)
      await this.stage("Starting audio…", () => this.openAudio());

    if (this.videoTrack) {
      const track = this.videoTrack;
      const [width, height] = await this.stage("Starting video…", () =>
        Promise.all([track.getDisplayWidth(), track.getDisplayHeight()]),
      );
      this.canvas.width = width;
      this.canvas.height = height;
      this.videoSink = new CanvasSink(track, {
        poolSize: 2,
        fit: "contain",
      });
    }

    this.options.onAudioTracks?.(this.describeAudioTracks(), this.audioIndex);

    if (trouble.length)
      this.report(
        "buffering",
        `Playing without ${trouble.join(" or ")}, which this browser cannot decode.`,
      );

    // The first decode is where a browser that dislikes the stream tends to go
    // quiet rather than complain, so it is bounded like the rest.
    await this.stage("Decoding the first frame…", () =>
      this.seek(this.options.startPositionSeconds ?? 0, true),
    );
  }

  private async openAudio() {
    if (!this.audioTrack) return;
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    // Matching the file's rate keeps low-rate audio from being resampled into
    // something that sounds wrong.
    this.context = new AudioContextClass({
      sampleRate: await this.audioTrack.getSampleRate(),
    });
    this.gain = this.context.createGain();
    this.gain.connect(this.context.destination);
    this.applyVolume();
    this.audioSink = new AudioBufferSink(this.audioTrack);
  }

  /**
   * Starts playing.
   *
   * Must be reached from a real interaction the first time. Safari leaves a
   * new AudioContext suspended and only lets a gesture resume it, which is why
   * the example this grew out of is silent there while Chrome is fine.
   */
  async play() {
    if (this.stopped || this.playing) return;
    const context = this.context;
    // Read through a call so it is genuinely re-checked after the await —
    // Safari's "interrupted" also belongs on the not-running side.
    const running = () => !context || context.state === "running";
    if (!running()) {
      // Safari only resumes inside a real gesture, and off one it leaves the
      // promise pending rather than rejecting — awaiting it plainly is a hang
      // with no error and no time ever reported. Raced, then checked: if it
      // did not start, playback simply does not begin and the centre play
      // button becomes the gesture that makes it work.
      await Promise.race([
        context!.resume().catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
      if (!running()) {
        this.report("ready", "");
        return;
      }
    }
    this.playing = true;
    this.startedFrom = this.pausedAt;
    this.contextStartTime = this.context?.currentTime ?? 0;
    this.run(++this.generation);
    this.report("ready", "");
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.currentTime;
    this.playing = false;
    this.generation += 1;
    this.silence();
  }

  /**
   * `keepStatus` leaves the caller's message up. The first seek runs inside a
   * named startup step, and clearing the text here would blank the one thing
   * that says how far loading got.
   */
  async seek(seconds: number, keepStatus = false) {
    const target = Math.max(0, Math.min(seconds, this.duration || seconds));
    const wasPlaying = this.playing;
    this.playing = false;
    this.generation += 1;
    this.silence();
    this.pausedAt = target;
    if (!keepStatus) this.report("buffering", "");
    // A still frame at the destination, so scrubbing shows where it landed
    // rather than freezing on where it left.
    if (this.videoSink) {
      const frame = await this.videoSink.getCanvas(target).catch(() => null);
      if (frame) this.draw(frame);
    }
    if (wasPlaying) await this.play();
    else {
      this.report("ready", "");
      this.options.onTime?.(this.currentTime, this.duration);
    }
  }

  /** The audio tracks the file offers, named as helpfully as it allows. */
  /**
   * The tracks worth offering, which is the ones that will make a sound.
   *
   * What a browser can decode differs between browsers — Safari and Chrome do
   * not agree — so this is what this browser can do, asked of it rather than
   * assumed. A listed track that turns out to be silent is worse than one that
   * was never listed.
   */
  private describeAudioTracks(): AudioTrackChoice[] {
    return this.audioOptions.flatMap((track, id) => {
      if (this.audioDecodable[id] === false) return [];
      const language = track.languageCode?.trim();
      const channels = this.audioChannels[id];
      const parts = [
        track.name?.trim(),
        language && language !== "und" ? language.toUpperCase() : "",
        this.audioCodecs[id]?.toUpperCase() ?? "",
        // 6 and 8 are the counts anyone recognises by name.
        channels === 6 ? "5.1" : channels === 8 ? "7.1" : channels === 2 ? "Stereo" : "",
      ].filter(Boolean);
      return [{ id, label: parts.join(" · ") || `Track ${id + 1}` }];
    });
  }

  /**
   * Switches audio track, keeping the picture where it is.
   *
   * The context is rebuilt rather than reused: a different track may be at a
   * different sample rate, and an AudioContext's rate is fixed once created.
   */
  async selectAudioTrack(id: number) {
    const track = this.audioOptions[id];
    if (!track || id === this.audioIndex) return;
    const resumeAt = this.currentTime;
    const wasPlaying = this.playing;
    this.playing = false;
    this.generation += 1;
    this.silence();

    this.audioIndex = id;
    this.audioTrack = this.audioDecodable[id] === false ? null : track;
    await this.context?.close().catch(() => undefined);
    this.context = null;
    this.gain = null;
    this.audioSink = null;
    if (this.audioTrack) await this.openAudio();
    else this.report("buffering", "That track cannot be decoded here.");

    this.pausedAt = resumeAt;
    this.options.onAudioTracks?.(this.describeAudioTracks(), this.audioIndex);
    if (wasPlaying) await this.play();
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    this.applyVolume();
  }

  setMuted(value: boolean) {
    this.muted = value;
    this.applyVolume();
  }

  stop() {
    this.stopped = true;
    this.playing = false;
    this.generation += 1;
    this.silence();
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    void this.context?.close().catch(() => undefined);
    try {
      this.input?.dispose();
    } catch {
      // Already gone, or never opened.
    }
  }

  private applyVolume() {
    if (this.gain)
      // Quadratic, because loudness is not linear in the slider's travel.
      this.gain.gain.value = this.muted ? 0 : this.volume ** 2;
  }

  private silence() {
    for (const node of this.queuedNodes) {
      try {
        node.stop();
      } catch {
        // Already finished; nothing to stop.
      }
    }
    this.queuedNodes.clear();
  }

  private draw(frame: WrappedCanvas) {
    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.drawImage(frame.canvas, 0, 0, this.canvas.width, this.canvas.height);
  }

  private report(state: PlayerState, message: string) {
    if (!this.stopped) this.onStatus({ state, message });
  }

  /** Video and audio each run their own loop, both reading the same clock. */
  private run(generation: number) {
    void this.runVideo(generation);
    void this.runAudio(generation);
    const tick = () => {
      if (this.generation !== generation || this.stopped) return;
      this.options.onTime?.(this.currentTime, this.duration);
      if (this.duration && this.currentTime >= this.duration) {
        this.playing = false;
        this.silence();
        this.report("ended", "");
        this.options.onEnded?.();
        return;
      }
      this.frameHandle = requestAnimationFrame(tick);
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  private async runVideo(generation: number) {
    if (!this.videoSink) return;
    const start = this.startedFrom;
    let pending: WrappedCanvas | null = null;
    for await (const frame of this.videoSink.canvases(start)) {
      if (this.generation !== generation || this.stopped) return;
      // Held until its moment, then drawn — the audio clock decides when, so
      // the two stay together rather than drifting apart.
      pending = frame;
      while (pending && pending.timestamp > this.currentTime) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (this.generation !== generation || this.stopped) return;
      }
      if (pending) this.draw(pending);
      pending = null;
    }
  }

  private async runAudio(generation: number) {
    if (!this.audioSink || !this.context || !this.gain) return;
    const context = this.context;
    for await (const { buffer, timestamp } of this.audioSink.buffers(
      this.startedFrom,
    )) {
      if (this.generation !== generation || this.stopped) return;
      const node = context.createBufferSource();
      node.buffer = downmixToStereo(buffer, context);
      node.connect(this.gain);

      let at = this.contextStartTime + timestamp - this.startedFrom;
      // Rounded to a sample boundary, or consecutive buffers land fractionally
      // apart and click.
      at = Math.round(context.sampleRate * at) / context.sampleRate;
      if (at >= context.currentTime) node.start(at);
      else node.start(context.currentTime, context.currentTime - at);

      this.queuedNodes.add(node);
      node.onended = () => this.queuedNodes.delete(node);

      // Stay a few seconds ahead and no further: decoding the whole file into
      // memory would be the same mistake the streaming remuxer made.
      while (
        timestamp - this.currentTime > 3 &&
        this.generation === generation &&
        !this.stopped
      )
        await new Promise((resolve) => setTimeout(resolve, 120));
      if (this.generation !== generation || this.stopped) return;
    }
  }
}
