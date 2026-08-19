import type Hls from "hls.js";
import { copyStreamUrl, externalPlayerOptions } from "../lib/externalPlayer";
import { safeHttpUrl } from "../lib/security";
import {
  assessPlayback,
  audioIsSilent,
  shouldUseRemuxFallback,
} from "../lib/playback";
import { MediabunnyPlayer } from "../lib/mediabunnyPlayer";
import {
  browserColor,
  type WebPlayerSettings,
} from "../lib/webSettings";
import {
  ArrowLeft,
  Copy,
  Eye,
  ExternalLink,
  FastForward,
  List,
  LoaderCircle,
  Maximize,
  Music2,
  Pause,
  Play,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  hasEpisodeAired,
  resolveNextEpisode,
  shouldShowNextEpisode,
} from "../lib/nextEpisode";
import {
  episodePercent,
  remainingShort,
  watchKey,
  type WatchIndex,
} from "../lib/progress";
import { EpisodeRow } from "./Details";
import {
  activeSkipSegment,
  creditsStart,
  loadSkipSegments,
  skipLabel,
  type SkipSegment,
} from "../lib/skipSegments";
import type { ExternalPlayerMode, Meta, Stream, Video } from "../types";

type AudioChoice = { id: number; label: string };
type NativeAudioTrackList = {
  length: number;
  [index: number]: { enabled: boolean; label?: string; language?: string };
};
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);
function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor(value / 60) % 60;
  const hours = Math.floor(value / 3600);
  return hours
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** Runtime reported by Stremio metadata, normalized to seconds. */
function runtimeHintSeconds(meta: Meta, video?: Video) {
  if (typeof video?.runtime === "number" && video.runtime > 0)
    return video.runtime * 60;
  const value = meta.runtime?.trim() ?? "";
  if (!value) return undefined;
  const hours = /(\d+(?:\.\d+)?)\s*h/i.exec(value);
  const minutes = /(\d+(?:\.\d+)?)\s*m/i.exec(value);
  const seconds =
    Number(hours?.[1] ?? 0) * 3600 + Number(minutes?.[1] ?? 0) * 60;
  if (seconds > 0) return seconds;
  const bareMinutes = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : 0;
  return bareMinutes > 0 ? bareMinutes * 60 : undefined;
}

export function Player({
  stream,
  meta,
  video,
  onClose,
  onExternalPlay,
  onProgress,
  settings,
  startPositionMs = 0,
  episodes,
  watchIndex,
  onPlayEpisode,
}: {
  stream: Stream;
  meta: Meta;
  video?: Video;
  onClose(): void;
  /**
   * Hands the stream off to a player outside the browser. Raised rather than
   * launched here: closing this player and recording where it got to are the
   * app's to do, and both have to happen for the handoff to be worth anything.
   */
  onExternalPlay(
    mode: ExternalPlayerMode,
    url: string,
    positionMs: number,
  ): void;
  /** Where to resume from. 0 starts at the beginning. */
  startPositionMs?: number;
  /**
   * The run this episode belongs to, so the player can offer the next one and
   * let another be chosen without leaving playback.
   */
  episodes?: Video[];
  watchIndex?: WatchIndex;
  /** Resolves a source for another episode and switches to it. */
  onPlayEpisode?(next: Video): void;
  /** Reports a resume point. Fired periodically, on pause, and on exit. */
  onProgress(positionMs: number, durationMs: number, ended: boolean): void;
  settings: WebPlayerSettings;
}) {
  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * The decoding player, when the browser will not take the file directly.
   * While it is set it owns playback entirely, and the <video> element is
   * neither playing nor asked anything.
   */
  const engineRef = useRef<MediabunnyPlayer | null>(null);
  const [errorCopied, setErrorCopied] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [remuxActive, setRemuxActive] = useState(false);
  /** True while the decoding player owns playback, and the canvas is shown. */
  const [decoding, setDecoding] = useState(false);
  const [warning, setWarning] = useState("");
  useEffect(() => {
    if (!warning) return;
    const timer = window.setTimeout(() => setWarning(""), 6000);
    return () => window.clearTimeout(timer);
  }, [warning]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const seekPreviewRef = useRef<number | null>(null);
  // Kept in a ref so the reporting effect can run once for the whole session
  // rather than resubscribing on every timeupdate.
  const reportRef = useRef(onProgress);
  reportRef.current = onProgress;
  const [volume, setVolume] = useState(() =>
    Number(localStorage.getItem("nuvio-web-volume") ?? 1),
  );
  const [muted, setMuted] = useState(
    () => localStorage.getItem("nuvio-web-muted") === "true",
  );
  const [controlsVisible, setControlsVisible] = useState(true);
  const [audioOpen, setAudioOpen] = useState(false);
  const [externalPlayerOpen, setExternalPlayerOpen] = useState(false);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  /** Dismissed by hand, so it does not come back for the rest of the episode. */
  const [nextDismissed, setNextDismissed] = useState(false);
  const [skipSegments, setSkipSegments] = useState<SkipSegment[]>([]);
  /** True from choosing an episode until its stream arrives. */
  const [switching, setSwitching] = useState(false);
  /**
   * Ticks so the finish time keeps up while paused.
   *
   * Playing, `currentTime` moves and this recomputes with it. Paused, what is
   * left stops changing but the clock does not, so the finish time has to walk
   * forward on its own — otherwise it silently claims you will finish at a
   * time that passed twenty minutes ago.
   */
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((n) => n + 1), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const endsAt = useMemo(() => {
    const left = duration - currentTime;
    if (!Number.isFinite(left) || left <= 0 || duration <= 0) return "";
    void clockTick;
    return new Date(Date.now() + left * 1000).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }, [duration, currentTime, clockTick]);
  const seasons = useMemo(
    () =>
      [...new Set((episodes ?? []).map((item) => item.season ?? 0))].sort(
        (a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b),
      ),
    [episodes],
  );
  const [season, setSeason] = useState<number | undefined>();
  // Opens on the season being watched rather than at the beginning of the run.
  useEffect(() => {
    setSeason(video?.season ?? seasons[0]);
  }, [video?.season, seasons]);
  const seasonEpisodes = useMemo(
    () => (episodes ?? []).filter((item) => (item.season ?? 0) === season),
    [episodes, season],
  );
  const [audioTracks, setAudioTracks] = useState<AudioChoice[]>([]);
  const [selectedAudio, setSelectedAudio] = useState(-1);
  const url = stream.url;
  const externalUrl = stream.externalUrl || url;
  const navigableExternalUrl = useMemo(
    () => safeHttpUrl(externalUrl),
    [externalUrl],
  );
  const sourceText = `${stream.name} ${stream.title} ${stream.description} ${stream.behaviorHints?.filename ?? ""}`;
  const riskyAudio = useMemo(
    () => /truehd|dts(?:-hd)?|e-?ac-?3|dd\+|atmos|\.mkv\b/i.test(sourceText),
    [sourceText],
  );
  const videoFit =
    settings.resizeMode === "Stretch"
      ? "fill"
      : settings.resizeMode === "Fit"
        ? "contain"
        : "cover";
  const cueCss = useMemo(() => {
    const color = browserColor(settings.subtitleTextColor, "#fff");
    const background = browserColor(
      settings.subtitleBackgroundColor,
      "transparent",
    );
    const outline = browserColor(settings.subtitleOutlineColor, "#000");
    const width = clamp(settings.subtitleOutlineWidth, 0, 10);
    const shadow = settings.subtitleOutlineEnabled
      ? `${width}px 0 ${outline}, -${width}px 0 ${outline}, 0 ${width}px ${outline}, 0 -${width}px ${outline}`
      : "none";
    return `.player-view video::cue { color:${color}; background:${background}; font-size:${clamp(settings.subtitleFontSizeSp, 6, 40)}px; font-weight:${settings.subtitleBold ? 700 : 400}; text-shadow:${shadow}; }`;
  }, [settings]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    const running = engineRef.current
      ? !engineRef.current.paused
      : videoRef.current && !videoRef.current.paused;
    if (running)
      hideTimer.current = window.setTimeout(() => {
        setAudioOpen(false);
        setExternalPlayerOpen(false);
        setControlsVisible(false);
      }, 3000);
  }, []);
  const togglePlayback = useCallback(async () => {
    showControls();
    const engine = engineRef.current;
    if (engine) {
      // Reached from a real tap, which is what lets Safari start the audio
      // context at all.
      if (engine.paused) await engine.play();
      else engine.pause();
      setPlaying(!engine.paused);
      return;
    }
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) {
      try {
        await element.play();
        setError("");
      } catch {
        setStatus("Playback needs another tap or this codec is not supported.");
      }
    } else element.pause();
  }, [showControls]);
  const seekTo = useCallback(
    async (requested: number) => {
      const engine = engineRef.current;
      const element = videoRef.current;
      const total = engine ? engine.duration : element?.duration ?? 0;
      const maximum = Number.isFinite(total)
        ? Math.max(0, total - 0.05)
        : Math.max(0, requested);
      const target = clamp(requested, 0, maximum);
      seekPreviewRef.current = null;
      setSeekPreview(null);
      showControls();

      if (engine) {
        setCurrentTime(target);
        setWaiting(true);
        await engine.seek(target);
        return;
      }
      if (!element) return;
      // Shown straight away rather than waiting for the browser to admit it is
      // stalling, which it only does once the gap is already noticeable.
      setWaiting(true);

      element.currentTime = target;
      setCurrentTime(target);
    },
    [showControls, remuxActive],
  );
  const seekBy = useCallback(
    (amount: number) => {
      const from = engineRef.current?.currentTime ?? videoRef.current?.currentTime;
      if (from === undefined) return;
      void seekTo(from + amount);
    },
    [seekTo],
  );
  /**
   * Mute, wherever playback actually is.
   *
   * This went to the video element, which the decoding player never touches —
   * so the button did nothing on exactly the streams that need that player,
   * while dragging the slider to zero still worked because that goes through
   * setPlayerVolume.
   */
  const toggleMuted = useCallback(() => {
    const engine = engineRef.current;
    if (engine) {
      const next = !muted;
      engine.setMuted(next);
      setMuted(next);
      return;
    }
    const element = videoRef.current;
    if (element) element.muted = !element.muted;
  }, [muted]);
  const toggleFullscreen = useCallback(async () => {
    const container = playerRef.current;
    const element = videoRef.current as
      (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!container || !element) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (container.requestFullscreen) await container.requestFullscreen();
    else element.webkitEnterFullscreen?.();
  }, []);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !url) {
      setWaiting(false);
      setError("This source does not provide a direct browser video URL.");
      return;
    }
    let disposed = false;
    setSwitching(false);
    setNextDismissed(false);
    let audioWatch: number | undefined;
    let preferredAudioApplied = false;
    let preferredSubtitleApplied = false;
    const isHls = /\.m3u8(?:$|\?)/i.test(url);
    const fail = () => {
      setWaiting(false);
      setStatus("");
      setError(
        "The browser could not play this video or audio format. Try the external player option.",
      );
    };
    const normalizeLanguage = (value?: string) =>
      (value || "").trim().toLowerCase().split(/[-_]/)[0];
    const languageTargets = (
      primary: string,
      secondary: string,
      includeOriginal: boolean,
    ) => {
      const device = navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
      const requested: string[] =
        primary === "device"
          ? [...device]
          : primary === "original" && includeOriginal
            ? [meta.language || "", ...device]
            : [primary];
      if (secondary) requested.push(secondary);
      return requested.map(normalizeLanguage).filter(Boolean);
    };
    const preferredTrack = (
      tracks: Array<{ language?: string; label?: string }>,
      targets: string[],
    ) => {
      for (const target of targets) {
        const exact = tracks.findIndex(
          (track) => normalizeLanguage(track.language) === target,
        );
        if (exact >= 0) return exact;
        const labelled = tracks.findIndex((track) =>
          (track.label || "").toLowerCase().includes(target),
        );
        if (labelled >= 0) return labelled;
      }
      return -1;
    };
    const syncNativeAudio = () => {
      const list = (
        element as HTMLVideoElement & { audioTracks?: NativeAudioTrackList }
      ).audioTracks;
      if (!list?.length) return;
      const choices = Array.from({ length: list.length }, (_, index) => ({
        id: index,
        label:
          list[index].label || list[index].language || `Audio ${index + 1}`,
      }));
      setAudioTracks(choices);
      if (!preferredAudioApplied) {
        const preferred = preferredTrack(
          Array.from({ length: list.length }, (_, index) => list[index]),
          languageTargets(
            settings.preferredAudioLanguage,
            settings.secondaryPreferredAudioLanguage,
            true,
          ),
        );
        if (preferred >= 0) {
          for (let index = 0; index < list.length; index += 1)
            list[index].enabled = index === preferred;
        }
        preferredAudioApplied = true;
      }
      setSelectedAudio(
        choices.find((choice) => list[choice.id].enabled)?.id ?? 0,
      );
    };
    const syncNativeSubtitles = () => {
      const list = element.textTracks;
      if (!list.length || preferredSubtitleApplied) return;
      preferredSubtitleApplied = true;
      const preferred = settings.preferredSubtitleLanguage;
      const targets =
        preferred === "none"
          ? []
          : languageTargets(
              preferred,
              settings.secondaryPreferredSubtitleLanguage,
              false,
            );
      const selected = preferredTrack(
        Array.from({ length: list.length }, (_, index) => list[index]),
        targets,
      );
      for (let index = 0; index < list.length; index += 1)
        list[index].mode = index === selected ? "showing" : "disabled";
    };
    const applyCueOffset = () => {
      const offset = clamp(settings.subtitleBottomOffset, 0, 100);
      const height = element.clientHeight || 1;
      const line = 100 - (offset / height) * 100;
      for (let trackIndex = 0; trackIndex < element.textTracks.length; trackIndex += 1) {
        const cues = element.textTracks[trackIndex].cues;
        if (!cues) continue;
        for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
          const cue = cues[cueIndex] as TextTrackCue & {
            line?: number | "auto";
            snapToLines?: boolean;
          };
          if (typeof cue.line !== "undefined") {
            cue.snapToLines = false;
            cue.line = line;
          }
        }
      }
    };
    element.volume = clamp(Number.isFinite(volume) ? volume : 1, 0, 1);
    element.muted = muted;
    element.playsInline = true;
    const onPlaying = () => {
      setPlaying(true);
      setWaiting(false);
      setStatus("");
      showControls();
    };
    const onPause = () => {
      setPlaying(false);
      setControlsVisible(true);
      window.clearTimeout(hideTimer.current);
    };
    const onWaiting = () => {
      // No status text: the centre spinner already says this, and showing
      // both read as two separate loading indicators stacked on each other.
      setWaiting(true);
    };
    const onCanPlay = () => {
      setWaiting(false);
      setStatus("");
    };
    // Seek once, on the first metadata event: setting currentTime before the
    // duration is known is silently ignored, and re-seeking on every event
    // would fight the user. Remuxed playback restarts conversion from the
    // Matroska cue instead of downloading linearly from zero to the resume
    // point.
    let resumed = startPositionMs <= 0;
    const onResume = () => {
      if (resumed || !Number.isFinite(element.duration)) return;
      resumed = true;
      const target = startPositionMs / 1000;
      // Never seek past the end; a stale row from a different cut of the same
      // episode would otherwise drop playback at the credits.
      if (target >= element.duration - 5) return;
      element.currentTime = target;
    };
    element.addEventListener("loadedmetadata", onResume);
    element.addEventListener("canplay", onResume);
    const onTime = () => setCurrentTime(element.currentTime || 0);
    const onDuration = () => {
      setDuration(Number.isFinite(element.duration) ? element.duration : 0);
      syncNativeAudio();
      syncNativeSubtitles();
      applyCueOffset();
    };
    const onVolume = () => {
      setVolume(element.volume);
      setMuted(element.muted);
    };
    element.addEventListener("playing", onPlaying);
    element.addEventListener("pause", onPause);
    element.addEventListener("waiting", onWaiting);
    element.addEventListener("canplay", onCanPlay);
    element.addEventListener("timeupdate", onTime);
    element.addEventListener("durationchange", onDuration);
    element.addEventListener("loadedmetadata", onDuration);
    element.addEventListener("volumechange", onVolume);
    element.addEventListener("error", fail);

    const cleanup = () => {
      disposed = true;
      setRemuxActive(false);
      window.clearTimeout(hideTimer.current);
      element.removeEventListener("playing", onPlaying);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("waiting", onWaiting);
      element.removeEventListener("canplay", onCanPlay);
      element.removeEventListener("loadedmetadata", onResume);
      element.removeEventListener("canplay", onResume);
      element.removeEventListener("timeupdate", onTime);
      element.removeEventListener("durationchange", onDuration);
      element.removeEventListener("loadedmetadata", onDuration);
      element.removeEventListener("volumechange", onVolume);
      element.removeEventListener("error", fail);
      if (audioWatch !== undefined) window.clearInterval(audioWatch);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      element.pause();
      element.removeAttribute("src");
      element.load();
    };

    // Decode it ourselves rather than asking the browser to accept the file.
    // Media Source refuses these streams for reasons unrelated to whether the
    // machine can decode them, so the container is skipped entirely: frames go
    // to a canvas and audio to Web Audio.
    const verdict = assessPlayback(url, sourceText);
    if (shouldUseRemuxFallback(url, sourceText)) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      setRemuxActive(true);
      setDecoding(true);
      const engine = new MediabunnyPlayer(
        url,
        canvas,
        (next) => {
          if (disposed) return;
          if (next.state === "error") {
            setWaiting(false);
            setStatus("");
            setError(next.message);
          } else if (next.state === "ready" || next.state === "ended") {
            setWaiting(false);
            setStatus("");
            if (next.state === "ended") setPlaying(false);
          } else {
            setWaiting(true);
            setStatus(next.message);
          }
        },
        {
          requestHeaders: stream.behaviorHints?.proxyHeaders?.request,
          startPositionSeconds: startPositionMs / 1000,
          // A file's first audio track is not its main one. Without this a
          // release that happens to list French first plays French.
          preferredLanguages: languageTargets(
            settings.preferredAudioLanguage,
            settings.secondaryPreferredAudioLanguage,
            true,
          ),
          onAudioTracks: (tracks, selected) => {
            if (disposed) return;
            setAudioTracks(tracks);
            setSelectedAudio(selected);
          },
          onTime: (position, total) => {
            if (disposed) return;
            setCurrentTime(position);
            if (total) setDuration(total);
          },
          onEnded: () => {
            if (!disposed) setPlaying(false);
          },
        },
      );
      engineRef.current = engine;
      engine.setVolume(volume);
      engine.setMuted(muted);
      void engine
        .start()
        .then(() => {
          if (disposed) return;
          // Autoplay without a gesture is refused on iOS and increasingly
          // elsewhere; the centre button is then the gesture.
          void engine.play().then(() => setPlaying(!engine.paused));
        })
        .catch((reason: unknown) => {
          if (disposed) return;
          setWaiting(false);
          setError(
            reason instanceof Error
              ? reason.message
              : "This source could not be read.",
          );
        });
      return () => {
        disposed = true;
        engineRef.current = null;
        engine.stop();
      };
    }
    if (!verdict.playable) {
      setError(verdict.reason);
      setWaiting(false);
      return cleanup;
    }

    // Chromium reports no error for an audio codec it cannot decode; it just
    // plays silence. Sample the decoded-byte counters once playback is under
    // way and say so plainly.
    audioWatch = window.setInterval(() => {
      if (element.paused || element.currentTime < 1.5) return;
      if (audioIsSilent(element)) {
        setWarning(
          verdict.reason ||
            "No audio track could be decoded by this browser. Try an external player.",
        );
        window.clearInterval(audioWatch);
      }
    }, 1200);
    if (isHls && element.canPlayType("application/vnd.apple.mpegurl")) {
      element.src = url;
      element.load();
      element.play().catch(() => setStatus("Tap play to start"));
    } else if (isHls) {
      import("hls.js")
        .then(({ default: HlsClass }) => {
          if (disposed) return;
          if (!HlsClass.isSupported()) {
            fail();
            return;
          }
          const hls = new HlsClass({
            enableWorker: true,
            lowLatencyMode: false,
          });
          hlsRef.current = hls;
          hls.loadSource(url);
          hls.attachMedia(element);
          const syncTracks = () => {
            const tracks = hls.audioTracks.map((track, index) => ({
              id: index,
              label: track.name || track.lang || `Audio ${index + 1}`,
            }));
            setAudioTracks(tracks);
            if (!preferredAudioApplied) {
              const preferred = preferredTrack(
                hls.audioTracks.map((track) => ({
                  language: track.lang,
                  label: track.name,
                })),
                languageTargets(
                  settings.preferredAudioLanguage,
                  settings.secondaryPreferredAudioLanguage,
                  true,
                ),
              );
              if (preferred >= 0) hls.audioTrack = preferred;
              preferredAudioApplied = true;
            }
            setSelectedAudio(hls.audioTrack);
          };
          hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
            syncTracks();
            element.play().catch(() => setStatus("Tap play to start"));
          });
          hls.on(HlsClass.Events.AUDIO_TRACKS_UPDATED, syncTracks);
          hls.on(HlsClass.Events.AUDIO_TRACK_SWITCHED, (_, data) =>
            setSelectedAudio(data.id),
          );
          hls.on(HlsClass.Events.ERROR, (_, data) => {
            if (data.fatal) fail();
          });
        })
        .catch(fail);
    } else {
      element.src = url;
      element.load();
      element.play().catch(() => setStatus("Tap play to start"));
    }
    return cleanup;
    // Volume is initialized once per source; UI changes update the element directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, showControls, settings, meta.language]);

  useEffect(() => {
    localStorage.setItem("nuvio-web-volume", String(volume));
    localStorage.setItem("nuvio-web-muted", String(muted));
  }, [volume, muted]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        ["INPUT", "SELECT", "TEXTAREA"].includes(
          (event.target as HTMLElement)?.tagName,
        )
      )
        return;
      if (event.key === " " || event.key.toLowerCase() === "k") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "ArrowLeft") seekBy(-10);
      else if (event.key === "ArrowRight") seekBy(10);
      else if (event.key.toLowerCase() === "m") toggleMuted();
      else if (event.key.toLowerCase() === "f") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seekBy, toggleFullscreen, togglePlayback, toggleMuted]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    // Read from whichever is playing. The decoding player never touches the
    // video element, so reading the element reported a position of zero and
    // nothing was ever saved for the streams that need it most.
    const report = (ended: boolean) => {
      const engine = engineRef.current;
      const position = (engine ? engine.currentTime : element.currentTime) * 1000;
      const total = engine
        ? engine.duration * 1000
        : Number.isFinite(element.duration)
          ? element.duration * 1000
          : 0;
      if (position > 0 || ended) reportRef.current(position, total, ended);
    };
    // Every 15s while playing, plus the moments a position actually matters.
    const timer = window.setInterval(() => {
      const running = engineRef.current
        ? !engineRef.current.paused
        : !element.paused;
      if (running) report(false);
    }, 15_000);
    const onPause = () => report(false);
    const onEnded = () => report(true);
    // `pagehide` rather than `unload`: iOS never fires unload for a PWA being
    // backgrounded, so the last position would be lost every time.
    const onHide = () => report(element.ended);
    element.addEventListener("pause", onPause);
    element.addEventListener("ended", onEnded);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(timer);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("ended", onEnded);
      window.removeEventListener("pagehide", onHide);
      // Closing the player is the most important report of all.
      report(engineRef.current ? false : element.ended);
    };
  }, []);

  const selectAudio = (id: number) => {
    if (engineRef.current) {
      void engineRef.current.selectAudioTrack(id);
      setSelectedAudio(id);
      setAudioOpen(false);
      return;
    }
    if (hlsRef.current) hlsRef.current.audioTrack = id;
    else {
      const list = (
        videoRef.current as
          (HTMLVideoElement & { audioTracks?: NativeAudioTrackList }) | null
      )?.audioTracks;
      if (list)
        for (let index = 0; index < list.length; index += 1)
          list[index].enabled = index === id;
    }
    setSelectedAudio(id);
    setAudioOpen(false);
  };
  const openExternalPlayer = (mode: ExternalPlayerMode) => {
    if (!externalUrl) return;
    setExternalPlayerOpen(false);
    // Paused first: the handoff unmounts this player, and a video element torn
    // down mid-play can leave the remuxer fetching for a moment after.
    const element = videoRef.current;
    element?.pause();
    // Where it got to here, so the other player picks up mid-scene rather than
    // at the last saved checkpoint.
    onExternalPlay(mode, externalUrl, Math.max(0, (element?.currentTime ?? 0) * 1000));
  };
  const setPlayerVolume = (next: number) => {
    if (engineRef.current) {
      engineRef.current.setVolume(next);
      engineRef.current.setMuted(next === 0);
      setVolume(next);
      setMuted(next === 0);
      return;
    }
    const element = videoRef.current;
    if (!element) return;
    element.volume = next;
    element.muted = next === 0;
  };
  useEffect(() => {
    let live = true;
    setSkipSegments([]);
    void loadSkipSegments(meta.id, video?.season, video?.episode).then(
      (segments) => {
        if (live) setSkipSegments(segments);
      },
    );
    return () => {
      live = false;
    };
  }, [meta.id, video?.season, video?.episode]);
  const skippable = activeSkipSegment(skipSegments, currentTime);

  const nextEpisode = useMemo(() => {
    if (!episodes?.length || !onPlayEpisode) return null;
    const candidate = resolveNextEpisode(
      episodes,
      video?.season,
      video?.episode,
    );
    // An addon lists a whole season including episodes that do not exist yet.
    return candidate && hasEpisodeAired(candidate.released) ? candidate : null;
  }, [episodes, onPlayEpisode, video?.season, video?.episode]);
  /**
   * Hands an episode to the app to resolve a source for.
   *
   * Stopped, and said to be stopping, before the resolve starts: it takes
   * seconds, and in silence the episode you just left simply carried on.
   */
  const startEpisode = useCallback(
    (next: Video) => {
      if (switching || next.id === video?.id) return;
      engineRef.current?.pause();
      videoRef.current?.pause();
      setPlaying(false);
      setWaiting(true);
      setStatus("Loading episode…");
      setSwitching(true);
      setEpisodesOpen(false);
      onPlayEpisode?.(next);
    },
    [onPlayEpisode, switching, video?.id],
  );
  const showNextEpisode =
    !!nextEpisode &&
    !nextDismissed &&
    !error &&
    shouldShowNextEpisode(
      currentTime * 1000,
      duration * 1000,
      undefined,
      creditsStart(skipSegments),
    );

  const seekLimit = duration || 0;
  const displayedTime = seekPreview ?? currentTime;
  const commitSeekPreview = (fallback: number) => {
    const target = seekPreviewRef.current ?? fallback;
    if (seekPreviewRef.current === null) return;
    seekPreviewRef.current = null;
    void seekTo(target);
  };

  return (
    <div
      ref={playerRef}
      className={`player-view ${controlsVisible || error ? "controls-visible" : "controls-hidden"}`}
      onPointerMove={showControls}
      onPointerDown={showControls}
    >
      <style>{cueCss}</style>
      <video
        ref={videoRef}
        playsInline
        autoPlay
        preload="auto"
        poster={video?.thumbnail || meta.background}
        style={{ objectFit: videoFit, display: decoding ? "none" : undefined }}
        onDoubleClick={toggleFullscreen}
      />
      {/* Where the decoder draws. Object-fit matches the video element so the
          two look the same whichever is playing. */}
      <canvas
        ref={canvasRef}
        className="player-canvas"
        style={{ objectFit: videoFit, display: decoding ? undefined : "none" }}
        onDoubleClick={toggleFullscreen}
      />
      <div className="player-shade player-shade-top" />
      <div className="player-shade player-shade-bottom" />
      <div className="player-top">
        <button className="circle-button" aria-label="Back" onClick={onClose}>
          <ArrowLeft />
        </button>
        <div>
          <small>
            {video?.season
              ? `Season ${video.season} · Episode ${video.episode}`
              : meta.type}
            {settings.showParentalGuide && meta.ageRating
              ? ` · ${meta.ageRating}`
              : ""}
          </small>
          <strong>{video?.title || meta.name}</strong>
        </div>
        {endsAt && (
          <span className="player-ends-at" title="Estimated finish time">
            Ends at {endsAt}
          </span>
        )}
      </div>
      {!error && waiting && settings.showLoadingOverlay && (
        <div className="player-center player-center-busy" aria-label="Loading">
          <LoaderCircle className="spin" />
        </div>
      )}
      {!error && !waiting && !playing && (
        <button className="player-center" aria-label="Play" onClick={togglePlayback}>
          <Play />
        </button>
      )}
      {status && !waiting && !error && (
        <div className="player-status">{status}</div>
      )}
      {warning && !error && (
        <div className="player-warning" role="status">
          <span>{warning}</span>
          {externalUrl && (
            <button
              className="warning-action"
              onClick={() => copyStreamUrl(externalUrl)}
            >
              <Copy size={15} /> Copy stream URL
            </button>
          )}
          <button
            className="notice-dismiss"
            aria-label="Dismiss"
            onClick={() => setWarning("")}
          >
            <X size={18} />
          </button>
        </div>
      )}
      <div className="player-controls">
        <div className="player-timeline">
          <span>{formatTime(displayedTime)}</span>
          <input
            aria-label="Seek"
            type="range"
            min="0"
            max={seekLimit}
            step="0.1"
            value={Math.min(displayedTime, seekLimit)}
            onChange={(event) => {
              const target = Number(event.target.value);
              seekPreviewRef.current = target;
              setSeekPreview(target);
            }}
            onPointerUp={(event) =>
              commitSeekPreview(Number(event.currentTarget.value))
            }
            onKeyUp={(event) => {
              if (
                event.key.startsWith("Arrow") ||
                event.key === "Home" ||
                event.key === "End"
              )
                commitSeekPreview(Number(event.currentTarget.value));
            }}
            onBlur={(event) => {
              commitSeekPreview(Number(event.currentTarget.value));
            }}
            style={
              {
                "--played": `${seekLimit ? (displayedTime / seekLimit) * 100 : 0}%`,
              } as CSSProperties
            }
          />
          <span>{formatTime(duration)}</span>
        </div>
        <div className="player-control-row">
          <div className="player-control-group">
            <button
              className="player-play"
              aria-label={playing ? "Pause" : "Play"}
              onClick={togglePlayback}
            >
              {playing ? <Pause /> : <Play />}
            </button>
            {/* Only where there is one to go to — a film, or the last episode
                of a season, would leave a button that does nothing. */}
            {nextEpisode && (
              <button
                aria-label={
                  nextEpisode.season != null && nextEpisode.episode != null
                    ? `Next episode: S${nextEpisode.season} E${nextEpisode.episode}`
                    : "Next episode"
                }
                disabled={switching}
                onClick={() => startEpisode(nextEpisode)}
              >
                <SkipForward />
              </button>
            )}
          </div>
          <div className="player-control-group player-control-right">
            <button
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => toggleMuted()}
            >
              {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
            </button>
            <input
              className="volume-slider"
              aria-label="Volume"
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={muted ? 0 : volume}
              onChange={(event) => setPlayerVolume(Number(event.target.value))}
              style={
                {
                  "--played": `${muted ? 0 : volume * 100}%`,
                } as CSSProperties
              }
            />
            <div className="audio-picker">
              <button
                className={audioOpen ? "active" : ""}
                aria-expanded={audioOpen}
                onClick={() => {
                  setExternalPlayerOpen(false);
                  setAudioOpen((value) => !value);
                }}
              >
                <Music2 />
              </button>
              {audioOpen && (
                <div className="audio-menu">
                  <strong>Audio track</strong>
                  {audioTracks.length ? (
                    audioTracks.map((track) => (
                      <button
                        key={track.id}
                        className={selectedAudio === track.id ? "selected" : ""}
                        onClick={() => selectAudio(track.id)}
                      >
                        {track.label}
                      </button>
                    ))
                  ) : (
                    <p>The browser reports only the default track.</p>
                  )}
                  {riskyAudio && (
                    <small>
                      This source advertises an audio/container format that
                      browsers may not decode. Use an external player if it
                      stays silent.
                    </small>
                  )}
                  {navigableExternalUrl && (
                    <a href={navigableExternalUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink /> Open externally
                    </a>
                  )}
                </div>
              )}
            </div>
            {externalUrl && (
              <div className="external-player-picker">
                <button
                  className={externalPlayerOpen ? "active" : ""}
                  aria-label="Open in external player"
                  aria-expanded={externalPlayerOpen}
                  onClick={() => {
                    setAudioOpen(false);
                    setExternalPlayerOpen((value) => !value);
                  }}
                >
                  <ExternalLink />
                </button>
                {externalPlayerOpen && (
                  <div className="external-player-menu">
                    <strong>Open with</strong>
                    {externalPlayerOptions("player").map((option) => (
                      <button
                        key={option.mode}
                        onClick={() => openExternalPlayer(option.mode)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!!episodes?.length && onPlayEpisode && (
              <button
                aria-label="Episodes"
                className={episodesOpen ? "active" : ""}
                aria-expanded={episodesOpen}
                onClick={() => {
                  setAudioOpen(false);
                  setExternalPlayerOpen(false);
                  setEpisodesOpen((value) => !value);
                }}
              >
                <List />
              </button>
            )}
            <button aria-label="Fullscreen" onClick={toggleFullscreen}>
              <Maximize />
            </button>
          </div>
        </div>
      </div>
      {skippable && !error && (
        <button
          className="player-skip"
          onClick={() => {
            showControls();
            void seekTo(skippable.end);
          }}
        >
          <FastForward /> {skipLabel(skippable.kind)}
        </button>
      )}
      {showNextEpisode && nextEpisode && (
        <div className="player-next">
          <div>
            <small>Up next</small>
            <strong>
              {nextEpisode.season != null && nextEpisode.episode != null
                ? `S${nextEpisode.season}·E${nextEpisode.episode} `
                : ""}
              {nextEpisode.title || "Next episode"}
            </strong>
          </div>
          <button onClick={() => setNextDismissed(true)}>Not now</button>
          <button
            className="primary"
            disabled={switching}
            onClick={() => startEpisode(nextEpisode)}
          >
            <SkipForward /> Play
          </button>
        </div>
      )}
      {episodesOpen && !!episodes?.length && (
        <div
          className="player-episodes-scrim"
          onClick={() => setEpisodesOpen(false)}
        >
          {/* The detail page's own list, not a second one built to look like
              it: same rows, same watched eye, same resume bar, and the same
              season picker rather than every season run together with the
              specials among them. */}
          <aside
            className="player-episodes"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">EPISODES</span>
                <strong>{meta.name}</strong>
              </div>
              <button
                className="circle-button"
                aria-label="Close"
                onClick={() => setEpisodesOpen(false)}
              >
                <X />
              </button>
            </header>
            <label className="season-select-wrap">
              <span>SEASON</span>
              <select
                value={season ?? ""}
                onChange={(event) => setSeason(Number(event.target.value))}
              >
                {seasons.map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? "Specials" : `Season ${value}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="episode-list-heading">
              <strong>
                {season === 0 ? "Specials" : `Season ${season ?? seasons[0] ?? 1}`}
              </strong>
              <span>
                {seasonEpisodes.length}{" "}
                {seasonEpisodes.length === 1 ? "episode" : "episodes"}
              </span>
            </div>
            <div className="player-episode-list episode-list is-detailed">
              {seasonEpisodes.map((item) => {
                const key = watchKey(meta.id, item.season, item.episode);
                return (
                  <EpisodeRow
                    key={item.id}
                    video={item}
                    watched={watchIndex?.watched.has(key) ?? false}
                    percent={watchIndex ? episodePercent(watchIndex, key) : 0}
                    remaining={watchIndex ? remainingShort(watchIndex, key) : ""}
                    blurred={false}
                    onPlay={() => startEpisode(item)}
                    onMenu={() => undefined}
                  />
                );
              })}
            </div>
          </aside>
        </div>
      )}
      {error && (
        <div className="player-error">
          <strong>Browser playback unavailable</strong>
          {/* The message is the diagnosis, and it is long. Tapping it copies
              it so it can be pasted somewhere useful rather than retyped from
              a phone screen. */}
          <p
            className="player-error-message"
            role="button"
            tabIndex={0}
            title="Tap to copy this message"
            onClick={() => {
              void navigator.clipboard.writeText(error);
              setErrorCopied(true);
              window.setTimeout(() => setErrorCopied(false), 1600);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              void navigator.clipboard.writeText(error);
              setErrorCopied(true);
              window.setTimeout(() => setErrorCopied(false), 1600);
            }}
          >
            {error}
          </p>
          <small className="player-error-hint">
            {errorCopied ? "Copied" : "Tap the message to copy it"}
          </small>
          {/* What can play it, offered where it failed. Being told the
              browser cannot decode something is only half an answer; the other
              half is the list of things that can. */}
          {externalUrl && !!externalPlayerOptions("player").length && (
            <div className="player-error-players">
              <small>Play it in</small>
              <div>
                {externalPlayerOptions("player").map((option) => (
                  <button
                    key={option.mode}
                    onClick={() => openExternalPlayer(option.mode)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            {externalUrl && (
              <>
                {navigableExternalUrl && (
                  <a href={navigableExternalUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink /> Open stream
                  </a>
                )}
                <button
                  onClick={() => navigator.clipboard.writeText(externalUrl)}
                >
                  <Copy /> Copy URL
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
