import type Hls from "hls.js";
import { Select } from "./Select";
import {
  ClosedCaptionIcon,
  HdIcon,
  SolidPause,
  SolidPlay,
  SourceSwapIcon,
} from "./PlaybackIcons";
import { automaticSkipSegment, nextEpisodeDue, shouldBlurEpisode } from "../lib/playbackPolicy";
import { nativePlayerPreferences } from "../lib/nativePlayerPreferences";
import { startNativePlaybackSession } from "../lib/nativePlaybackSession";
import { coverNativePlayerSurface, revealNativePlayerSurface } from "../lib/nativePlayerSurface";
import { platform } from "../platform/index.ts";
import { t } from "../lib/i18n.ts";
import { canPlayInApp } from "../lib/externalPlayer";
import { languageName } from "../lib/languageName.ts";
import { loadSubtitles } from "../lib/addons.ts";
import {
  activeBrowserSubtitleText,
  chooseBrowserSubtitle,
  isForcedSubtitle,
  parseBrowserSubtitles,
  type BrowserSubtitleCue,
} from "../lib/subtitles.ts";
import type { ResizeMode, PlayerState } from "../platform/types.ts";
import { safeHttpUrl } from "../lib/security";
import {
  mediaRectForResizeMode,
  objectFitForResizeMode,
  visibleResizeMode,
} from "../lib/pictureMode";
import {
  assessPlayback,
  audioIsSilent,
  isAppleWebKit,
  shouldUseRemuxFallback,
} from "../lib/playback";
import { MediabunnyPlayer } from "../lib/mediabunnyPlayer";
import { NativeMkvPlayer } from "../lib/nativeMkvPlayer";
import {
  browserColor,
  type StreamBadgeSettings,
  type WebPlayerSettings,
} from "../lib/webSettings";
import {
  ArrowLeft,
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Info,
  ExternalLink,
  FastForward,
  Gauge,
  ListMusic,
  ListVideo,
  LoaderCircle,
  Maximize,
  Minus,
  Play,
  Plus,
  Settings,
  SkipForward,
  SlidersHorizontal,
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
} from "../lib/nextEpisode";
import {
  episodePercent,
  remainingShort,
  watchKey,
  type WatchIndex,
} from "../lib/progress";
import { EpisodeRow, SourceBadges } from "./Details";
import {
  loadEpisodeRatings,
  type EpisodeRatings,
} from "../lib/episodeRatings";
import {
  tmdbIdForMeta,
  type MetadataEnrichmentConfig,
} from "../lib/metadataEnrichment";
import {
  activeSkipSegment,
  loadSkipSegments,
  parseNativeSkipSegments,
  skipLabel,
  type SkipSegment,
} from "../lib/skipSegments";
import type {
  ExternalPlayerMode,
  InstalledAddon,
  Meta,
  Stream,
  Subtitle,
  Video,
} from "../types";

// Present only in the desktop shell. Keeping this capability check here makes
// the player chrome shared while the bytes still take the right route: a web
// page decodes in <video>/canvas, and Tauri hands the same source to libmpv.
const nativePlayer = platform.player;

/** Cycled in this order by the player's picture-mode control. */
/**
 * lucide's `square-dimensions`, drawn here rather than imported.
 *
 * It postdates the pinned lucide-react, and pulling the whole icon set forward
 * for one glyph would restyle every other icon in the app. Traced from the
 * upstream source at the same 24px grid and stroke, so it sits with its
 * neighbours.
 */
function PictureModeGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M12 7H7v5" />
      <path d="M12 17h5v-5" />
    </svg>
  );
}

const AUDIO_ECHO_MS = 900;

/**
 * The modes the player's own control cycles.
 *
 * Three, not the settings screen's four: mpv maps Fill and Zoom to the same
 * keepaspect/panscan pair, so cycling both would present a step that changes
 * the label and nothing on screen.
 */
const RESIZE_MODES: ResizeMode[] = ["Fit", "Zoom", "Stretch"];
const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

function formatPlaybackRate(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0$/, "")}×`;
}

function storedPlaybackRate() {
  const value = Number(localStorage.getItem("nuvio-web-playback-rate") ?? 1);
  return Number.isFinite(value) ? clamp(value, 0.25, 2) : 1;
}

/** How long the picture-mode name stays up after a change. */
const PICTURE_NOTE_MS = 5000;

type AudioChoice = { id: number; label: string; lang?: string };
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

/**
 * The players this stream can be handed off to.
 *
 * "Open with" means another application. The native player is this one — it
 * plays here, through the browser's own video element — so it belongs in the
 * "Play in" list where a source is chosen, and not in a menu whose whole
 * meaning is leaving.
 */
function handoffOptions() {
  return platform.externalPlayer
    .options("player")
    .filter((option) => option.mode !== "native");
}

/**
 * What makes two entries the same release.
 *
 * The list the picker shows is fetched separately from the one the stream was
 * chosen out of, so they are never the same objects. The link is what actually
 * identifies a file; an addon that hands back a magnet or a debrid job rather
 * than a URL is matched on what it called it instead.
 */
function sourceKey(item: Stream) {
  return (
    item.url ||
    item.externalUrl ||
    item.infoHash ||
    `${item.addonName}:${item.title || item.name}`
  );
}

/** The parts of a caption's appearance the player can change while it plays. */
export type SubtitleStylePatch = Partial<
  Pick<
    WebPlayerSettings,
    | "subtitleFontSizeSp"
    | "subtitleBottomOffset"
    | "subtitleTextColor"
    | "subtitleBackgroundColor"
    | "subtitleOutlineColor"
    | "subtitleOutlineEnabled"
    | "subtitleOutlineWidth"
    | "subtitleBold"
  >
>;

/**
 * Colours offered for caption text and its background, as Android ARGB — the
 * shape these are stored in, and the shape every other Nuvio client reads.
 *
 * A short list on purpose: this is a menu over a running film, and a colour
 * wheel there is a worse answer than eight colours that are all legible.
 */
const CAPTION_COLORS: Array<{ name: string; value: string }> = [
  { name: "White", value: "#FFFFFFFF" },
  { name: "Yellow", value: "#FFFFEB3B" },
  { name: "Cyan", value: "#FF4DD0E1" },
  { name: "Green", value: "#FF81C784" },
  { name: "Orange", value: "#FFFFB74D" },
  { name: "Pink", value: "#FFF06292" },
  { name: "Grey", value: "#FFBDBDBD" },
  { name: "Black", value: "#FF000000" },
];

/** Backgrounds behind the text, transparent first because it is the default. */
const CAPTION_BACKGROUNDS: Array<{ name: string; value: string }> = [
  { name: "None", value: "#00000000" },
  { name: "Dim", value: "#66000000" },
  { name: "Black", value: "#CC000000" },
  { name: "Solid", value: "#FF000000" },
  { name: "White", value: "#CCFFFFFF" },
];

/** What the steppers will go to; the same bounds the settings page enforces. */
const CAPTION_SIZE_MIN = 6;
const CAPTION_SIZE_MAX = 40;
const CAPTION_OFFSET_MAX = 100;

/**
 * Whether a stored colour is the swatch that was offered.
 *
 * Compared through the CSS form rather than the stored text: the same colour
 * arrives written as `#FFFFFFFF` from one client and `#ffffffff` from another,
 * and a swatch that never looks selected reads as one that does not work.
 */
function sameColor(stored: string, option: string) {
  return (
    browserColor(stored, "").toLowerCase() ===
    browserColor(option, "").toLowerCase()
  );
}

/** The release name an addon put on a source, as the sheet shows it. */
function sourceLabel(item: Stream) {
  return (
    item.title ||
    item.description ||
    item.behaviorHints?.filename ||
    item.name ||
    item.addonName
  );
}

export type PlayerProps = {
  stream: Stream;
  meta: Meta;
  video?: Video;
  /** Subtitle providers are queried only by the browser player. */
  addons?: InstalledAddon[];
  onClose(): void;
  onExternalPlay(
    mode: ExternalPlayerMode,
    url: string,
    positionMs: number,
  ): void;
  startPositionMs?: number;
  episodes?: Video[];
  blurUnwatchedEpisodes?: boolean;
  /** The same choice the detail page's list obeys. */
  episodeCardStyle?: "horizontal" | "list";
  /** Resolves the show's TMDB id, which is what the ratings service is keyed by. */
  tmdbConfig?: MetadataEnrichmentConfig["tmdb"];
  /** Other releases of what is playing, once something has gone and asked. */
  sources?: Stream[];
  /** So the picker's rows carry the badges the sources sheet gives them. */
  streamBadgeSettings?: StreamBadgeSettings;
  /**
   * Changes how captions look, from the player rather than from Settings.
   *
   * The same stored values either way, so what is set here over the picture is
   * what Settings shows afterwards — and on the web it lands immediately,
   * since the cue stylesheet is built from them.
   */
  onSubtitleStyle?(patch: SubtitleStylePatch): void;
  sourcesBusy?: boolean;
  /** Asked for when the picker is first opened, not before. */
  onRequestSources?(): void;
  /** @param positionMs where playback is now, so the swap resumes there. */
  onSelectSource?(next: Stream, positionMs: number): void;
  animeSkipClientId?: string;
  watchIndex?: WatchIndex;
  mode?: ExternalPlayerMode;
  onPlayEpisode?(next: Video): void;
  onProgress(positionMs: number, durationMs: number, ended: boolean): void;
  onNativeProgressSnapshot?(
    positionMs: number,
    durationMs: number,
    ended: boolean,
  ): void;
  settings: WebPlayerSettings;
};


/** How long the controls and cursor stay up after the last movement while playing. */
const CONTROLS_HIDE_MS = 2000;

export function Player({
  stream,
  meta,
  video,
  addons = [],
  onClose,
  onExternalPlay,
  onProgress,
  onNativeProgressSnapshot,
  settings,
  startPositionMs = 0,
  episodes,
  watchIndex,
  onPlayEpisode,
  blurUnwatchedEpisodes = false,
  episodeCardStyle = "horizontal",
  tmdbConfig,
  sources,
  streamBadgeSettings,
  onSubtitleStyle,
  sourcesBusy = false,
  onRequestSources,
  onSelectSource,
  animeSkipClientId = "",
  mode,
}: PlayerProps) {
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
  const surfaceClickTimer = useRef<number | undefined>(undefined);
  const surfaceMenuDismissedAt = useRef(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  /** Non-fatal: it is playing, but something about it is worth saying. */
  const [notice, setNotice] = useState("");
  /**
   * Set when an automatic native attempt could not read the file.
   *
   * Only for the automatic case. Choosing the native player explicitly and
   * having it fail is worth an error — that is the answer to what was asked.
   * Being sent there by this player and finding the host will not serve it is
   * not: before this routing existed, iOS played these files through the
   * canvas with no sound, and a silent picture beats a dead screen.
   */
  const [nativeRefused, setNativeRefused] = useState(false);

  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  playingRef.current = playing;
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
  /** Read by callbacks that must not be rebuilt on every tick of the clock. */
  const currentTimeRef = useRef(0);
  currentTimeRef.current = currentTime;
  /** The source whose resume point has already been honoured. */
  const resumedFor = useRef<string | undefined>(undefined);
  const [duration, setDuration] = useState(0);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const seekPreviewRef = useRef<number | null>(null);
  const [seekThumbnail, setSeekThumbnail] = useState<{
    image: string;
    time: number;
    left: number;
  } | null>(null);
  const thumbnailRequestRef = useRef(0);
  const thumbnailBucketRef = useRef(-1);
  // libmpv accepts a seek on its command channel before its sampled position
  // catches up.  Keep the requested position authoritative during that short
  // window so polling cannot make the timeline jump target -> old -> target.
  const pendingNativeSeekRef = useRef<{
    targetSeconds: number;
    submittedAt: number;
  } | null>(null);
  const nativeProgressSnapshotRef = useRef({
    positionMs: 0,
    durationMs: 0,
    ended: false,
  });
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
  const [playbackRate, setPlaybackRate] = useState(storedPlaybackRate);
  const [stableVolume, setStableVolume] = useState(
    () => localStorage.getItem("nuvio-web-stable-volume") === "true",
  );
  const [hdrEnabled, setHdrEnabled] = useState(
    () => localStorage.getItem("nuvio-web-hdr-enabled") !== "false",
  );
  const hdrControlSupported = useMemo(
    () =>
      typeof CSS !== "undefined" &&
      CSS.supports("dynamic-range-limit", "standard"),
    [],
  );
  const [controlsVisible, setControlsVisible] = useState(true);
  /**
   * One menu behind one cog, rather than a button per setting along the bar.
   *
   * `null` is closed. Everything else is which page of it is showing: a list
   * of settings, or the one a settings row opened. The pages share a panel and
   * replace each other in it, so a track list is read where the setting that
   * asked for it was, and the way back is the heading above it.
   */
  const [settingsPage, setSettingsPage] = useState<
    null | "root" | "captions" | "captionVersions" | "audio" | "speed" | "captionStyle"
  >(null);
  const [subtitleGroupKey, setSubtitleGroupKey] = useState<string | null>(null);
  /**
   * How long polled audio state is disregarded after a local change.
   *
   * Long enough for the bridge round trip and mpv to act, short enough that a
   * change made elsewhere still shows up promptly.
   */
  const audioEchoUntil = useRef(0);
  const [subtitleTracks, setSubtitleTracks] = useState<
    Array<{ id: number; lang: string; label: string }>
  >([]);
  const [addonSubtitles, setAddonSubtitles] = useState<Subtitle[]>([]);
  const [browserSubtitleCues, setBrowserSubtitleCues] = useState<
    BrowserSubtitleCue[]
  >([]);
  const [subtitleIndexBusy, setSubtitleIndexBusy] = useState(false);
  const [subtitleFileBusy, setSubtitleFileBusy] = useState(false);
  const subtitleFileGeneration = useRef(0);
  /** mpv's own convention: -1, or "no", means subtitles are off. */
  const [selectedSubtitle, setSelectedSubtitle] = useState(-1);
  const [externalPlayerOpen, setExternalPlayerOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [episodesOpen, setEpisodesOpen] = useState(false);

  useEffect(() => {
    if (nativePlayer) return;
    const controller = new AbortController();
    const subtitleId = video?.id || meta.id;
    subtitleFileGeneration.current += 1;
    setAddonSubtitles([]);
    setBrowserSubtitleCues([]);
    setSelectedSubtitle(-1);
    setSubtitleIndexBusy(true);
    void loadSubtitles(meta.type, subtitleId, addons, controller.signal)
      .then((tracks) => {
        if (!controller.signal.aborted) setAddonSubtitles(tracks);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSubtitleIndexBusy(false);
      });
    return () => controller.abort();
  }, [addons, meta.id, meta.type, video?.id]);
  /** Dismissed by hand, so it does not come back for the rest of the episode. */
  const [nextDismissed, setNextDismissed] = useState(false);
  const [skipSegments, setSkipSegments] = useState<SkipSegment[]>([]);
  const autoSkipped = useRef(new Set<string>());
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  const autoNextTriggered = useRef(false);
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
    const left =
      (duration - currentTime) / (nativePlayer ? 1 : playbackRate);
    if (!Number.isFinite(left) || left <= 0 || duration <= 0) return "";
    void clockTick;
    return new Date(Date.now() + left * 1000).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }, [duration, currentTime, playbackRate, clockTick]);
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
  /**
   * IMDb's per-episode scores, so this list reads as the detail page's list
   * rather than the same rows with their badges missing.
   *
   * Asked for when the panel is first opened rather than when playback starts:
   * the service is only worth a request if the list is actually looked at, and
   * the lookup shares the detail page's cache — arriving here from a show that
   * has already drawn them costs nothing.
   */
  const [episodeRatings, setEpisodeRatings] = useState<EpisodeRatings>(
    () => new Map(),
  );
  useEffect(() => {
    if (!episodesOpen || meta.type !== "series" || !tmdbConfig) return;
    let live = true;
    void tmdbIdForMeta(meta, tmdbConfig)
      .then((tmdbId) => (tmdbId ? loadEpisodeRatings(tmdbId) : new Map()))
      .then((ratings) => {
        if (live) setEpisodeRatings(ratings as EpisodeRatings);
      });
    return () => {
      live = false;
    };
  }, [episodesOpen, meta, meta.id, meta.type, tmdbConfig]);
  const [audioTracks, setAudioTracks] = useState<AudioChoice[]>([]);
  const [selectedAudio, setSelectedAudio] = useState(-1);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const nativeSessionRef = useRef<ReturnType<typeof startNativePlaybackSession> | null>(null);
  const closingRef = useRef(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PlayerState["diagnostics"]>();
  // WebView2 must stay opaque until libmpv reports playback-restart.  Before
  // that event its child video window can still be transparent, which would
  // otherwise expose whatever desktop window happens to sit behind Nuvio.
  const [nativeSurfaceReady, setNativeSurfaceReady] = useState(!nativePlayer);
  // `player.open` starts libmpv's thread but returns before its video output is
  // configured. A resize command sent in that gap can be accepted and then
  // overwritten by the first VO setup. Apply the selected mode once more when
  // the native state reports its first frame, exactly once per opened stream.
  const nativePictureModeReadyRef = useRef(false);
  const url = stream.url;
  // A different stream is a different host: it deserves the attempt this one
  // used up, and none of the last one's explanation.
  useEffect(() => {
    setNativeRefused(false);
    setNotice("");
  }, [url]);
  const externalUrl = stream.externalUrl || url;
  useEffect(() => {
    thumbnailRequestRef.current += 1;
    thumbnailBucketRef.current = -1;
    setSeekThumbnail(null);
  }, [url]);
  const navigableExternalUrl = useMemo(
    () => safeHttpUrl(externalUrl),
    [externalUrl],
  );
  const sourceText = `${stream.name} ${stream.title} ${stream.description} ${stream.behaviorHints?.filename ?? ""}`;
  const riskyAudio = useMemo(
    () => /truehd|dts(?:-hd)?|e-?ac-?3|dd\+|atmos|\.mkv\b/i.test(sourceText),
    [sourceText],
  );
  /**
   * Picture mode for this playback.
   *
   * Seeded from the account setting and then cycled from the control below, so
   * a one-off change for a badly-cropped print does not rewrite the default
   * every title inherits.
   */
  const [resizeMode, setResizeMode] = useState<ResizeMode>(
    () => visibleResizeMode(settings.resizeMode),
  );
  useEffect(() => {
    setResizeMode(visibleResizeMode(settings.resizeMode));
  }, [settings.resizeMode]);
  const resizeModeRef = useRef(resizeMode);
  resizeModeRef.current = resizeMode;
  const applyBrowserPictureMode = useCallback((mode: ResizeMode) => {
    if (nativePlayer) return;
    const viewport = playerRef.current;
    if (!viewport) return;
    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    const targets = [videoRef.current, canvasRef.current].filter(
      (target): target is HTMLVideoElement | HTMLCanvasElement => !!target,
    );
    for (const target of targets) {
      const mediaWidth =
        target instanceof HTMLVideoElement ? target.videoWidth : target.width;
      const mediaHeight =
        target instanceof HTMLVideoElement ? target.videoHeight : target.height;
      const rect = mediaRectForResizeMode(
        mode,
        mediaWidth,
        mediaHeight,
        viewportWidth,
        viewportHeight,
      );
      if (!rect) {
        target.style.inset = "0";
        target.style.width = "100%";
        target.style.height = "100%";
        target.style.transform = "none";
        target.style.objectFit = objectFitForResizeMode(mode);
        continue;
      }
      target.style.inset = "auto";
      target.style.left = "50%";
      target.style.top = "50%";
      target.style.width = `${rect.width}px`;
      target.style.height = `${rect.height}px`;
      target.style.transform = "translate(-50%, -50%)";
      // Geometry is already resolved above; avoid asking fullscreen's special
      // media rendering path to reinterpret it a second time.
      target.style.objectFit = "fill";
    }
  }, []);
  const [pictureNote, setPictureNote] = useState("");
  const cycleResizeMode = useCallback(() => {
    setResizeMode((current) => {
      // A mode the settings screen offers but this cycle does not — Fill —
      // would otherwise have no next step; start from the beginning.
      const at = RESIZE_MODES.indexOf(current);
      const next = RESIZE_MODES[(at + 1) % RESIZE_MODES.length];
      applyBrowserPictureMode(next);
      // The native surface is rescaled by mpv, not by CSS, so it has to be
      // told. Absent on a shell that cannot, and then the button is not built.
      void nativePlayer?.setResizeMode?.(next).catch(() => undefined);
      setPictureNote(next);
      return next;
    });
  }, [applyBrowserPictureMode]);
  useEffect(() => {
    if (!pictureNote) return;
    const timer = window.setTimeout(() => setPictureNote(""), PICTURE_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [pictureNote]);
  const videoFit = objectFitForResizeMode(resizeMode);
  const reapplyPictureMode = useCallback(() => {
    if (nativePlayer)
      void nativePlayer.setResizeMode?.(resizeMode).catch(() => undefined);
    else applyBrowserPictureMode(resizeMode);
  }, [applyBrowserPictureMode, resizeMode]);

  useEffect(() => {
    if (nativePlayer) return;
    const viewport = playerRef.current;
    const element = videoRef.current;
    if (!viewport || !element) return;
    const apply = () => applyBrowserPictureMode(resizeModeRef.current);
    const observer = new ResizeObserver(apply);
    observer.observe(viewport);
    element.addEventListener("loadedmetadata", apply);
    apply();
    return () => {
      observer.disconnect();
      element.removeEventListener("loadedmetadata", apply);
    };
  }, [applyBrowserPictureMode]);
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

  /**
   * The sample line in the customiser, drawn from the same values as the cue
   * stylesheet — so what it shows is what the captions under it are doing.
   */
  const cuePreviewStyle = useMemo(() => {
    const outline = browserColor(settings.subtitleOutlineColor, "#000");
    const width = clamp(settings.subtitleOutlineWidth, 0, 10);
    return {
      color: browserColor(settings.subtitleTextColor, "#fff"),
      background: browserColor(settings.subtitleBackgroundColor, "transparent"),
      fontSize: `${clamp(settings.subtitleFontSizeSp, CAPTION_SIZE_MIN, CAPTION_SIZE_MAX)}px`,
      fontWeight: settings.subtitleBold ? 700 : 400,
      textShadow: settings.subtitleOutlineEnabled
        ? `${width}px 0 ${outline}, -${width}px 0 ${outline}, 0 ${width}px ${outline}, 0 -${width}px ${outline}`
        : "none",
    } as CSSProperties;
  }, [settings]);
  const stepCaptionSize = (by: number) =>
    onSubtitleStyle?.({
      subtitleFontSizeSp: clamp(
        settings.subtitleFontSizeSp + by,
        CAPTION_SIZE_MIN,
        CAPTION_SIZE_MAX,
      ),
    });
  const stepCaptionOffset = (by: number) =>
    onSubtitleStyle?.({
      subtitleBottomOffset: clamp(
        settings.subtitleBottomOffset + by,
        0,
        CAPTION_OFFSET_MAX,
      ),
    });

  /**
   * Hands the caption style to a shell that draws its own subtitles.
   *
   * A browser needs nothing here — the cue stylesheet above is the whole
   * mechanism, and it re-renders with these values. mpv has to be told, and
   * told again for a change made on the settings page mid-playback, which is
   * why this watches the settings rather than the panel.
   */
  useEffect(() => {
    if (!nativePlayer?.setSubtitleStyle) return;
    void nativePlayer
      .setSubtitleStyle({
        fontSize: clamp(settings.subtitleFontSizeSp, CAPTION_SIZE_MIN, CAPTION_SIZE_MAX),
        bold: settings.subtitleBold,
        textColor: settings.subtitleTextColor,
        backgroundColor: settings.subtitleBackgroundColor,
        outlineEnabled: settings.subtitleOutlineEnabled,
        outlineColor: settings.subtitleOutlineColor,
        outlineWidth: clamp(settings.subtitleOutlineWidth, 0, 10),
        bottomOffset: clamp(settings.subtitleBottomOffset, 0, CAPTION_OFFSET_MAX),
      })
      .catch(() => undefined);
  }, [
    settings.subtitleFontSizeSp,
    settings.subtitleBold,
    settings.subtitleTextColor,
    settings.subtitleBackgroundColor,
    settings.subtitleOutlineEnabled,
    settings.subtitleOutlineColor,
    settings.subtitleOutlineWidth,
    settings.subtitleBottomOffset,
  ]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    const running = nativePlayer
      ? playingRef.current
      : engineRef.current
        ? !engineRef.current.paused
        : videoRef.current && !videoRef.current.paused;
    if (running)
      hideTimer.current = window.setTimeout(() => {
        setSettingsPage(null);
        setExternalPlayerOpen(false);
        setSourcesOpen(false);
        setControlsVisible(false);
      }, CONTROLS_HIDE_MS);
  }, []);
  // The countdown above only starts if playback is already running when it
  // is asked. Resuming with Space, or the native player starting on its own,
  // turns playback on *after* that, so nothing ever hid the controls or the
  // cursor until the mouse moved again. Restart it whenever playback starts;
  // a pause brings the controls back and holds them.
  useEffect(() => {
    if (playing) showControls();
    else {
      window.clearTimeout(hideTimer.current);
      setControlsVisible(true);
    }
  }, [playing, showControls]);
  const togglePlayback = useCallback(async () => {
    showControls();
    if (nativePlayer) {
      const next = !playingRef.current;
      setPlaying(next);
      try {
        await nativePlayer.togglePause();
      } catch (reason) {
        setPlaying(!next);
        setError(reason instanceof Error ? reason.message : "Could not control playback.");
      }
      return;
    }
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
      if (nativePlayer) {
        const maximum = duration > 0
          ? Math.max(0, duration - 0.05)
          : Math.max(0, requested);
        const target = clamp(requested, 0, maximum);
        seekPreviewRef.current = null;
        setSeekPreview(null);
        pendingNativeSeekRef.current = {
          targetSeconds: target,
          submittedAt: performance.now(),
        };
        setCurrentTime(target);
        setWaiting(true);
        showControls();
        try {
          await nativePlayer.seek(Math.round(target * 1000));
        } catch (reason) {
          pendingNativeSeekRef.current = null;
          setWaiting(false);
          setError(reason instanceof Error ? reason.message : "Could not seek.");
        }
        return;
      }
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
        try {
          await engine.seek(target);
        } catch (reason) {
          if (engineRef.current !== engine) return;
          engine.stop();
          setWaiting(false);
          setError(reason instanceof Error ? reason.message : "Could not seek this source.");
        }
        return;
      }
      if (!element) return;
      // Shown straight away rather than waiting for the browser to admit it is
      // stalling, which it only does once the gap is already noticeable.
      setWaiting(true);

      element.currentTime = target;
      setCurrentTime(target);
    },
    [duration, showControls, remuxActive],
  );
  const seekBy = useCallback(
    (amount: number) => {
      const from = nativePlayer
        ? currentTime
        : engineRef.current?.currentTime ?? videoRef.current?.currentTime;
      if (from === undefined) return;
      void seekTo(from + amount);
    },
    [currentTime, seekTo],
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
    if (nativePlayer) {
      audioEchoUntil.current = Date.now() + AUDIO_ECHO_MS;
      setMuted((value) => {
        const next = !value;
        const applied = nativePlayer.setMuted
          ? nativePlayer.setMuted(next)
          : nativePlayer.toggleMute();
        void applied.catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : "Could not change mute."),
        );
        return next;
      });
      return;
    }
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
    if (nativePlayer?.setFullscreen) {
      const next = !nativeFullscreen;
      try {
        await nativePlayer.setFullscreen(next);
        setNativeFullscreen(next);
        // Tauri finishes changing the native client bounds after the bridge
        // promise resolves. Reapply once now and once after layout settles so
        // mpv does not retain pre-fullscreen Fit/Zoom geometry.
        reapplyPictureMode();
        window.setTimeout(reapplyPictureMode, 180);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not change fullscreen mode.");
      }
      return;
    }
    const container = playerRef.current;
    const element = videoRef.current as
      (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!container || !element) return;
    const webkitDocument = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const webkitContainer = container as HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const fullscreenElement =
      document.fullscreenElement ?? webkitDocument.webkitFullscreenElement;
    if (fullscreenElement) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else await webkitDocument.webkitExitFullscreen?.();
    } else if (container.requestFullscreen) {
      await container.requestFullscreen();
    } else if (webkitContainer.webkitRequestFullscreen) {
      await webkitContainer.webkitRequestFullscreen();
    } else if (!decoding && !engineRef.current && element.webkitEnterFullscreen) {
      // iPhone only offers native video fullscreen. It is valid for direct
      // <video> playback, but never send it the hidden element while WebCodecs
      // is drawing into the canvas—that produced a blank, dead fullscreen.
      element.style.objectFit = videoFit;
      element.webkitEnterFullscreen();
    } else {
      // An installed iPhone PWA already gives this fixed player the complete
      // app viewport. There is no second canvas-fullscreen surface to enter.
      setStatus("The player is already using the full app screen.");
      showControls();
    }
  }, [decoding, nativeFullscreen, reapplyPictureMode, showControls, videoFit]);

  // Delay a single click very briefly so the first half of a double-click
  // does not pause and immediately resume the movie before fullscreen opens.
  const handleSurfaceClick = useCallback(() => {
    window.clearTimeout(surfaceClickTimer.current);
    // A visible menu owns the next background click. Closing it must not also
    // leak through to the player transport and pause/resume the stream.
    if (settingsPage !== null) {
      surfaceClickTimer.current = undefined;
      surfaceMenuDismissedAt.current = performance.now();
      setSettingsPage(null);
      showControls();
      return;
    }
    surfaceClickTimer.current = window.setTimeout(() => {
      surfaceClickTimer.current = undefined;
      void togglePlayback();
    }, 220);
  }, [settingsPage, showControls, togglePlayback]);
  const handleSurfaceDoubleClick = useCallback(() => {
    window.clearTimeout(surfaceClickTimer.current);
    surfaceClickTimer.current = undefined;
    if (performance.now() - surfaceMenuDismissedAt.current < 400) return;
    void toggleFullscreen();
  }, [toggleFullscreen]);
  useEffect(
    () => () => window.clearTimeout(surfaceClickTimer.current),
    [],
  );

  useEffect(() => {
    const element = videoRef.current;
    const onFullscreenLayout = () => {
      // Browsers rebuild the fullscreen top layer before/after firing this
      // event. Apply on the event and the next painted frame so contain/cover
      // cannot remain stuck on the old box.
      reapplyPictureMode();
      window.requestAnimationFrame(() => reapplyPictureMode());
    };
    document.addEventListener("fullscreenchange", onFullscreenLayout);
    document.addEventListener("webkitfullscreenchange", onFullscreenLayout);
    element?.addEventListener("webkitbeginfullscreen", onFullscreenLayout);
    element?.addEventListener("webkitendfullscreen", onFullscreenLayout);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenLayout);
      document.removeEventListener("webkitfullscreenchange", onFullscreenLayout);
      element?.removeEventListener("webkitbeginfullscreen", onFullscreenLayout);
      element?.removeEventListener("webkitendfullscreen", onFullscreenLayout);
    };
  }, [reapplyPictureMode]);

  useEffect(() => {
    if (!nativePlayer) return;
    const sourceUrl = url || externalUrl;
    if (!sourceUrl) {
      setWaiting(false);
      setError("This source does not provide a playable URL.");
      return;
    }

    let live = true;
    closingRef.current = false;
    setDiagnostics(undefined);
    let polling = false;
    let opened = false;
    const transparentRoots = [document.documentElement, document.body];
    transparentRoots.forEach((node) => node.classList.add("native-player-active"));
    setSwitching(false);
    setNextDismissed(false);
    setStatus("");
    setError("");
    setWarning("");
    setWaiting(true);
    setPlaying(false);
    setNativeSurfaceReady(false);
    nativePictureModeReadyRef.current = false;
    pendingNativeSeekRef.current = null;
    nativeProgressSnapshotRef.current = {
      positionMs: 0,
      durationMs: 0,
      ended: false,
    };

    const refresh = async () => {
      if (polling || !opened || closingRef.current || session.closed) return;
      polling = true;
      try {
        const next = await nativePlayer.state();
        if (!live || closingRef.current || session.closed) return;
        setDiagnostics(next.diagnostics);
        nativeProgressSnapshotRef.current = {
          positionMs: Math.max(0, next.positionMs),
          durationMs: Math.max(0, next.durationMs),
          ended: next.ended,
        };
        setWaiting(next.loading);
        setPlaying(next.active && !next.paused && !next.ended);
        if (next.active && !next.loading && !next.error) {
          revealNativePlayerSurface();
          setNativeSurfaceReady(true);
          if (!nativePictureModeReadyRef.current) {
            nativePictureModeReadyRef.current = true;
            try {
              await nativePlayer.setResizeMode?.(resizeModeRef.current);
            } catch (reason) {
              // Permit the next poll to retry instead of permanently accepting
              // a command that never reached the native player.
              nativePictureModeReadyRef.current = false;
              throw reason;
            }
          }
        }
        const sampledSeconds = Math.max(0, next.positionMs) / 1000;
        const pendingSeek = pendingNativeSeekRef.current;
        if (pendingSeek) {
          const confirmed =
            Math.abs(sampledSeconds - pendingSeek.targetSeconds) < 2.5;
          const expired = performance.now() - pendingSeek.submittedAt > 5_000;
          if (confirmed || expired) {
            pendingNativeSeekRef.current = null;
            setCurrentTime(sampledSeconds);
          } else {
            setCurrentTime(pendingSeek.targetSeconds);
          }
        } else {
          setCurrentTime(sampledSeconds);
        }
        setDuration(Math.max(0, next.durationMs) / 1000);
        // Not while a local change is still on its way to mpv. The poll
        // reports what mpv has applied, so between pressing mute and mpv
        // acting on it every poll answered with the old value and undid the
        // press — mute read as muted, then full, then muted again.
        if (Date.now() >= audioEchoUntil.current) {
          setVolume(clamp(next.volume / 100, 0, 1));
          setMuted(next.muted);
        }
        setError(next.error ?? "");
        if (next.warning) setWarning(next.warning);
        const tracks = next.tracks
          .filter((track) => track.kind === "audio")
          .map((track) => ({
            id: track.id,
            label: track.title || languageName(track.lang) || `Audio ${track.id}`,
            lang: track.lang,
          }));
        setAudioTracks(tracks);
        setSelectedAudio(next.audioTrack);
        // mpv reports these alongside the audio ones; they were being filtered
        // out and thrown away, which is why there was no way to change them.
        setSubtitleTracks(
          next.tracks
            .filter((track) => track.kind === "sub")
            .map((track) => ({
              id: track.id,
              lang: track.lang ?? "",
              label: track.title || languageName(track.lang) || `Subtitle ${track.id}`,
            })),
        );
        setSelectedSubtitle(next.subtitleTrack);
      } catch (reason) {
        if (live)
          setError(reason instanceof Error ? reason.message : "Could not read native player state.");
      } finally {
        polling = false;
      }
    };

    const rememberedVolume = clamp(
      Number(localStorage.getItem("nuvio-web-volume") ?? 1),
      0,
      1,
    );
    const rememberedMuted =
      localStorage.getItem("nuvio-web-muted") === "true";
    const session = startNativePlaybackSession(nativePlayer, {
        preferences: nativePlayerPreferences(settings),
        url: sourceUrl,
        externalUrl,
        title: video?.title || meta.name,
        mediaId: video?.title || meta.name,
        startPositionMs,
        requestHeaders: stream.behaviorHints?.proxyHeaders?.request,
        deviceLanguages: navigator.languages?.length
          ? [...navigator.languages]
          : navigator.language
            ? [navigator.language]
            : [],
        contentLanguage: meta.language,
        progress: {
          contentId: meta.id,
          contentType: meta.type,
          videoId: video?.id ?? meta.id,
          season: video?.season,
          episode: video?.episode,
        },
      }, coverNativePlayerSurface);
    nativeSessionRef.current = session;
    void session.ready.then(async () => {
        if (!live || closingRef.current || session.closed) return;
        await nativePlayer.setVolume(Math.round(rememberedVolume * 100));
        if (!live || closingRef.current || session.closed) return;
        if (rememberedMuted) await nativePlayer.toggleMute();
        if (!live || closingRef.current || session.closed) return;
        opened = true;
        await refresh();
      })
      .catch((reason: unknown) => {
        if (!live) return;
        setWaiting(false);
        setError(reason instanceof Error ? reason.message : "libmpv could not open this source.");
      });
    const timer = window.setInterval(refresh, 350);

    return () => {
      live = false;
      void session.stop().catch(() => undefined);
      if (nativeSessionRef.current === session) nativeSessionRef.current = null;
      window.clearInterval(timer);
      transparentRoots.forEach((node) => node.classList.remove("native-player-active"));
    };
  }, [
    externalUrl,
    meta.id,
    meta.name,
    meta.type,
    // Resume progress changes as playback is saved. It is an initial position,
    // not a reason to prepare this same source again while it is playing.
    stream.behaviorHints?.proxyHeaders?.request,
    url,
    video?.episode,
    video?.id,
    video?.season,
    video?.title,
  ]);

  useEffect(() => {
    if (nativePlayer) return;
    const element = videoRef.current;
    if (!element || !url) {
      // Before the early return, not after it: a chosen source with no browser
      // URL used to leave the player believing it was still mid-switch, which
      // disables the source and next-episode controls for good — so the one
      // way out of the failure was the way back in.
      setSwitching(false);
      setWaiting(false);
      setError("This source does not provide a direct browser video URL.");
      return;
    }
    let disposed = false;
    setSwitching(false);
    setNextDismissed(false);
    setError("");
    setDecoding(false);
    setWaiting(true);
    let audioWatch: number | undefined;
    let preferredAudioApplied = false;
    let preferredSubtitleApplied = false;
    const isHls = /\.m3u8(?:$|\?)/i.test(url);
    const fail = () => {
      if (disposed) return;
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
          list[index].label ||
          languageName(list[index].language) ||
          `Audio ${index + 1}`,
        lang: list[index].language,
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
    element.defaultPlaybackRate = playbackRate;
    element.playbackRate = playbackRate;
    element.preservesPitch = true;
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
    // Once per source, not once per run of this effect. The effect re-runs on
    // things that have nothing to do with the file — a language preference, a
    // route that refused — and each of those used to re-arm the seek, which
    // would drag playback back to where a source was swapped an hour ago.
    let resumed = startPositionMs <= 0 || resumedFor.current === url;
    const onResume = () => {
      if (resumed || !Number.isFinite(element.duration)) return;
      resumed = true;
      resumedFor.current = url;
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
    /*
     * Where this device has no in-app player, nothing gets played in it.
     *
     * The pickers stop offering it, but they are not the only way in:
     * continue-watching and the next episode open playback directly. One
     * guard here covers every route rather than four that have to agree.
     *
     * Downloads are exempt. A file already on the device is a blob, plays
     * through the video element like any other local file, and none of what
     * makes streaming unreliable on iOS applies to it.
     */
    if (!canPlayInApp() && externalUrl && /^https?:/i.test(externalUrl)) {
      setWaiting(false);
      setStatus("");
      onExternalPlay(mode && mode !== "internal" ? mode : "copy", externalUrl, startPositionMs);
      return cleanup;
    }
    const verdict = assessPlayback(url, sourceText);
    /*
     * Chosen from the player menu, or forced with ?nativeMkv=1 for testing.
     *
     * It used to be the query parameter alone, which meant the one path that
     * plays this audio on an iPhone could only be reached by editing the URL.
     * Matroska is the only container that needs the remux; anything the video
     * element already opens falls through to the ordinary native branch below.
     */
    /*
     * Also chosen automatically where the canvas player cannot have audio at
     * all.
     *
     * That engine decodes audio through WebCodecs, and on iOS `AudioDecoder`
     * does not exist — so every codec probes false and the file plays silent,
     * however playable it is. There is nothing to fix inside that path; the
     * only fix is not to take it. Safari decodes this audio through a video
     * element, which is what the remux feeds.
     */
    const noWebCodecsAudio = typeof AudioDecoder === "undefined";
    const chosenNative =
      mode === "native" ||
      new URLSearchParams(window.location.search).get("nativeMkv") === "1";
    const wantsNative =
      !nativeRefused && (chosenNative || (isAppleWebKit() && noWebCodecsAudio));
    if (wantsNative && /\.mkv(?:$|[?#\s])/i.test(`${url} ${sourceText}`)) {
      const failed = (reason: unknown) => {
        if (disposed) return;
        setWaiting(false);
        setStatus("");
        const said = reason instanceof Error ? reason.message : "Native remux failed.";
        if (chosenNative) {
          setError(said);
          return;
        }
        // Nobody asked for this path; it was taken because the canvas one has
        // no audio here. If it cannot read the file, go back rather than end
        // playback — silent video is what this device managed before, and it
        // is better than a stopped screen.
        setNotice(`${said} Playing without sound instead.`);
        setNativeRefused(true);
      };
      const remux = new NativeMkvPlayer(
        element,
        url,
        failed,
        stream.behaviorHints?.proxyHeaders?.request,
        settings.preferredAudioLanguage,
      );
      setStatus("Preparing native MKV playback…");
      void remux.start(startPositionMs / 1000).catch((reason) => {
        remux.stop();
        failed(reason);
      });
      return () => { cleanup(); remux.stop(); };
    }
    if (shouldUseRemuxFallback(url, sourceText)) {
      const canvas = canvasRef.current;
      if (!canvas) return cleanup;
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
            if (next.message) setNotice(next.message);
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
      engine.setPlaybackRate(playbackRate);
      engine.setStableVolume(stableVolume);
      void engine
        .start()
        .then(() => {
          if (disposed) return;
          // Canvas intrinsic dimensions become available during start. Apply
          // the real rectangle now rather than waiting for another viewport
          // resize that may never come.
          applyBrowserPictureMode(resizeModeRef.current);
          // Autoplay without a gesture is refused on iOS and increasingly
          // elsewhere; the centre button is then the gesture.
          void engine.play().then(() => {
            if (!disposed) setPlaying(!engine.paused);
            /*
             * A clock with nothing behind it.
             *
             * This engine keeps its own time, so a file whose packets parse
             * but whose frames never decode looks like it is playing: right
             * duration, advancing position, moving scrubber, black picture,
             * no sound. Nothing fails, so nothing is reported, and the
             * interface says everything is fine. Six seconds in, ask whether
             * a single frame ever reached the canvas, and say so if not —
             * with what this browser admitted about its decoders, which is
             * the only evidence anyone can send back from a phone.
             */
            window.setTimeout(() => {
              if (disposed || engine.hasRendered()) return;
              const decoders = engine.decoderSummary();
              setNotice(
                `Six seconds in and no frame has been drawn: this browser is reading the file but decoding nothing from it.${decoders ? ` ${decoders}` : ""}`,
              );
            }, 6000);
          }).catch((reason: unknown) => {
            if (disposed) return;
            engine.stop();
            setWaiting(false);
            setError(reason instanceof Error ? reason.message : "Playback could not start.");
          });
        })
        .catch((reason: unknown) => {
          if (disposed) return;
          engine.stop();
          setWaiting(false);
          setError(
            reason instanceof Error
              ? reason.message
              : "This source could not be read.",
          );
        });
      return () => {
        cleanup();
        if (engineRef.current === engine) engineRef.current = null;
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
              label:
                track.name || languageName(track.lang) || `Audio ${index + 1}`,
              lang: track.lang,
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
  }, [url, showControls, meta.language, nativeRefused,
    // Background profile sync produces a fresh settings object. Unrelated
    // theme/layout changes must not tear down an in-flight browser decoder.
    settings.preferredAudioLanguage, settings.secondaryPreferredAudioLanguage,
    settings.preferredSubtitleLanguage, settings.secondaryPreferredSubtitleLanguage,
    settings.subtitleBottomOffset]);

  useEffect(() => {
    localStorage.setItem("nuvio-web-volume", String(volume));
    localStorage.setItem("nuvio-web-muted", String(muted));
  }, [volume, muted]);
  useEffect(() => {
    localStorage.setItem("nuvio-web-playback-rate", String(playbackRate));
    localStorage.setItem("nuvio-web-stable-volume", String(stableVolume));
    localStorage.setItem("nuvio-web-hdr-enabled", String(hdrEnabled));
  }, [playbackRate, stableVolume, hdrEnabled]);
  useEffect(() => {
    if (nativePlayer) return;
    engineRef.current?.setPlaybackRate(playbackRate);
    const element = videoRef.current;
    if (element) {
      element.defaultPlaybackRate = playbackRate;
      element.playbackRate = playbackRate;
      element.preservesPitch = true;
    }
  }, [playbackRate]);
  useEffect(() => {
    if (!nativePlayer) engineRef.current?.setStableVolume(stableVolume);
  }, [stableVolume]);
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
    if (nativePlayer) return;
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

  /**
   * The subtitle tracks worth offering.
   *
   * A release with forty language tracks made this menu a wall, and the account
   * already says which languages are wanted — "only preferred languages" was
   * being honoured when mpv picked a track automatically and ignored the moment
   * you opened the list to pick one yourself.
   *
   * The filter never empties the menu: if nothing matches, everything is shown,
   * because a list of nothing is worse than a long one.
   */
  const browserSubtitleTracks = useMemo(() => {
    const totals = new Map<string, number>();
    for (const track of addonSubtitles) {
      const key = `${languageName(track.lang).toLowerCase()}\u0000${track.addonName}`;
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    return addonSubtitles.map((track, id) => {
      const language = languageName(track.lang) || "Unknown";
      const key = `${language.toLowerCase()}\u0000${track.addonName}`;
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);
      const variant = (totals.get(key) ?? 0) > 1
        ? ` · ${occurrence}/${totals.get(key)}`
        : "";
      return {
        id,
        lang: track.lang,
        label: `${language} · ${track.addonName}${variant}`,
        language,
        addonName: track.addonName,
        variantLabel: `${track.addonName}${variant}`,
      };
    });
  }, [addonSubtitles]);
  const offeredSubtitleTracks = nativePlayer
    ? subtitleTracks
    : browserSubtitleTracks;
  const visibleSubtitleTracks = useMemo(() => {
    if (
      !settings.subtitleShowOnlyPreferredLanguages &&
      settings.addonSubtitleStartupMode !== "PREFERRED_ONLY"
    )
      return offeredSubtitleTracks;
    const wanted = [
      settings.preferredSubtitleLanguage,
      settings.secondaryPreferredSubtitleLanguage,
    ]
      .map((value) => languageName(value).trim().toLowerCase())
      .filter(
        (value) =>
          value && !["none", "device", "forced", "default"].includes(value),
      );
    if (!wanted.length) return offeredSubtitleTracks;
    const matching = offeredSubtitleTracks.filter((track) =>
      wanted.includes(languageName(track.lang).toLowerCase()),
    );
    return matching.length ? matching : offeredSubtitleTracks;
  }, [
    offeredSubtitleTracks,
    settings.addonSubtitleStartupMode,
    settings.subtitleShowOnlyPreferredLanguages,
    settings.preferredSubtitleLanguage,
    settings.secondaryPreferredSubtitleLanguage,
  ]);

  /**
   * Addon results frequently contain several complete subtitle files for the
   * same language, each timed for a different release. They are alternatives,
   * not pieces to concatenate, so the first page groups them and a second page
   * exposes the individual versions only when there is a choice to make.
   */
  const browserSubtitleGroups = useMemo(() => {
    if (nativePlayer) return [];
    const groups = new Map<
      string,
      {
        key: string;
        label: string;
        tracks: Array<(typeof browserSubtitleTracks)[number]>;
      }
    >();
    for (const track of visibleSubtitleTracks) {
      const browserTrack = browserSubtitleTracks.find(
        (candidate) => candidate.id === track.id,
      );
      if (!browserTrack) continue;
      const source = addonSubtitles[browserTrack.id];
      const forced = source
        ? isForcedSubtitle(source.id, source.lang, source.url)
        : false;
      const language =
        browserTrack.language || languageName(browserTrack.lang) || "Unknown";
      const key = `${language.toLowerCase()}\u0000${forced ? "forced" : "full"}`;
      const group = groups.get(key) ?? {
        key,
        label: forced ? `${language} (Forced)` : language,
        tracks: [],
      };
      group.tracks.push(browserTrack);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [addonSubtitles, browserSubtitleTracks, visibleSubtitleTracks]);
  const openSubtitleGroup = useMemo(
    () => browserSubtitleGroups.find((group) => group.key === subtitleGroupKey),
    [browserSubtitleGroups, subtitleGroupKey],
  );
  useEffect(() => {
    if (settingsPage === "captionVersions" && !openSubtitleGroup) {
      setSettingsPage("captions");
    }
  }, [openSubtitleGroup, settingsPage]);

  const canPickSubtitles =
    !!nativePlayer || subtitleIndexBusy || browserSubtitleTracks.length > 0;
  /** What the settings list shows beside each row, YouTube-fashion. */
  const selectedSubtitleLabel = nativePlayer
    ? offeredSubtitleTracks.find((track) => track.id === selectedSubtitle)?.label ??
      t("player.off")
    : browserSubtitleGroups.find((group) =>
        group.tracks.some((track) => track.id === selectedSubtitle),
      )?.label ?? t("player.off");
  const selectedAudioLabel =
    audioTracks.find((track) => track.id === selectedAudio)?.label ??
    audioTracks[0]?.label ??
    "Default";

  const selectSubtitle = useCallback(async (id: number) => {
    const generation = ++subtitleFileGeneration.current;
    setSettingsPage(null);
    if (nativePlayer) {
      setSelectedSubtitle(id);
      await nativePlayer.setSubtitleTrack(id).catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : "Could not select subtitles.",
        ),
      );
      return;
    }
    if (id < 0) {
      setSelectedSubtitle(-1);
      setBrowserSubtitleCues([]);
      setSubtitleFileBusy(false);
      return;
    }
    const track = addonSubtitles[id];
    const subtitleUrl = safeHttpUrl(track?.url);
    if (!track || !subtitleUrl) {
      setWarning("That subtitle URL is not safe to open.");
      return;
    }
    setSelectedSubtitle(id);
    setBrowserSubtitleCues([]);
    setSubtitleFileBusy(true);
    try {
      const response = await platform.request(subtitleUrl, {
        timeoutMs: 15_000,
        maxBytes: 4 * 1024 * 1024,
      });
      if (!response.ok) throw new Error(`Subtitle host returned HTTP ${response.status}.`);
      const cues = parseBrowserSubtitles(response.body);
      if (!cues.length)
        throw new Error("This subtitle is not a readable WebVTT or SRT file.");
      if (generation === subtitleFileGeneration.current)
        setBrowserSubtitleCues(cues);
    } catch (reason) {
      if (generation !== subtitleFileGeneration.current) return;
      setSelectedSubtitle(-1);
      setWarning(
        reason instanceof Error ? reason.message : "Could not load subtitles.",
      );
    } finally {
      if (generation === subtitleFileGeneration.current)
        setSubtitleFileBusy(false);
    }
  }, [addonSubtitles]);

  const autoSubtitleFor = useRef("");
  useEffect(() => {
    if (nativePlayer || subtitleIndexBusy || !browserSubtitleTracks.length) return;
    const preferred = settings.preferredSubtitleLanguage.trim().toLowerCase();
    const selectedAudioLanguage = languageName(
      audioTracks.find((track) => track.id === selectedAudio)?.lang,
    ).toLowerCase();
    const key = [
      meta.type,
      video?.id || meta.id,
      preferred,
      settings.secondaryPreferredSubtitleLanguage,
      settings.subtitleUseForcedSubtitles,
      settings.subtitleUseForcedSubtitles || preferred === "forced"
        ? selectedAudioLanguage
        : "",
    ].join(":");
    if (autoSubtitleFor.current === key) return;
    autoSubtitleFor.current = key;
    // "Off" is authoritative. A stale secondary-language preference must not
    // silently turn subtitles back on after the primary control says Off.
    if (!preferred || preferred === "none") {
      if (selectedSubtitle >= 0) void selectSubtitle(-1);
      return;
    }
    const chosen = chooseBrowserSubtitle(
      addonSubtitles,
      preferred,
      settings.secondaryPreferredSubtitleLanguage,
      navigator.languages?.length ? navigator.languages : [navigator.language],
      selectedAudioLanguage,
      settings.subtitleUseForcedSubtitles,
    );
    if (chosen >= 0) void selectSubtitle(chosen);
  }, [
    addonSubtitles,
    audioTracks,
    browserSubtitleTracks,
    meta.id,
    meta.type,
    selectSubtitle,
    settings.preferredSubtitleLanguage,
    settings.secondaryPreferredSubtitleLanguage,
    settings.subtitleUseForcedSubtitles,
    selectedAudio,
    subtitleIndexBusy,
    video?.id,
  ]);

  const activeBrowserSubtitle = useMemo(
    () =>
      nativePlayer || selectedSubtitle < 0
        ? ""
        : activeBrowserSubtitleText(browserSubtitleCues, currentTime),
    [browserSubtitleCues, currentTime, selectedSubtitle],
  );

  const selectAudio = (id: number) => {
    if (nativePlayer) {
      setSelectedAudio(id);
      setSettingsPage(null);
      void nativePlayer.setAudioTrack(id).catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Could not select audio."),
      );
      return;
    }
    if (engineRef.current) {
      void engineRef.current.selectAudioTrack(id);
      setSelectedAudio(id);
      setSettingsPage(null);
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
    setSettingsPage(null);
  };
  const openExternalPlayer = (mode: ExternalPlayerMode) => {
    if (!externalUrl) return;
    setExternalPlayerOpen(false);
    // Paused first: the handoff unmounts this player, and a video element torn
    // down mid-play can leave the remuxer fetching for a moment after.
    const element = videoRef.current;
    element?.pause();
    if (nativePlayer) void nativeSessionRef.current?.stop().catch(() => undefined);
    // Where it got to here, so the other player picks up mid-scene rather than
    // at the last saved checkpoint.
    onExternalPlay(
      mode,
      externalUrl,
      Math.max(0, (nativePlayer ? currentTime : element?.currentTime ?? 0) * 1000),
    );
  };
  const setPlayerVolume = (next: number) => {
    if (nativePlayer) {
      const normalized = clamp(next, 0, 1);
      audioEchoUntil.current = Date.now() + AUDIO_ECHO_MS;
      setVolume(normalized);
      setMuted(normalized === 0);
      void nativePlayer.setVolume(Math.round(normalized * 100)).catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Could not change volume."),
      );
      // mpv's mute is a separate property from its volume, so moving the
      // slider off zero while muted left it silent — and the next poll put the
      // slider back to muted, which is what looked like the value snapping
      // back on its own.
      void nativePlayer.setMuted?.(normalized === 0).catch(() => undefined);
      return;
    }
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
    autoSkipped.current.clear();
    autoNextTriggered.current = false;
    if (!settings.skipIntroEnabled) return;
    const task = nativePlayer?.skipSegments
      ? nativePlayer.skipSegments({ contentId: meta.id, videoId: video?.id || meta.id, season: video?.season, episode: video?.episode,
          animeSkipEnabled: settings.animeSkipEnabled, animeSkipClientId }).then(parseNativeSkipSegments).catch(() => [])
      : loadSkipSegments(meta.id, video?.season, video?.episode);
    void task.then(
      (segments) => {
        if (live) setSkipSegments(segments);
      },
    );
    return () => {
      live = false;
    };
  }, [meta.id, video?.id, video?.season, video?.episode, settings.skipIntroEnabled, settings.animeSkipEnabled, animeSkipClientId]);
  const skippable = settings.skipIntroEnabled ? activeSkipSegment(skipSegments, currentTime) : null;
  useEffect(() => {
    if (!settings.skipIntroEnabled || !playing || waiting || error || switching || seekPreview != null) return;
    const segment = automaticSkipSegment(skipSegments, currentTime, duration, settings);
    if (!segment) return;
    const key = `${segment.kind}:${segment.start}:${segment.end}`;
    if (autoSkipped.current.has(key)) return;
    autoSkipped.current.add(key);
    void seekTo(Math.min(segment.end, duration)).catch(() => {
      setWarning("Could not skip this segment. You can still seek manually.");
    });
  }, [currentTime, duration, playing, waiting, error, switching, seekPreview, skipSegments, settings.skipIntroEnabled, settings.autoSkipSegmentTypes, seekTo]);

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
      if (closingRef.current || switching || next.id === video?.id) return;
      if (nativePlayer) void nativeSessionRef.current?.stop().catch(() => undefined);
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

  /**
   * Swaps the release without leaving playback.
   *
   * Same episode, different file: a host that has stalled, a track in a
   * language this one does not carry, a size that suits the connection better.
   * The position goes with it, so the swap picks up where the picture was
   * rather than at the top of the file.
   */
  const startSource = useCallback(
    (next: Stream) => {
      if (closingRef.current || switching || sourceKey(next) === sourceKey(stream))
        return;
      if (nativePlayer) void nativeSessionRef.current?.stop().catch(() => undefined);
      engineRef.current?.pause();
      videoRef.current?.pause();
      setPlaying(false);
      setWaiting(true);
      setStatus("Switching source…");
      setSwitching(true);
      setSourcesOpen(false);
      onSelectSource?.(next, Math.max(0, Math.round(currentTimeRef.current * 1000)));
    },
    [onSelectSource, switching, stream],
  );

  const closePlayer = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setNextDismissed(true);
    if (nativePlayer) {
      setNativeSurfaceReady(false);
      await coverNativePlayerSurface();
      const snapshot = nativeProgressSnapshotRef.current;
      if (snapshot.positionMs > 0 || snapshot.ended) {
        onNativeProgressSnapshot?.(
          snapshot.positionMs,
          snapshot.durationMs,
          snapshot.ended,
        );
      }
      // The player lives in the same native window as the WebView. Closing the
      // React overlay without restoring that window leaves the entire desktop
      // app fullscreen on the screen behind it.
      try {
        await nativePlayer.setFullscreen?.(false);
      } catch {
        // Stopping and returning is still more useful than trapping the viewer
        // in a player whose window manager rejected the fullscreen change.
      }
      setNativeFullscreen(false);
      try {
        await nativeSessionRef.current?.stop();
      } catch {
        // The player may already have stopped at EOF.
      }
    } else {
      const webkitDocument = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitExitFullscreen?: () => Promise<void> | void;
      };
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen().catch(() => undefined);
      } else if (webkitDocument.webkitFullscreenElement) {
        await Promise.resolve(webkitDocument.webkitExitFullscreen?.()).catch(
          () => undefined,
        );
      }
    }
    onClose();
  }, [onClose, onNativeProgressSnapshot]);
  const showNextEpisode =
    !!nextEpisode &&
    !nextDismissed &&
    !error &&
    nextEpisodeDue(
      currentTime,
      duration,
      settings,
      skipSegments,
    );
  const startEpisodeRef = useRef(startEpisode);
  startEpisodeRef.current = startEpisode;
  const canAutoContinue = showNextEpisode && settings.autoPlayNextEpisode && !switching
    && ((playing && !waiting) || (duration > 0 && currentTime >= duration));
  useEffect(() => {
    setNextCountdown(null);
    if (!canAutoContinue || !nextEpisode || autoNextTriggered.current) return;
    let remaining = 3;
    setNextCountdown(remaining);
    const timer = window.setInterval(() => {
      remaining -= 1;
      setNextCountdown(remaining);
      if (remaining <= 0) {
        window.clearInterval(timer);
        autoNextTriggered.current = true;
        startEpisodeRef.current(nextEpisode);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [canAutoContinue, nextEpisode]);

  const seekLimit = duration || 0;
  const displayedTime = seekPreview ?? currentTime;
  const previewSeekThumbnail = (event: {
    currentTarget: HTMLDivElement;
    clientX: number;
  }) => {
    if (!nativePlayer?.thumbnail || duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const left = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    const time = left * duration;
    setSeekThumbnail((current) =>
      current ? { ...current, time, left } : current,
    );
    const bucket = Math.floor((time * 1000) / 2000);
    if (thumbnailBucketRef.current === bucket) return;
    thumbnailBucketRef.current = bucket;
    const request = ++thumbnailRequestRef.current;
    void nativePlayer
      .thumbnail(time * 1000)
      .then((image) => {
        if (image && thumbnailRequestRef.current === request) {
          setSeekThumbnail({ image, time, left });
        }
      })
      .catch(() => undefined);
  };
  const clearSeekThumbnail = () => {
    thumbnailRequestRef.current += 1;
    thumbnailBucketRef.current = -1;
    setSeekThumbnail(null);
  };
  const commitSeekPreview = (fallback: number) => {
    const target = seekPreviewRef.current ?? fallback;
    if (seekPreviewRef.current === null) return;
    seekPreviewRef.current = null;
    void seekTo(target);
  };

  return (
    <div
      ref={playerRef}
      className={`player-view${nativePlayer ? " native-player" : ""}${nativePlayer && !nativeSurfaceReady ? " native-player-loading" : ""} ${controlsVisible || error ? "controls-visible" : "controls-hidden"}`}
      onPointerMove={showControls}
      onPointerDown={showControls}
    >
      <style>{cueCss}</style>
      {/*
        Keyed by source, so a swap gets new elements rather than the ones the
        last source was using.

        Changing a release mid-episode is the case this exists for. React runs
        the teardown and the setup of the load effect back to back in one
        commit, so the second source was being built on an element still
        carrying the first: its buffered ranges, its readyState, its error, its
        track lists, and a load algorithm that had only just been told to
        abort. An episode change does the same thing but has seconds of
        resolving in between, which is why it never showed this. New elements
        cost a frame and make the two cases identical.
      */}
      <video
        key={url}
        ref={videoRef}
        className={!hdrEnabled ? "player-hdr-limited" : undefined}
        playsInline
        autoPlay
        preload="auto"
        poster={video?.thumbnail || meta.background}
        style={{
          objectFit: videoFit,
          display: nativePlayer || decoding ? "none" : undefined,
        }}
        onClick={handleSurfaceClick}
        onDoubleClick={handleSurfaceDoubleClick}
      />
      {/* Where the decoder draws. Object-fit matches the video element so the
          two look the same whichever is playing. */}
      <canvas
        key={url}
        ref={canvasRef}
        className={`player-canvas${!hdrEnabled ? " player-hdr-limited" : ""}`}
        style={{
          objectFit: videoFit,
          display: !nativePlayer && decoding ? undefined : "none",
        }}
        onClick={handleSurfaceClick}
        onDoubleClick={handleSurfaceDoubleClick}
      />
      {!nativePlayer && activeBrowserSubtitle && (
        <div
          className="player-subtitle-overlay"
          style={{
            bottom: `calc(${clamp(settings.subtitleBottomOffset, 0, 100)}px + ${controlsVisible ? 92 : 0}px + env(safe-area-inset-bottom))`,
            color: browserColor(settings.subtitleTextColor, "#fff"),
            fontSize: `${clamp(settings.subtitleFontSizeSp, 6, 40)}px`,
            fontWeight: settings.subtitleBold ? 700 : 400,
            textShadow: settings.subtitleOutlineEnabled
              ? `${settings.subtitleOutlineWidth}px 0 ${browserColor(settings.subtitleOutlineColor, "#000")}, -${settings.subtitleOutlineWidth}px 0 ${browserColor(settings.subtitleOutlineColor, "#000")}, 0 ${settings.subtitleOutlineWidth}px ${browserColor(settings.subtitleOutlineColor, "#000")}, 0 -${settings.subtitleOutlineWidth}px ${browserColor(settings.subtitleOutlineColor, "#000")}`
              : "none",
          }}
          aria-live="off"
        >
          <span
            style={{
              background: browserColor(
                settings.subtitleBackgroundColor,
                "transparent",
              ),
            }}
          >
            {activeBrowserSubtitle}
          </span>
        </div>
      )}
      <div className="player-shade player-shade-top" />
      <div className="player-shade player-shade-bottom" />
      <div className="player-top">
        <button className="circle-button" aria-label="Back" onClick={closePlayer}>
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
      {/* Paused only. A pause glyph held over a playing picture is furniture:
          moving frames already say it is playing, and the thing that pauses is
          the picture itself. */}
      {!error && !waiting && !playing && (
        <button
          className="player-center"
          aria-label="Play"
          onClick={togglePlayback}
        >
          <SolidPlay />
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
              onClick={() => platform.externalPlayer.copyUrl(externalUrl)}
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
      {pictureNote && (
        <div className="picture-note" role="status">
          {pictureNote}
        </div>
      )}
      <div className="player-controls">
        <div className="player-timeline">
          <span>{formatTime(displayedTime)}</span>
          <div
            className="player-seek-control"
            onPointerMove={previewSeekThumbnail}
            onPointerLeave={clearSeekThumbnail}
          >
            {seekThumbnail && (
              <div
                className="player-seek-thumbnail"
                style={{ "--thumbnail-left": `${seekThumbnail.left * 100}%` } as CSSProperties}
              >
                <img src={seekThumbnail.image} alt="" />
                <span>{formatTime(seekThumbnail.time)}</span>
              </div>
            )}
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
          </div>
          <span>{formatTime(duration)}</span>
        </div>
        <div className="player-control-row">
          <div className="player-control-group">
            <button
              className="player-play"
              aria-label={playing ? "Pause" : "Play"}
              onClick={togglePlayback}
            >
              {playing ? <SolidPause /> : <SolidPlay />}
            </button>
            {/* Only where there is one to go to — a film, or the last episode
                of a season, would leave a button that does nothing. */}
            {nextEpisode && (
              <button
                aria-label={
                  nextEpisode.season != null && nextEpisode.episode != null
                    ? `Next episode: S${nextEpisode.season} E${nextEpisode.episode}`
                    : t("player.nextEpisode")
                }
                disabled={switching}
                onClick={() => startEpisode(nextEpisode)}
              >
                <SkipForward />
              </button>
            )}
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
          </div>
          <div className="player-control-group player-control-right">
            {/* One cog for everything that is a setting rather than an
                action, laid out as a list you step into and back out of. It
                was a button per setting along this bar, which does not grow:
                every new option was another glyph to recognise. */}
            <div className="audio-picker">
              <button
                aria-label={t("player.settings")}
                title={t("player.settings")}
                className={settingsPage ? "active" : ""}
                aria-expanded={settingsPage !== null}
                onClick={() => {
                  setExternalPlayerOpen(false);
                  setSourcesOpen(false);
                  setEpisodesOpen(false);
                  setSettingsPage((page) => (page ? null : "root"));
                }}
              >
                <Settings />
              </button>
              {settingsPage === "root" && (
                <div className="audio-menu settings-menu">
                  {canPickSubtitles && (
                    <button
                      className="settings-row"
                      onClick={() => setSettingsPage("captions")}
                    >
                      <span>
                        <ClosedCaptionIcon />
                        {t("player.subtitles")}
                      </span>
                      <em>
                        {subtitleFileBusy ? "Loading…" : selectedSubtitleLabel}
                        <ChevronRight />
                      </em>
                    </button>
                  )}
                  <button
                    className="settings-row"
                    onClick={() => setSettingsPage("audio")}
                  >
                    <span>
                      <ListMusic />
                      {t("player.audioTrack")}
                    </span>
                    <em>
                      {selectedAudioLabel}
                      <ChevronRight />
                    </em>
                  </button>
                  {!nativePlayer && (
                    <button
                      className="settings-row"
                      onClick={() => setSettingsPage("speed")}
                    >
                      <span>
                        <Gauge />
                        {t("player.playbackSpeed")}
                      </span>
                      <em>
                        {formatPlaybackRate(playbackRate)}
                        <ChevronRight />
                      </em>
                    </button>
                  )}
                  {/* Switches, so they settle here rather than opening a page
                      of two words. No explanation under either: a setting that
                      needs a paragraph in a menu over a running picture is one
                      nobody reads while watching. */}
                  {!nativePlayer && (
                    <label className="settings-row settings-switch">
                      <span>
                        <AudioLines />
                        Stable Volume
                      </span>
                      <input
                        type="checkbox"
                        checked={stableVolume}
                        disabled={!decoding}
                        onChange={(event) => setStableVolume(event.target.checked)}
                      />
                    </label>
                  )}
                  {!nativePlayer && (
                    <label className="settings-row settings-switch">
                      <span>
                        <HdIcon />
                        HDR output
                      </span>
                      <input
                        type="checkbox"
                        checked={hdrEnabled}
                        disabled={!hdrControlSupported || decoding}
                        title={
                          decoding
                            ? "HDR output is unavailable during canvas playback."
                            : undefined
                        }
                        onChange={(event) => setHdrEnabled(event.target.checked)}
                      />
                    </label>
                  )}
                </div>
              )}
              {settingsPage === "captions" && (
                <div className="audio-menu settings-menu subtitle-menu">
                  <button
                    className="settings-back"
                    onClick={() => setSettingsPage("root")}
                  >
                    <ChevronLeft />
                    <strong>{t("player.subtitles")}</strong>
                  </button>
                  {/* How they look, next to which one is showing. Both are
                      questions about the captions in front of you, and having
                      to leave playback for the second one is why nobody ever
                      found it. */}
                  {onSubtitleStyle && (
                    <button
                      className="settings-row"
                      onClick={() => setSettingsPage("captionStyle")}
                    >
                      <span>
                        <SlidersHorizontal />
                        {t("player.captionStyle")}
                      </span>
                      <em>
                        <ChevronRight />
                      </em>
                    </button>
                  )}
                  {/* Always offered, even with no tracks: turning subtitles
                      off is the thing most often wanted here, and it has to be
                      reachable whatever the file contains. */}
                  <button
                    className={selectedSubtitle < 0 ? "selected" : ""}
                    onClick={() => selectSubtitle(-1)}
                  >
                    {t("player.off")}
                  </button>
                  {nativePlayer
                    ? visibleSubtitleTracks.map((track) => (
                        <button
                          key={track.id}
                          className={selectedSubtitle === track.id ? "selected" : ""}
                          onClick={() => selectSubtitle(track.id)}
                        >
                          {track.label}
                        </button>
                      ))
                    : browserSubtitleGroups.map((group) => {
                        const selected = group.tracks.some(
                          (track) => track.id === selectedSubtitle,
                        );
                        if (group.tracks.length === 1) {
                          const track = group.tracks[0];
                          return (
                            <button
                              key={group.key}
                              className={selected ? "selected" : ""}
                              onClick={() => selectSubtitle(track.id)}
                            >
                              {group.label}
                            </button>
                          );
                        }
                        return (
                          <button
                            key={group.key}
                            className={`settings-row${selected ? " selected" : ""}`}
                            onClick={() => {
                              setSubtitleGroupKey(group.key);
                              setSettingsPage("captionVersions");
                            }}
                          >
                            <span>{group.label}</span>
                            <em>
                              {group.tracks.length} versions
                              <ChevronRight />
                            </em>
                          </button>
                        );
                      })}
                  {subtitleIndexBusy ? (
                    <p className="subtitle-loading"><LoaderCircle className="spin" /> Loading subtitles…</p>
                  ) : !offeredSubtitleTracks.length ? (
                    <p>No subtitle addon returned a track for this title.</p>
                  ) : null}
                </div>
              )}
              {settingsPage === "captionVersions" && openSubtitleGroup && (
                <div className="audio-menu settings-menu subtitle-menu">
                  <button
                    className="settings-back"
                    onClick={() => setSettingsPage("captions")}
                  >
                    <ChevronLeft />
                    <strong>{openSubtitleGroup.label}</strong>
                  </button>
                  {openSubtitleGroup.tracks.map((track) => (
                    <button
                      key={track.id}
                      className={selectedSubtitle === track.id ? "selected" : ""}
                      onClick={() => selectSubtitle(track.id)}
                    >
                      {track.variantLabel}
                    </button>
                  ))}
                </div>
              )}
              {settingsPage === "captionStyle" && (
                <div className="audio-menu settings-menu caption-style-menu">
                  <button
                    className="settings-back"
                    onClick={() => setSettingsPage("captions")}
                  >
                    <ChevronLeft />
                    <strong>{t("player.captionStyle")}</strong>
                  </button>
                  {/* Live, on the captions actually on screen. The stored
                      values are the ones Settings edits, so this is the same
                      preference reached from where you can see its effect. */}
                  {/* The style rides on the line, not the box: the box is a
                      checked ground, and a transparent caption background has
                      to be seen through to mean anything. */}
                  <p className="caption-style-preview">
                    <span style={cuePreviewStyle}>The quick brown fox</span>
                  </p>
                  <div className="settings-row caption-style-step">
                    <span>Text size</span>
                    <em>
                      <button
                        aria-label="Smaller text"
                        disabled={settings.subtitleFontSizeSp <= CAPTION_SIZE_MIN}
                        onClick={() => stepCaptionSize(-2)}
                      >
                        <Minus />
                      </button>
                      <i>{settings.subtitleFontSizeSp}</i>
                      <button
                        aria-label="Larger text"
                        disabled={settings.subtitleFontSizeSp >= CAPTION_SIZE_MAX}
                        onClick={() => stepCaptionSize(2)}
                      >
                        <Plus />
                      </button>
                    </em>
                  </div>
                  <div className="settings-row caption-style-step">
                    <span>Position</span>
                    <em>
                      <button
                        aria-label="Lower"
                        disabled={settings.subtitleBottomOffset <= 0}
                        onClick={() => stepCaptionOffset(-5)}
                      >
                        <Minus />
                      </button>
                      <i>{settings.subtitleBottomOffset}</i>
                      <button
                        aria-label="Higher"
                        disabled={settings.subtitleBottomOffset >= CAPTION_OFFSET_MAX}
                        onClick={() => stepCaptionOffset(5)}
                      >
                        <Plus />
                      </button>
                    </em>
                  </div>
                  <div className="caption-style-swatches">
                    <small>Text colour</small>
                    <div>
                      {CAPTION_COLORS.map((option) => (
                        <button
                          key={option.value}
                          title={option.name}
                          aria-label={option.name}
                          aria-pressed={sameColor(settings.subtitleTextColor, option.value)}
                          className={sameColor(settings.subtitleTextColor, option.value) ? "selected" : ""}
                          style={{ "--swatch": browserColor(option.value, "#fff") } as CSSProperties}
                          onClick={() => onSubtitleStyle?.({ subtitleTextColor: option.value })}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="caption-style-swatches">
                    <small>Background</small>
                    <div>
                      {CAPTION_BACKGROUNDS.map((option) => (
                        <button
                          key={option.value}
                          title={option.name}
                          aria-label={option.name}
                          aria-pressed={sameColor(settings.subtitleBackgroundColor, option.value)}
                          className={`${sameColor(settings.subtitleBackgroundColor, option.value) ? "selected" : ""}${option.value.startsWith("#00") ? " is-none" : ""}`}
                          style={{ "--swatch": browserColor(option.value, "transparent") } as CSSProperties}
                          onClick={() => onSubtitleStyle?.({ subtitleBackgroundColor: option.value })}
                        />
                      ))}
                    </div>
                  </div>
                  <label className="settings-row settings-switch">
                    <span>Outline</span>
                    <input
                      type="checkbox"
                      checked={settings.subtitleOutlineEnabled}
                      onChange={(event) =>
                        onSubtitleStyle?.({
                          subtitleOutlineEnabled: event.target.checked,
                        })
                      }
                    />
                  </label>
                  <label className="settings-row settings-switch">
                    <span>Bold</span>
                    <input
                      type="checkbox"
                      checked={settings.subtitleBold}
                      onChange={(event) =>
                        onSubtitleStyle?.({ subtitleBold: event.target.checked })
                      }
                    />
                  </label>
                </div>
              )}
              {settingsPage === "audio" && (
                <div className="audio-menu settings-menu subtitle-menu">
                  <button
                    className="settings-back"
                    onClick={() => setSettingsPage("root")}
                  >
                    <ChevronLeft />
                    <strong>{t("player.audioTrack")}</strong>
                  </button>
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
                </div>
              )}
              {settingsPage === "speed" && (
                <div className="audio-menu settings-menu subtitle-menu">
                  <button
                    className="settings-back"
                    onClick={() => setSettingsPage("root")}
                  >
                    <ChevronLeft />
                    <strong>{t("player.playbackSpeed")}</strong>
                  </button>
                  {PLAYBACK_RATES.map((rate) => (
                    <button
                      key={rate}
                      className={playbackRate === rate ? "selected" : ""}
                      onClick={() => {
                        setPlaybackRate(rate);
                        setSettingsPage(null);
                      }}
                    >
                      {formatPlaybackRate(rate)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!nativePlayer && externalUrl && !!handoffOptions().length && (
              <div className="external-player-picker">
                <button
                  className={externalPlayerOpen ? "active" : ""}
                  aria-label="Open in external player"
                  aria-expanded={externalPlayerOpen}
                  onClick={() => {
                    setSettingsPage(null);
                    setSourcesOpen(false);
                    setExternalPlayerOpen((value) => !value);
                  }}
                >
                  <ExternalLink />
                </button>
                {externalPlayerOpen && (
                  <div className="external-player-menu">
                    <strong>Open with</strong>
                    {handoffOptions().map((option) => (
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
            {/* Swapping release without going back to the sheet: only offered
                where the app can actually resolve another one. */}
            {onSelectSource && (
              <button
                aria-label="Sources"
                title="Sources"
                className={sourcesOpen ? "active" : ""}
                aria-expanded={sourcesOpen}
                onClick={() => {
                  setSettingsPage(null);
                  setExternalPlayerOpen(false);
                  setEpisodesOpen(false);
                  // Asked for on the first look rather than with every
                  // stream: most playback never opens this.
                  if (!sourcesOpen && !sources?.length) onRequestSources?.();
                  setSourcesOpen((value) => !value);
                }}
              >
                <SourceSwapIcon />
              </button>
            )}
            {!!episodes?.length && onPlayEpisode && (
              <button
                aria-label={t("player.episodes")}
                className={episodesOpen ? "active" : ""}
                aria-expanded={episodesOpen}
                onClick={() => {
                  setSettingsPage(null);
                  setExternalPlayerOpen(false);
                  setSourcesOpen(false);
                  setEpisodesOpen((value) => !value);
                }}
              >
                <ListVideo />
              </button>
            )}
            {/* Only where the picture can actually be rescaled: CSS does it for
                a browser video, and mpv does it for the native surface — a
                shell offering neither would leave a button that does nothing. */}
            {(!nativePlayer || nativePlayer.setResizeMode) && (
              <button
                aria-label={`Picture mode: ${resizeMode}`}
                title={`Picture mode: ${resizeMode}`}
                onClick={cycleResizeMode}
              >
                <PictureModeGlyph />
              </button>
            )}
            {nativePlayer && (
              <button aria-label="Playback information" title="Playback information" aria-expanded={infoOpen}
                onClick={() => { showControls(); setInfoOpen((open) => !open); }}>
                <Info />
              </button>
            )}
            <button aria-label={t("player.fullscreen")} onClick={toggleFullscreen}>
              <Maximize />
            </button>
          </div>
        </div>
      </div>
      {nativePlayer && infoOpen && (
        <section className="player-diagnostics" aria-label="Playback information">
          <header><strong>Playback information</strong><button aria-label="Close playback information" onClick={() => setInfoOpen(false)}><X size={18} /></button></header>
          {diagnostics ? <dl>
            <dt>RTX requested</dt><dd>{diagnostics.rtxRequested ? "On for this stream" : "Off for this stream"}</dd>
            <dt>Hardware decoder</dt><dd>{diagnostics.hardwareDecoder || "Not reported yet"}</dd>
            <dt>GPU API setting</dt><dd>{diagnostics.gpuApi || "Not reported yet"}</dd>
            <dt>Video codec</dt><dd>{diagnostics.videoCodec || "Not reported yet"}</dd>
            <dt>Decoded video</dt><dd>{diagnostics.sourceWidth && diagnostics.sourceHeight ? `${diagnostics.sourceWidth} × ${diagnostics.sourceHeight}` : "Not reported yet"}</dd>
            <dt>After video filters</dt><dd>{diagnostics.outputWidth && diagnostics.outputHeight ? `${diagnostics.outputWidth} × ${diagnostics.outputHeight}` : "Not reported yet"}</dd>
            <dt>Video filters</dt><dd>{diagnostics.videoFilters || "None reported"}</dd>
          </dl> : <p>Waiting for mpv diagnostics…</p>}
          <p>For RTX, look for d3d11va and a d3d11vpp filter with scaling-mode=nvidia. Larger output dimensions show scaling. These are live mpv readings; they do not confirm NVIDIA driver enhancement activity.</p>
          {warning && <p>{warning}</p>}
        </section>
      )}
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
            <small>{nextCountdown != null ? `Playing in ${nextCountdown}…` : "Up next"}</small>
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
      {sourcesOpen && onSelectSource && (
        /* The sheet's own list, in the middle of the picture. It was a menu
           in the corner of the controls first, which is the right shape for
           picking an audio track and the wrong one for reading release names:
           they run long, carry badges, and there can be forty of them. */
        <div
          className="player-sources-scrim"
          onClick={() => setSourcesOpen(false)}
        >
          <section
            className="player-sources"
            role="dialog"
            aria-modal="true"
            aria-label="Sources"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">SOURCES</span>
                <strong>{video?.title || meta.name}</strong>
              </div>
              <button
                className="circle-button"
                aria-label={t("action.close")}
                onClick={() => setSourcesOpen(false)}
              >
                <X />
              </button>
            </header>
            <div className="source-list">
              {sources?.map((item) => {
                const current = sourceKey(item) === sourceKey(stream);
                return (
                  <article
                    key={sourceKey(item)}
                    className={current ? "is-playing" : undefined}
                  >
                    <button
                      className="source-main"
                      disabled={current || switching}
                      onClick={() => startSource(item)}
                    >
                      <span>
                        {item.addonLogo ? (
                          <img src={item.addonLogo} alt="" />
                        ) : (
                          <Play size={18} />
                        )}
                      </span>
                      <div>
                        {streamBadgeSettings?.placement === "TOP" && (
                          <SourceBadges stream={item} settings={streamBadgeSettings} />
                        )}
                        <strong>{item.name || item.addonName}</strong>
                        <p>{sourceLabel(item)}</p>
                        <small>
                          {item.addonName}
                          {current ? " · Playing now" : ""}
                        </small>
                        {streamBadgeSettings?.placement === "BOTTOM" && (
                          <SourceBadges stream={item} settings={streamBadgeSettings} />
                        )}
                      </div>
                    </button>
                  </article>
                );
              })}
              {sourcesBusy && (
                <div className="source-pending" role="status">
                  <i className="mini-spinner" aria-hidden="true" />
                  <span>{t("sources.fetching")}</span>
                </div>
              )}
              {!sourcesBusy && !sources?.length && (
                <div className="source-pending">
                  No other releases came back for this.
                </div>
              )}
            </div>
          </section>
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
                aria-label={t("action.close")}
                onClick={() => setEpisodesOpen(false)}
              >
                <X />
              </button>
            </header>
            <label className="season-select-wrap">
              <span>SEASON</span>
              <Select
                value={season ?? ""}
                onChange={(event) => setSeason(Number(event.target.value))}
              >
                {seasons.map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? "Specials" : `Season ${value}`}
                  </option>
                ))}
              </Select>
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
            <div
              className={`player-episode-list episode-list is-${episodeCardStyle}`}
            >
              {seasonEpisodes.map((item) => {
                const key = watchKey(meta.id, item.season, item.episode);
                return (
                  <EpisodeRow
                    key={item.id}
                    video={item}
                    rating={episodeRatings.get(`${item.season}:${item.episode}`)}
                    watched={watchIndex?.watched.has(key) ?? false}
                    percent={watchIndex ? episodePercent(watchIndex, key) : 0}
                    remaining={watchIndex ? remainingShort(watchIndex, key) : ""}
                    blurred={shouldBlurEpisode(blurUnwatchedEpisodes, watchIndex?.watched.has(key) ?? false, item.id === video?.id)}
                    onPlay={() => startEpisode(item)}
                    onMenu={() => undefined}
                  />
                );
              })}
            </div>
          </aside>
        </div>
      )}
      {notice && !error && (
        <div className="player-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")}>
            {t("common.dismiss")}
          </button>
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
          {!nativePlayer && externalUrl && !!handoffOptions().length && (
            <div className="player-error-players">
              <small>Play it in</small>
              <div>
                {handoffOptions().map((option) => (
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
            {!nativePlayer && externalUrl && (
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
