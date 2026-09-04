import { selectAutoStream } from "../lib/playbackPolicy";
import { bingeGroupFor } from "../lib/bingeCache";
import { matchBadges } from "../lib/badgeMatcher";
import {
  formatRating,
  loadEpisodeRatings,
  type EpisodeRatings,
} from "../lib/episodeRatings";
import {
  ArrowLeft,
  Check,
  Copy,
  Download as DownloadIcon,
  Eye,
  EyeOff,
  ExternalLink,
  Play,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { loadStreams, resolveMeta, supports } from "../lib/addons";
import { assessPlayback, shouldUseRemuxFallback } from "../lib/playback";
import { safeHttpUrl } from "../lib/security";
import { useDescriptionOverflow } from "../lib/useDescriptionOverflow";
import { DetailsTrace, detailsDebugEnabled, timed, type TimingStatus } from "../lib/detailsDebug";
import { DetailsDebugPanel } from "./DetailsDebug";
import {
  enrichMetadata,
  loadSeasonCast,
  mergeCast,
  tmdbIdForMeta,
  type MetadataEnrichmentConfig,
} from "../lib/metadataEnrichment";
import { platform } from "../platform/index.ts";
import {
  applyDebridStreamSettings,
  type DebridRules,
} from "../lib/debridStreams";
import {
  episodePercent,
  remainingShort,
  watchKey,
  type WatchIndex,
} from "../lib/progress";
import { seriesPlaybackTarget } from "../lib/seriesPlayback";
import {
  cachedStreamToSource,
  contentKey,
  getValidStreamLink,
  saveStreamLink,
} from "../lib/streamLinkCache";
import type {
  MetaScreenSectionKey,
  MetaScreenSettings,
} from "../lib/metaScreenSettings";
import { useDragScroll } from "../lib/useDragScroll";
import { useProgressiveList } from "../lib/useProgressiveList";
import { useLongPress } from "../lib/useLongPress";
import { useScrollLock } from "../lib/useScrollLock";
import { useSwipeBack } from "../lib/useSwipeBack";
import {
  browserColor,
  readableFileSize,
  type StreamBadgeFilter,
  type StreamBadgeSettings,
  type WebPlayerSettings,
} from "../lib/webSettings";
import type {
  ExternalPlayerMode,
  ExternalRating,
  InstalledAddon,
  Meta,
  Person,
  Stream,
  Video,
} from "../types";
import { ContextMenu } from "./ContextMenu";

const DEFAULT_DETAIL_COLOR = "18 22 26";

const publicAsset = (fileName: string) => `${import.meta.env.BASE_URL}${fileName}`;

const RATING_VISUALS = [
  { source: "imdb", name: "IMDb", icon: publicAsset("rating_imdb.png"), color: "#f5c518", format: oneDecimal, wide: true },
  { source: "tmdb", name: "TMDB", icon: publicAsset("rating_tmdb.png"), color: "#01b4e4", format: whole, wide: false },
  { source: "trakt", name: "Trakt", icon: publicAsset("rating_trakt.png"), color: "#ed1c24", format: whole, wide: false },
  { source: "letterboxd", name: "Letterboxd", icon: publicAsset("rating_letterboxd.png"), color: "#00e054", format: oneDecimal, wide: false },
  { source: "mal", name: "MyAnimeList", icon: publicAsset("rating_mal.png"), color: "#2e51a2", format: oneDecimal, wide: false },
  { source: "tomatoes", name: "Rotten Tomatoes", icon: publicAsset("rating_rotten_tomatoes.png"), color: "#fa320a", format: percent, wide: false },
  { source: "audience", name: "Audience score", icon: publicAsset("rating_audience_score.png"), color: "#fa320a", format: percent, wide: false },
  { source: "metacritic", name: "Metacritic", icon: publicAsset("rating_metacritic.png"), color: "#ffcc33", format: whole, wide: false },
] as const;

function oneDecimal(value: number) {
  return value.toFixed(1);
}
function whole(value: number) {
  return Math.round(value).toString();
}
function percent(value: number) {
  return `${Math.round(value)}%`;
}

function VideoGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M10 9.2v5.6l4.8-2.8z" />
    </svg>
  );
}

function canonicalRatingSource(source: string) {
  const normalized = source.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["rottentomatoes", "tomato", "tomatoes", "rt"].includes(normalized))
    return "tomatoes";
  if (["audience", "audiencescore", "popcornmeter"].includes(normalized))
    return "audience";
  if (["myanimelist", "mal"].includes(normalized)) return "mal";
  if (["themoviedb", "tmdb"].includes(normalized)) return "tmdb";
  if (["internetmoviedatabase", "imdb"].includes(normalized)) return "imdb";
  return normalized;
}

function episodeReleaseDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()} ${date.toLocaleDateString(undefined, {
    month: "long",
  })} ${date.getDate()}`;
}

function DetailsRatings({ meta }: { meta: Meta }) {
  const ratings = [...meta.externalRatings];
  if (!ratings.some((rating) => rating.source.toLowerCase() === "imdb")) {
    const imdb = Number(meta.imdbRating);
    if (Number.isFinite(imdb) && imdb > 0)
      ratings.unshift({ source: "imdb", value: imdb });
  }
  const bySource = new Map<string, ExternalRating>();
  for (const rating of ratings)
    bySource.set(canonicalRatingSource(rating.source), rating);
  return (
    <div className="detail-ratings">
      {RATING_VISUALS.map((visual) => {
        const rating = bySource.get(visual.source);
        if (!rating) return null;
        return (
          <span
            className={visual.wide ? "rating-wide" : undefined}
            style={{ color: visual.color }}
            key={visual.source}
            title={visual.name}
          >
            <img src={visual.icon} alt={visual.name} />
            {visual.format(rating.value)}
          </span>
        );
      })}
    </div>
  );
}

function videoCode(video?: Video) {
  return video?.season != null && video.episode != null
    ? `S${video.season}E${video.episode}`
    : "";
}

function playbackTarget(meta: Meta, watchIndex: WatchIndex) {
  if (meta.type !== "series") {
    const progress = watchIndex.progress.get(watchKey(meta.id));
    const resumable =
      progress &&
      progress.durationMs > 0 &&
      progress.positionMs / progress.durationMs < 0.9;
    return { video: undefined, label: resumable ? "Resume" : "Play" };
  }

  const target = seriesPlaybackTarget(meta, watchIndex);
  const first = target.video;
  return {
    video: first,
    label:
      target.kind === "resume"
        ? `Resume · ${videoCode(first)}`
        : target.kind === "next"
          ? `Next Up · ${videoCode(first)}`
          : first
            ? `Play · ${videoCode(first) || "Episode"}`
            : "Play",
  };
}

/** Best-effort browser-side palette extraction; cross-origin failures fall back safely. */
function backdropColor(url: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 18;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return resolve(DEFAULT_DETAIL_COLOR);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        let total = 0;
        for (let index = 0; index < pixels.length; index += 16) {
          const r = pixels[index]!;
          const g = pixels[index + 1]!;
          const b = pixels[index + 2]!;
          if (pixels[index + 3]! < 180) continue;
          const light = (r + g + b) / 3;
          if (light < 12 || light > 245) continue;
          const saturation = Math.max(r, g, b) - Math.min(r, g, b);
          const weight = 1 + saturation / 80;
          red += r * weight;
          green += g * weight;
          blue += b * weight;
          total += weight;
        }
        resolve(
          total
            ? `${Math.round(red / total)} ${Math.round(green / total)} ${Math.round(blue / total)}`
            : DEFAULT_DETAIL_COLOR,
        );
      } catch {
        resolve(DEFAULT_DETAIL_COLOR);
      }
    };
    image.onerror = () => resolve(DEFAULT_DETAIL_COLOR);
    image.src = url;
  });
}

function preloadImage(url: string, trace?: DetailsTrace, label = "Artwork"): Promise<void> {
  const endTiming = trace?.start(label, "download + decode (5s limit)");
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (status: TimingStatus = "done") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      endTiming?.(status);
      resolve();
    };
    const timer = window.setTimeout(() => finish("timeout"), 5_000);
    image.decoding = "async";
    image.onload = () => {
      if (typeof image.decode === "function") image.decode().then(() => finish(), () => finish("error"));
      else finish();
    };
    image.onerror = () => finish("error");
    image.src = url;
    if (image.complete) {
      if (typeof image.decode === "function") image.decode().then(() => finish(), () => finish("error"));
      else finish(image.naturalWidth ? "done" : "error");
    }
  });
}

async function prepareDetailLayout(meta: Meta, trace?: DetailsTrace): Promise<void> {
  const assets = [
    meta.background && preloadImage(meta.background, trace, "Backdrop image"),
    meta.logo && preloadImage(meta.logo, trace, "Title logo"),
  ].filter(Boolean);
  const fonts = new Promise<void>(resolve => {
    const end = trace?.start("Fonts ready", "2s limit");
    const timer = window.setTimeout(() => { end?.("timeout"); resolve(); }, 2_000);
    Promise.resolve(document.fonts?.ready).then(() => {
      window.clearTimeout(timer); end?.(); resolve();
    }, () => { window.clearTimeout(timer); end?.("error"); resolve(); });
  });
  await Promise.all([Promise.allSettled(assets), fonts]);
}

function afterDetailLayout(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function SourceBadges({
  stream,
  settings,
}: {
  stream: Stream;
  settings: StreamBadgeSettings;
}) {
  const [imported, setImported] = useState<StreamBadgeFilter[]>([]);
  useEffect(() => {
    let live = true;
    setImported([]);
    void matchBadges(stream, settings).then((badges) => { if (live) setImported(badges); });
    return () => { live = false; };
  }, [stream, settings]);
  const size = settings.showFileSizeBadges
    ? readableFileSize(stream.behaviorHints?.videoSize)
    : null;
  if (!imported.length && !size) return null;
  return (
    <div className="stream-badges">
      {imported.map((badge, index) => {
        const style = {
          "--badge-bg": badge.tagStyle?.toLowerCase() === "filled" ? browserColor(badge.tagColor || "", "transparent") : "transparent",
          "--badge-color": browserColor(badge.textColor || "", "#f4f6f7"),
          "--badge-border": browserColor(
            badge.borderColor || "",
            "#ffffff42",
          ),
        } as CSSProperties;
        return (
          <span
            key={badge.id || badge.imageURL || `${badge.name}:${index}`}
            className={`stream-badge ${badge.imageURL ? "image" : ""}`}
            style={style}
            title={badge.name}
          >
            {badge.imageURL ? (
              <img src={safeHttpUrl(badge.imageURL) || undefined} alt={badge.name || ""} />
            ) : (
              badge.name
            )}
          </span>
        );
      })}
      {size && <span className="stream-badge file-size">{size}</span>}
    </div>
  );
}

export function Details({
  seed,
  addons,
  metadataEnrichment,
  inLibrary,
  watchIndex,
  playerSettings,
  streamBadgeSettings,
  debridRules,
  metaScreenSettings,
  onClose,
  onLibrary,
  onPlay,
  onSetWatched,
  onResetProgress,
  initialVideoId,
  initialVideo,
  openSourcesOnLoad = false,
  defaultSourceAddon,
  defaultPlayer,
  onDefaultPlayer,
  onPerson,
}: {
  seed: Meta;
  addons: InstalledAddon[];
  metadataEnrichment: MetadataEnrichmentConfig;
  inLibrary: boolean;
  watchIndex: WatchIndex;
  playerSettings: WebPlayerSettings;
  streamBadgeSettings: StreamBadgeSettings;
  /** The synced Debrid rules, applied only where a shell can resolve them. */
  debridRules: DebridRules;
  metaScreenSettings: MetaScreenSettings;
  onClose(): void;
  onLibrary(meta: Meta): void;
  /**
   * `player` overrides the configured default for this one launch, which is
   * what the picker in the sources panel sets.
   */
  onPlay(
    stream: Stream,
    meta: Meta,
    video?: Video,
    player?: ExternalPlayerMode,
  ): void;
  onSetWatched(meta: Meta, video: Video | undefined, watched: boolean): void;
  /** Clears the resume point without touching the watched mark. */
  onResetProgress(meta: Meta, video: Video | undefined): void;
  initialVideoId?: string;
  initialVideo?: Video;
  openSourcesOnLoad?: boolean;
  /**
   * The addon the source list opens filtered to, or "" for all of them.
   * Chosen in Settings; the picker here still overrides it for this title.
   */
  defaultSourceAddon: string;
  /** The player chosen in Settings, which this picker also sets. */
  defaultPlayer: ExternalPlayerMode;
  onDefaultPlayer(mode: ExternalPlayerMode): void;
  /**
   * Opens a cast member's own page. Absent where the person page cannot work —
   * without TMDB there are no person ids to open with.
   */
  onPerson?(person: Person & { tmdbId: number }): void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; video: Video } | null>(
    null,
  );
  useScrollLock();
  const heroRef = useRef<HTMLDivElement>(null);
  const [compactHeader, setCompactHeader] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [meta, setMeta] = useState(seed);
  const description = useDescriptionOverflow(meta.description, descriptionExpanded);
  const [dominantColor, setDominantColor] = useState(DEFAULT_DETAIL_COLOR);
  const [selectedTrailerCategory, setSelectedTrailerCategory] = useState("");
  const [trailerOpen, setTrailerOpen] = useState(false);
  const initialSourceConsumed = useRef(false);
  const trailerGroups = useMemo(() => {
    const groups = new Map<string, Meta["trailers"]>();
    for (const trailer of meta.trailers) {
      const category = trailer.trailerType?.trim() || "Trailer";
      const rows = groups.get(category) ?? [];
      rows.push(trailer);
      groups.set(category, rows);
    }
    return groups;
  }, [meta.trailers]);
  const trailerCategories = [...trailerGroups.entries()];
  const initialTrailerCategory =
    trailerCategories.find(
      ([category]) => category.toLowerCase() === "trailer",
    )?.[0] ??
    trailerCategories[0]?.[0] ??
    "Trailer";
  const effectiveTrailerCategory = trailerGroups.has(selectedTrailerCategory)
    ? selectedTrailerCategory
    : initialTrailerCategory;
  const visibleTrailers =
    trailerGroups.get(effectiveTrailerCategory) ?? meta.trailers;
  const metaSections = useMemo(
    () => new Map(metaScreenSettings.items.map((item) => [item.key, item])),
    [metaScreenSettings.items],
  );
  const sectionEnabled = (key: MetaScreenSectionKey) =>
    metaSections.get(key)?.enabled !== false;
  const sectionOrder = (key: MetaScreenSectionKey) =>
    metaSections.get(key)?.order ?? 0;
  const heroPlayback = useMemo(
    () => playbackTarget(meta, watchIndex),
    [meta, watchIndex],
  );
  const watchIndexRef = useRef(watchIndex);
  watchIndexRef.current = watchIndex;
  const heroTargetWatched = watchIndex.watched.has(
    watchKey(
      meta.id,
      heroPlayback.video?.season,
      heroPlayback.video?.episode,
    ),
  );
  const [busy, setBusy] = useState(true);
  const [debugTraces, setDebugTraces] = useState<DetailsTrace[]>([]);
  // Fetched once per series and cached, so paging through seasons asks nobody.
  // Empty until it answers, and empty forever if it cannot — a score is
  // decoration and the list has to render without one.
  const [episodeRatings, setEpisodeRatings] = useState<EpisodeRatings>(
    () => new Map(),
  );
  const [sourceOpen, setSourceOpen] = useState(false);
  // The sources panel is drawn inside this overlay, so the back gesture has to
  // stand down while it is up: a swipe there would otherwise carry both away
  // at once. The panel closes with its own X.
  const swipeRef = useSwipeBack<HTMLDivElement>(onClose, !sourceOpen);
  // The cast row pans by drag on desktop, like the catalog rows.
  const castRef = useDragScroll<HTMLDivElement>();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [sourceBusy, setSourceBusy] = useState(false);
  /**
   * Addons still outstanding after the first results have painted.
   *
   * `sourceBusy` now means "nothing has arrived yet", so it clears the moment
   * the first addon answers — which left a slower one arriving into silence,
   * indistinguishable from an addon that had simply failed.
   */
  const [sourcesPending, setSourcesPending] = useState(false);
  /** Addons that have finished, by name — including those that found nothing. */
  const [answered, setAnswered] = useState<string[]>([]);
  // Cleared by the next attempt rather than a timer: the answer belongs to
  // the source that was clicked.
  const [downloadNote, setDownloadNote] = useState("");
  // Which row was just saved, so the answer appears on the control that was
  // pressed. A queued download shows nothing for seconds otherwise, and a
  // button that looks inert gets pressed again.
  const [savedSource, setSavedSource] = useState<number | null>(null);
  // Right-click on a source. The copy and download actions used to sit on every
  // row as visible buttons, which made a list of twenty sources three times as
  // busy as the choice it exists to present.
  const [sourceMenu, setSourceMenu] = useState<{
    stream: Stream;
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const [sourceVideo, setSourceVideo] = useState<Video | undefined>();
  /** "" is every addon. Starts at the configured default. */
  const [sourceAddon, setSourceAddon] = useState(defaultSourceAddon);
  /**
   * Every addon that will be asked, not only those that have answered.
   *
   * Derived from the manifests rather than from the results, so the picker is
   * complete the moment the sheet opens. Built from `streams` it appeared to
   * gain options as slow addons landed, and until the second one arrived there
   * was no picker at all.
   */
  const sourceAddons = useMemo(
    () =>
      addons
        .filter(
          (addon) =>
            addon.enabled &&
            addon.manifest &&
            supports(addon.manifest, "stream", meta.type),
        )
        .map((addon) => addon.manifest!.name)
        .filter(Boolean),
    [addons, meta.type],
  );
  /** Named in the footer, so a slow scraper is visibly still working. */
  const pendingAddons = useMemo(
    () => sourceAddons.filter((name) => !answered.includes(name)),
    [sourceAddons, answered],
  );
  /**
   * The filter actually in force.
   *
   * An addon that returned nothing for this title is not a filter, it is an
   * empty screen — and a default addon is chosen once for everything, so it
   * will not have answered for everything. Falling back to all sources means a
   * default can never hide the ones that did arrive.
   */
  const activeAddon =
    sourceAddon && sourceAddons.includes(sourceAddon) ? sourceAddon : "";
  const visibleStreams = useMemo(
    () =>
      activeAddon
        ? streams.filter((item) => item.addonName === activeAddon)
        : streams,
    [streams, activeAddon],
  );
  /** Where this would resume from, which is the useful thing to say up here. */
  const sourceResume = useMemo(() => {
    const row = watchIndex.progress.get(
      watchKey(meta.id, sourceVideo?.season, sourceVideo?.episode),
    );
    if (!row?.positionMs || row.positionMs < 15_000) return "";
    if (row.durationMs && row.positionMs / row.durationMs > 0.95) return "";
    const total = Math.floor(row.positionMs / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = (value: number) => String(value).padStart(2, "0");
    return hours
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${minutes}:${pad(seconds)}`;
  }, [watchIndex, meta.id, sourceVideo]);
  /**
   * The player everything opens in, changed from here as readily as from
   * Settings. It was reset each time the panel opened, on the reasoning that
   * one awkward source should not redecide everything — but choosing a player
   * and finding it forgotten by the next episode is the worse surprise.
   */
  const sheetPlayer = defaultPlayer;
  const autoPlayTimer = useRef<number | undefined>(undefined);
  const sourceRequest = useRef(0);
  const sourceAbort = useRef<AbortController | null>(null);
  const sourceOpenRef = useRef(sourceOpen);
  sourceOpenRef.current = sourceOpen;
  useEffect(() => () => {
    window.clearTimeout(autoPlayTimer.current);
    sourceAbort.current?.abort();
  }, []);
  useEffect(() => {
    const scroller = swipeRef.current;
    const hero = heroRef.current;
    if (!scroller || !hero) return;
    // Queried once and kept, rather than per scroll event. `matchMedia` and
    // `offsetTop` both read layout, and doing that on every frame of a fling
    // is work the phone spends where it can least afford to.
    const viewport = window.matchMedia("(max-width: 760px)");
    let threshold = 0;
    const measure = () => {
      threshold = viewport.matches
        ? hero.offsetTop + window.innerHeight * 0.62
        : hero.offsetTop + hero.offsetHeight - 84;
    };
    const update = () => setCompactHeader(scroller.scrollTop >= threshold);
    const remeasure = () => {
      measure();
      update();
    };
    remeasure();
    scroller.addEventListener("scroll", update, { passive: true });
    viewport.addEventListener("change", remeasure);
    const observer = new ResizeObserver(remeasure);
    observer.observe(hero);
    return () => {
      scroller.removeEventListener("scroll", update);
      viewport.removeEventListener("change", remeasure);
      observer.disconnect();
    };
  }, [meta.id, swipeRef]);
  useEffect(() => setDescriptionExpanded(false), [meta.id]);
  useEffect(() => {
    if (meta.type !== "series") return;
    let live = true;
    setEpisodeRatings(new Map());
    // The service files these under TMDB's id, so the show's id is resolved
    // first — through the same cache metadata enrichment already fills, so a
    // title it has enriched costs no extra lookup.
    void tmdbIdForMeta(meta, metadataEnrichment.tmdb)
      .then((tmdbId) => (tmdbId ? loadEpisodeRatings(tmdbId) : new Map()))
      .then((ratings) => {
        if (live) setEpisodeRatings(ratings as EpisodeRatings);
      });
    return () => {
      live = false;
    };
  }, [meta, meta.id, meta.type, metadataEnrichment.tmdb]);

  useEffect(() => {
    initialSourceConsumed.current = false;
  }, [seed.id, initialVideoId, openSourcesOnLoad]);
  const seasons = useMemo(
    () =>
      [...new Set(meta.videos.map((video) => video.season ?? 0))].sort(
        (a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b),
      ),
    [meta],
  );
  const regularSeasonCount = seasons.filter((value) => value > 0).length;
  const [season, setSeason] = useState<number | undefined>();
  /**
   * The selected season's own cast, where TMDB has one.
   *
   * Null means "nothing of its own" — no season credits, a film, or TMDB off —
   * and the show-level cast is shown instead.
   */
  const [seasonCast, setSeasonCast] = useState<Person[] | null>(null);
  useEffect(() => {
    if (meta.type !== "series" || season == null || season <= 0) {
      setSeasonCast(null);
      return;
    }
    let live = true;
    // Not cleared first: the previous season's list stays until the new one
    // arrives, so moving between seasons does not blink the row empty.
    void tmdbIdForMeta(meta, metadataEnrichment.tmdb)
      .then((tmdbId) =>
        tmdbId ? loadSeasonCast(tmdbId, season, metadataEnrichment.tmdb) : [],
      )
      .then((cast) => {
        if (live) setSeasonCast(cast.length ? cast : null);
      })
      .catch(() => live && setSeasonCast(null));
    return () => {
      live = false;
    };
  }, [meta, meta.type, season, metadataEnrichment.tmdb]);
  /**
   * The season's cast where it has one, otherwise the show's.
   *
   * Merged the same way the show's own cast is, so a season list from TMDB
   * still picks up anything the addon knew — and so the two paths cannot drift
   * into showing different things about the same person.
   */
  const castForSeason = useMemo(
    () => (seasonCast ? mergeCast(seasonCast, meta.cast) : meta.cast),
    [seasonCast, meta.cast],
  );
  /**
   * Painted in slices, like the catalog rows.
   *
   * Changing the season replaces the whole cast row, and committing every card
   * in the same pass as the episode list left the page unresponsive for
   * seconds on a phone. The source lists are bounded now too, but this is what
   * makes the row's cost independent of how long any of them turn out to be.
   */
  const { visible: visibleCast } = useProgressiveList(castForSeason, {
    resetKey: `${meta.id}:${season ?? ""}`,
    first: 12,
    chunk: 12,
  });
  useEffect(() => {
    // The list above restarts at twelve cards when the season changes, but the
    // row keeps whatever it was scrolled to — which lands you past the end of
    // the new list, looking at nothing.
    if (castRef.current) castRef.current.scrollLeft = 0;
  }, [season, castRef]);
  const [episodeQuery, setEpisodeQuery] = useState("");
  const visibleEpisodes = useMemo(() => {
    const query = episodeQuery.trim().toLocaleLowerCase();
    return meta.videos.filter((video) => {
      if ((video.season ?? 0) !== season) return false;
      if (!query) return true;
      return [
        video.title,
        video.overview,
        `episode ${video.episode ?? ""}`,
        `s${video.season ?? 0}e${video.episode ?? ""}`,
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }, [episodeQuery, meta.videos, season]);
  useEffect(() => {
    let live = true;
    if (
      metaScreenSettings.backgroundMode !== "dominant_color" ||
      !meta.background
    ) {
      setDominantColor(DEFAULT_DETAIL_COLOR);
      return () => {
        live = false;
      };
    }
    void backdropColor(meta.background).then((color) => {
      if (live) setDominantColor(color);
    });
    return () => {
      live = false;
    };
  }, [meta.background, metaScreenSettings.backgroundMode]);
  useEffect(() => {
    let live = true;
    setBusy(true);
    const trace = detailsDebugEnabled() ? new DetailsTrace(seed.name) : undefined;
    // Settings/addons arriving can restart the effect. Retain those attempts
    // so their elapsed time does not disappear from the diagnostic report.
    setDebugTraces(current => trace ? [...current, trace].slice(-5) : []);
    void (async () => {
      let completed = seed;
      try {
        const next = await timed(trace, "Stage: addon metadata", () => resolveMeta(seed, addons, trace));
        if (!live) return;
        // Build the final object while the fixed entry overlay is still up.
        // This prevents addon metadata and integration enrichment from being
        // exposed as two visibly different layouts.
        completed = await timed(trace, "Stage: metadata enrichment", () =>
          enrichMetadata(next, metadataEnrichment, trace, (withRatings) => {
            // Ratings that arrived after the page was shown. Merged rather than
            // replacing, because by now the user may have opened a season and
            // the rest of this object is the same one they are looking at.
            if (!live) return;
            setMeta((current) =>
              current && current.id === withRatings.id
                ? { ...current, externalRatings: withRatings.externalRatings }
                : current,
            );
          }),
        ).catch(() => next);
      } catch {
        // The seed is still a useful details page when an addon is unavailable.
      }
      if (!live) return;

      // CSS backgrounds and logos otherwise continue decoding after the data
      // loader disappears. Warm them before committing the completed page.
      await timed(trace, "Stage: artwork and fonts", () => prepareDetailLayout(completed, trace));
      if (!live) return;
      setMeta(completed);
      const first = [
        ...new Set(completed.videos.map((video) => video.season ?? 0)),
      ].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b))[0];
      const selected = completed.videos.find(
        (video) => video.id === seed.selectedVideoId,
      );
      const currentEpisode = seriesPlaybackTarget(
        { ...completed, selectedVideoId: seed.selectedVideoId },
        watchIndexRef.current,
      ).video;
      setSeason(currentEpisode?.season ?? selected?.season ?? first);

      // Keep the overlay for two paints after committing. At this point the
      // actual DOM exists, fonts have settled, and layout measurements used by
      // the compact mobile header have run before the user sees the page.
      await timed(trace, "Stage: DOM layout (two frames)", afterDetailLayout);
      if (live) { trace?.finish(); setBusy(false); }
    })();
    return () => {
      live = false;
      if (trace?.ended === undefined) trace?.cancel();
    };
  }, [seed, addons, metadataEnrichment]);
  /**
   * The touch half of the source menu.
   *
   * `useLongPress` is a hook and the rows are a `map`, so it cannot be called
   * per row. One timer at this level is enough regardless: only one finger is
   * ever down, and the row it belongs to is captured in the closure.
   */
  const holdTimer = useRef<number | null>(null);
  const holdOrigin = useRef<{ x: number; y: number } | null>(null);
  const holdFired = useRef(false);
  const cancelHold = () => {
    if (holdTimer.current != null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    holdOrigin.current = null;
  };
  const sourceHold = (stream: Stream, index: number) => ({
    onTouchStart(event: React.TouchEvent) {
      const touch = event.touches[0];
      if (!touch || !stream.url) return;
      holdFired.current = false;
      holdOrigin.current = { x: touch.clientX, y: touch.clientY };
      holdTimer.current = window.setTimeout(() => {
        holdFired.current = true;
        setSourceMenu({ stream, index, x: touch.clientX, y: touch.clientY });
      }, 450);
    },
    onTouchMove(event: React.TouchEvent) {
      const touch = event.touches[0];
      const start = holdOrigin.current;
      if (!touch || !start) return;
      // Scrolling the list must never open a menu.
      if (
        Math.abs(touch.clientX - start.x) + Math.abs(touch.clientY - start.y) >
        12
      )
        cancelHold();
    },
    onTouchEnd(event: React.TouchEvent) {
      if (holdFired.current) event.preventDefault();
      cancelHold();
    },
    onTouchCancel: cancelHold,
  });

  /** One stream, queued against one episode. */
  function queueDownload(stream: Stream, video: Video | undefined) {
    return platform.downloads!.enqueue({
      contentId: meta.id,
      contentType: meta.type,
      videoId: video?.id ?? meta.id,
      title: video?.title || meta.name,
      showName: meta.type === "series" ? meta.name : undefined,
      season: video?.season,
      episode: video?.episode,
      posterUrl: meta.poster,
      backdropUrl: meta.background || meta.banner,
      url: stream.url!,
      requestHeaders: stream.behaviorHints?.proxyHeaders?.request,
      sourceName: stream.name || stream.title || stream.addonName,
      filename: stream.behaviorHints?.filename,
    });
  }

  /**
   * Every episode of the season the chosen source belongs to.
   *
   * Each episode is resolved on its own, because a source for episode 1 is not
   * a source for episode 2 — the URL is per-file. What carries across is the
   * binge group: the addon and quality the user just picked. Episodes without a
   * match in that group fall back to the first playable source rather than being
   * skipped, so "download the season" returns the season and not a subset of it.
   */
  async function queueSeason(seed: Stream, video: Video | undefined) {
    const season = video?.season;
    if (season == null) return;
    const episodes = meta.videos
      .filter((item) => item.season === season)
      .sort((left, right) => (left.episode ?? 0) - (right.episode ?? 0));
    const group = seed.behaviorHints?.bingeGroup;
    let queued = 0;
    let failed = 0;
    for (const episode of episodes) {
      setDownloadNote(
        `Finding sources — episode ${episode.episode ?? "?"} of ${episodes.length}…`,
      );
      try {
        // The already-open episode does not need looking up again.
        const available =
          episode.id === video?.id
            ? [seed, ...streams]
            : await loadStreams(meta.type, episode.id, addons).catch(() => []);
        const choice =
          available.find(
            (item) => item.url && item.behaviorHints?.bingeGroup === group,
          ) ?? available.find((item) => item.url);
        if (!choice) {
          failed += 1;
          continue;
        }
        await queueDownload(choice, episode);
        queued += 1;
      } catch {
        failed += 1;
      }
    }
    setDownloadNote(
      queued
        ? `Queued ${queued} episode${queued === 1 ? "" : "s"}${
            failed ? `, ${failed} had no source` : ""
          }.`
        : "No episodes could be queued.",
    );
  }

  /** The cache key for what `sources` was opened on. */
  const reuseKey = (video?: Video) =>
    contentKey(meta.type, video?.id || meta.id, meta.id, video?.season, video?.episode);

  /**
   * Plays a stream the user (or autoplay) just chose, and remembers it.
   *
   * Only fresh picks are recorded. Replaying from the cache goes straight to
   * `onPlay`, so an entry ages from when the source was resolved rather than
   * being renewed every time it is reused — otherwise "reuse for 24 hours"
   * would quietly mean "forever, as long as you keep watching".
   */
  function playFresh(stream: Stream, video?: Video, player?: ExternalPlayerMode) {
    saveStreamLink(reuseKey(video), stream);
    onPlay(stream, meta, video, player);
  }

  async function sources(video?: Video, forceManual = false) {
    // A series ID is not an episode ID. Never ask addons for a whole-series
    // source list while the selected episode is still missing its metadata.
    if (meta.type === "series" && !video) return;
    // Reuse last stream: play the link this episode was last watched with
    // rather than asking the addon — and, for a debrid source, resolving it
    // again — for something already known. `forceManual` is how the user asks
    // for the picker regardless, so it opts out of this.
    if (!forceManual && playerSettings.reuseLastStream) {
      const cached = getValidStreamLink(
        reuseKey(video),
        playerSettings.reuseLastStreamHours * 3_600_000,
      );
      if (cached) {
        onPlay(cachedStreamToSource(cached), meta, video);
        return;
      }
    }
    window.clearTimeout(autoPlayTimer.current);
    autoPlayTimer.current = undefined;
    sourceAbort.current?.abort();
    const request = ++sourceRequest.current;
    const controller = new AbortController();
    sourceAbort.current = controller;
    setSourceVideo(video);
    setSourceOpen(true);
    setSourceBusy(true);
    setSourcesPending(true);
    setAnswered([]);
    setStreams([]);
    let latestAutoStreams: Stream[] = [];
    let autoWaitExpired = playerSettings.autoPlayTimeoutSeconds === 0;
    let autoSelected = false;
    const scheduleAutoPlay = (available: Stream[], complete = false) => {
      latestAutoStreams = available;
      if (forceManual || autoSelected || controller.signal.aborted || request !== sourceRequest.current || (!complete && !autoWaitExpired)) return;
      const choice = selectAutoStream(available, playerSettings,
        addons.map((addon) => addon.manifest?.name || addon.name || ""), bingeGroupFor(meta.id));
      if (!choice) return;
      autoSelected = true;
      window.clearTimeout(autoPlayTimer.current);
      setSourceOpen(false);
      playFresh(choice, video);
    };
    if (!forceManual && playerSettings.autoPlayMode !== "MANUAL" && playerSettings.autoPlayTimeoutSeconds < 2147483647) {
      autoPlayTimer.current = window.setTimeout(() => {
        if (!sourceOpenRef.current) return;
        autoWaitExpired = true;
        scheduleAutoPlay(latestAutoStreams);
      }, playerSettings.autoPlayTimeoutSeconds * 1000);
    }

    // Start plugins concurrently, but never make ordinary addon results wait
    // for them. Browser-only providers commonly hit CORS or host timeouts.
    const pluginStreamsTask = Promise.resolve([] as Stream[]);

    let addonStreams: Stream[] = [];
    try {
      addonStreams = await loadStreams(
          meta.type,
          video?.id || meta.id,
          addons,
          controller.signal,
          // Paint progressively, but in installed-addon order (including
          // separately configured addons that share the same display name).
          (addonName, _batch, ordered) => {
            if (request !== sourceRequest.current || controller.signal.aborted)
              return;
            setAnswered((current) => [...current, addonName]);
            setStreams(
              platform.debrid && debridRules
                ? applyDebridStreamSettings(ordered, debridRules)
                : ordered,
            );
            setSourceBusy(false);
            scheduleAutoPlay(platform.debrid && debridRules ? applyDebridStreamSettings(ordered, debridRules) : ordered);
          },
        ).catch(() => []);
      if (request !== sourceRequest.current || controller.signal.aborted) return;
      // Debrid entries are filtered and sorted by the rules the account carries,
      // but only where a shell can actually resolve them. In a browser they are
      // left exactly as the addon sent them, because nothing here could play
      // one either way and quietly reordering a list we cannot use would be
      // worse than leaving it alone.
      addonStreams =
        platform.debrid && debridRules
          ? applyDebridStreamSettings(addonStreams, debridRules)
          : addonStreams;
      setStreams(addonStreams);
      scheduleAutoPlay(addonStreams, true);
    } finally {
      if (request === sourceRequest.current) {
        setSourceBusy(false);
        setSourcesPending(false);
      }
    }

    const pluginStreams = await pluginStreamsTask;
    if (request !== sourceRequest.current || controller.signal.aborted) return;
    const combined = [...addonStreams, ...pluginStreams];
    setStreams(combined);
    scheduleAutoPlay(combined);
  }
  useEffect(() => {
    if (busy || !openSourcesOnLoad || initialSourceConsumed.current) return;
    const video = initialVideoId
      ? meta.videos.find((entry) => entry.id === initialVideoId) ?? initialVideo
      : undefined;
    initialSourceConsumed.current = true;
    void sources(video, true);
  }, [busy, initialVideoId, initialVideo, meta, openSourcesOnLoad]);
  return (
    <div
      className={`detail-view background-${metaScreenSettings.backgroundMode}${sourceOpen ? " has-sheet" : ""}${compactHeader ? " has-compact-header" : ""}${busy ? " is-loading" : ""}${trailerOpen ? " has-trailer-panel" : ""}${meta.type === "series" && sectionEnabled("EPISODES") ? " has-episode-panel" : ""}`}
      ref={swipeRef}
      style={{ "--detail-dominant": dominantColor } as CSSProperties}
      aria-busy={busy}
    >
      {debugTraces.length > 0 && <DetailsDebugPanel traces={debugTraces} />}
      <div
        className={`detail-entry-overlay${busy ? " is-visible" : ""}`}
        aria-hidden={!busy}
      >
        <button
          className="circle-button back"
          onClick={onClose}
          aria-label="Back"
          tabIndex={busy ? 0 : -1}
        >
          <ArrowLeft />
        </button>
        <div className="detail-entry-loading-content" role="status">
          <i className="mini-spinner" aria-hidden="true" />
          <span>Loading details…</span>
        </div>
      </div>
      {meta.background && metaScreenSettings.backgroundMode === "cinematic" && (
        <span
          className="detail-page-backdrop"
          aria-hidden="true"
          style={{
            backgroundImage: `linear-gradient(0deg, #080a0df5, #080a0d70 55%, #080a0d25), url("${meta.background.replace(/"/g, "%22")}")`,
          }}
        />
      )}
      <button className="circle-button back" onClick={onClose}>
        <ArrowLeft />
      </button>
      <header className="mobile-detail-header" aria-hidden={!compactHeader}>
        <button className="circle-button" onClick={onClose} aria-label="Back">
          <ArrowLeft />
        </button>
        <div className="mobile-detail-identity">
          {meta.logo ? (
            <img src={meta.logo} alt={meta.name} />
          ) : (
            <strong>{meta.name}</strong>
          )}
        </div>
        <button
          className="mobile-detail-library"
          aria-label={inLibrary ? "Remove from library" : "Add to library"}
          aria-pressed={inLibrary}
          onClick={() => onLibrary(meta)}
        >
          {inLibrary ? <Check /> : <Plus />}
        </button>
      </header>
      <div
        className="detail-hero"
        ref={heroRef}
        style={
          meta.background
            ? {
                "--detail-backdrop": `url("${meta.background.replace(/"/g, "%22")}")`,
                backgroundImage: `linear-gradient(90deg, rgba(5,7,9,.98), rgba(5,7,9,.38)), linear-gradient(0deg, ${metaScreenSettings.backgroundMode === "dominant_color" ? "rgb(var(--detail-dominant))" : metaScreenSettings.backgroundMode === "cinematic" ? "rgba(8,10,13,.2)" : "#080a0d"}, transparent 60%), url("${meta.background.replace(/"/g, "%22")}")`,
              } as CSSProperties
            : undefined
        }
      >
        <div className="detail-copy">
          {meta.logo ? (
            <img className="detail-logo" src={meta.logo} alt={meta.name} />
          ) : (
            <h1>{meta.name}</h1>
          )}
          <div className="detail-statistics">
            <div className="hero-meta">
              <span>{meta.releaseInfo}</span>
              {meta.type === "series" && regularSeasonCount > 0 && (
                <span>
                  {regularSeasonCount}{" "}
                  {regularSeasonCount === 1 ? "Season" : "Seasons"}
                </span>
              )}
              <span>{meta.runtime}</span>
              {meta.ageRating && (
                <span className="detail-age-rating">{meta.ageRating}</span>
              )}
            </div>
            {(meta.imdbRating || meta.externalRatings.length > 0) && (
              <DetailsRatings meta={meta} />
            )}
          </div>
          <div className="detail-description">
            <p ref={description.ref} className={descriptionExpanded ? "is-expanded" : undefined}>
              {meta.description}
            </p>
            {description.overflows && (
              <button
                type="button"
                aria-expanded={descriptionExpanded}
                onClick={() => setDescriptionExpanded((expanded) => !expanded)}
              >
                {descriptionExpanded ? "Show Less ▴" : "Show More ▾"}
              </button>
            )}
          </div>
          <div className="chips">
            {meta.genres.map((genre) => (
              <span key={genre}>{genre}</span>
            ))}
          </div>
          <div className="detail-actions">
            <button
              className="primary"
              onClick={() => sources(heroPlayback.video)}
            >
              <Play size={18} fill="currentColor" />{" "}
              <span>{heroPlayback.label}</span>
            </button>
            <button
              className={`icon-pill${inLibrary ? " active" : ""}`}
              title={inLibrary ? "Remove from library" : "Add to library"}
              aria-label={inLibrary ? "Remove from library" : "Add to library"}
              aria-pressed={inLibrary}
              onClick={() => onLibrary(meta)}
            >
              {inLibrary ? <Check size={22} /> : <Plus size={22} />}
            </button>
            {meta.type !== "series" && (
              <button
                className={`icon-pill${heroTargetWatched ? " active" : ""}`}
                title={heroTargetWatched ? "Mark as unwatched" : "Mark as watched"}
                aria-label={heroTargetWatched ? "Mark as unwatched" : "Mark as watched"}
                aria-pressed={heroTargetWatched}
                onClick={() =>
                  onSetWatched(meta, heroPlayback.video, !heroTargetWatched)
                }
              >
                {heroTargetWatched ? <EyeOff size={22} /> : <Eye size={22} />}
              </button>
            )}
            {sectionEnabled("TRAILERS") && meta.trailers.length > 0 && (
              <button
                className="icon-pill desktop-video-action"
                title="Trailers and extras"
                aria-label="Open trailers and extras"
                aria-expanded={trailerOpen}
                onClick={() => setTrailerOpen(true)}
              >
                <VideoGlyph size={19} />
              </button>
            )}
          </div>
          {((sectionEnabled("PRODUCTION") &&
            (meta.director.length > 0 || meta.writer.length > 0)) ||
            (sectionEnabled("DETAILS") &&
              (meta.language ||
                meta.status))) && (
              <div className="mobile-hero-credits">
                {sectionEnabled("PRODUCTION") && meta.director.length > 0 && (
                  <p className="mobile-credit-wide">
                    <strong>Director:</strong> {meta.director.join(", ")}
                  </p>
                )}
                {sectionEnabled("PRODUCTION") && meta.writer.length > 0 && (
                  <p className="mobile-credit-wide">
                    <strong>Writer:</strong> {meta.writer.join(", ")}
                  </p>
                )}
                {sectionEnabled("DETAILS") && meta.language && (
                  <p><strong>Language:</strong> {meta.language}</p>
                )}
                {sectionEnabled("DETAILS") && meta.status && (
                  <p><strong>Status:</strong> {meta.status}</p>
                )}
              </div>
            )}
        </div>
      </div>
      <div className="detail-sections">
      {((sectionEnabled("PRODUCTION") &&
        (meta.director.length > 0 || meta.writer.length > 0)) ||
        (sectionEnabled("DETAILS") &&
          (meta.language ||
            meta.status))) && (
        <section
          className="detail-credits detail-overview-meta"
          style={{
            order: Math.min(
              sectionOrder("PRODUCTION"),
              sectionOrder("DETAILS"),
              sectionOrder("CAST") - 0.5,
            ),
          }}
        >
          {sectionEnabled("PRODUCTION") && meta.director.length > 0 && (
            <div>
              <span className="eyebrow">DIRECTOR</span>
              <strong>{meta.director.join(", ")}</strong>
            </div>
          )}
          {sectionEnabled("PRODUCTION") && meta.writer.length > 0 && (
            <div>
              <span className="eyebrow">WRITER</span>
              <strong>{meta.writer.join(", ")}</strong>
            </div>
          )}
          {sectionEnabled("DETAILS") && meta.language && (
            <div><span className="eyebrow">LANGUAGE</span><strong>{meta.language}</strong></div>
          )}
          {sectionEnabled("DETAILS") && meta.status && (
            <div><span className="eyebrow">STATUS</span><strong>{meta.status}</strong></div>
          )}
        </section>
      )}
      {sectionEnabled("EPISODES") && meta.type === "series" && (
        <section
          className="episodes"
          style={{ order: sectionOrder("EPISODES") }}
        >
          <header>
            <div>
              <span className="eyebrow">EPISODES</span>
              <h2>{meta.name}</h2>
            </div>
            <label className="season-select-wrap">
              <span>SEASON</span>
              <select
                value={season ?? ""}
                onChange={(event) => {
                  setSeason(Number(event.target.value));
                  setEpisodeQuery("");
                }}
              >
                {seasons.map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? "Specials" : `Season ${value}`}
                  </option>
                ))}
              </select>
            </label>
          </header>
          <label className="episode-search">
            <Search size={19} />
            <input
              value={episodeQuery}
              onChange={(event) => setEpisodeQuery(event.target.value)}
              placeholder="Search this season"
            />
          </label>
          <div className="episode-list-heading">
            <strong>{season === 0 ? "Specials" : `Season ${season ?? seasons[0] ?? 1}`}</strong>
            <span>{visibleEpisodes.length} {visibleEpisodes.length === 1 ? "episode" : "episodes"}</span>
          </div>
          <div className={`episode-list is-${metaScreenSettings.episodeCardStyle}`}>
            {visibleEpisodes.map((video) => (
                <EpisodeRow
                  key={video.id}
                  video={video}
                  rating={episodeRatings.get(`${video.season}:${video.episode}`)}
                  watched={watchIndex.watched.has(
                    watchKey(meta.id, video.season, video.episode),
                  )}
                  percent={episodePercent(
                    watchIndex,
                    watchKey(meta.id, video.season, video.episode),
                  )}
                  remaining={remainingShort(
                    watchIndex,
                    watchKey(meta.id, video.season, video.episode),
                  )}
                  blurred={
                    metaScreenSettings.blurUnwatchedEpisodes &&
                    !watchIndex.watched.has(
                      watchKey(meta.id, video.season, video.episode),
                    )
                  }
                  onPlay={() => sources(video)}
                  onMenu={(x, y) => setMenu({ x, y, video })}
                />
              ))}
          </div>
        </section>
      )}
      {sectionEnabled("CAST") && castForSeason.length > 0 && (
        <section className="cast" style={{ order: sectionOrder("CAST") }}>
          {/* The eyebrow says what this is; a heading under it only repeated
              itself. The season rides along here so a changed list is still
              accounted for. */}
          <span className="eyebrow">
            {seasonCast ? `CAST · SEASON ${season}` : "CAST"}
          </span>
          <div ref={castRef}>
            {visibleCast.map((person, index) => {
              const body = (
                <>
                  {person.photo ? (
                    <img src={person.photo} alt="" loading="lazy" />
                  ) : (
                    // Named rather than matched by position: the photo has been
                    // wrapped once already, and every `> span` selector aimed at
                    // it silently stopped applying when it was.
                    <span className="cast-fallback">
                      {person.name.slice(0, 1)}
                    </span>
                  )}
                  <strong>{person.name}</strong>
                  <small>{person.role}</small>
                </>
              );
              // Only openable where there is something to open with. Cast
              // arrives from TMDB enrichment, so a build without a TMDB key has
              // no ids and the card stays what it always was — the affordance
              // is absent rather than present and broken.
              return onPerson && person.tmdbId ? (
                <article key={`${person.name}:${index}`}>
                  <button
                    className="cast-open"
                    onClick={() =>
                      onPerson({ ...person, tmdbId: person.tmdbId as number })
                    }
                    aria-label={`Browse ${person.name}`}
                  >
                    {body}
                  </button>
                </article>
              ) : (
                <article key={`${person.name}:${index}`}>{body}</article>
              );
            })}
          </div>
        </section>
      )}
      {sectionEnabled("TRAILERS") && meta.trailers.length > 0 && (
        <>
        {trailerOpen && (
          <button
            className="detail-trailer-backdrop"
            aria-label="Close trailers"
            onClick={() => setTrailerOpen(false)}
          />
        )}
        <section
          className={`detail-trailers${trailerOpen ? " is-open" : ""}`}
          style={{ order: sectionOrder("TRAILERS") }}
        >
          <div className="detail-trailer-panel-head">
            <span className="eyebrow">VIDEOS</span>
            <button
              className="circle-button trailer-panel-close"
              aria-label="Close trailers"
              onClick={() => setTrailerOpen(false)}
            ><X /></button>
          </div>
          <div className="detail-trailer-heading">
            <h2>Trailers</h2>
            {trailerCategories.length > 0 && (
              <label className="detail-trailer-category">
                <select
                  aria-label="Video category"
                  value={effectiveTrailerCategory}
                  onChange={(event) =>
                    setSelectedTrailerCategory(event.target.value)
                  }
                >
                  {trailerCategories.map(([category, rows]) => (
                    <option key={category} value={category}>
                      {category} ({rows.length})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="detail-trailer-grid">
            {visibleTrailers.slice(0, 18).map((trailer) => {
              const youtube =
                !trailer.site || trailer.site.toLowerCase() === "youtube";
              const href = youtube
                ? `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}`
                : safeHttpUrl(trailer.key);
              if (!href) return null;
              return (
                <a
                  key={trailer.id || trailer.key}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>
                    {youtube && (
                      <img
                        src={`https://i.ytimg.com/vi/${encodeURIComponent(trailer.key)}/hqdefault.jpg`}
                        alt=""
                        loading="lazy"
                      />
                    )}
                    <Play fill="currentColor" />
                  </span>
                  <strong>{trailer.displayName || trailer.name}</strong>
                  <small>{trailer.trailerType}</small>
                </a>
              );
            })}
          </div>
        </section>
        </>
      )}
      </div>
      {menu &&
        (() => {
          const key = watchKey(meta.id, menu.video.season, menu.video.episode);
          const isWatched = watchIndex.watched.has(key);
          // Only where a resume point is actually stranded. Never started,
          // there is nothing to reset; finished, "Mark as unwatched" already
          // clears the row, and two entries doing one thing is worse than one.
          const percent = episodePercent(watchIndex, key);
          const partWatched = percent > 0 && percent < 90;
          return (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              onClose={() => setMenu(null)}
              items={[
                {
                  label: isWatched ? "Mark as unwatched" : "Mark as watched",
                  icon: isWatched ? <EyeOff size={16} /> : <Eye size={16} />,
                  onSelect: () => onSetWatched(meta, menu.video, !isWatched),
                },
                ...(partWatched
                  ? [
                      {
                        label: "Reset progress",
                        icon: <RotateCcw size={16} />,
                        // It throws away where you were, and there is no undo.
                        danger: true,
                        onSelect: () => onResetProgress(meta, menu.video),
                      },
                    ]
                  : []),
                {
                  label: "Play",
                  icon: <Play size={16} />,
                  onSelect: () => sources(menu.video),
                },
              ]}
            />
          );
        })()}
      {sourceOpen && (
        <div
          className="sheet-backdrop"
          onClick={() => {
            window.clearTimeout(autoPlayTimer.current);
            sourceAbort.current?.abort();
            sourceRequest.current += 1;
            setSourceOpen(false);
          }}
        >
          <section
            className="source-sheet"
            onClick={(event) => event.stopPropagation()}
            style={
              meta.background
                ? ({
                    "--source-art": `url("${meta.background.replace(/"/g, "%22")}")`,
                  } as CSSProperties)
                : undefined
            }
          >
            {/* What you are choosing a source for. Desktop only: on a phone the
                list needs the whole screen, and the title bar above already
                says which episode this is. */}
            <div className="source-stage" aria-hidden="true">
              {meta.logo ? (
                <img src={meta.logo} className="title-logo" alt="" />
              ) : (
                <h2>{meta.name}</h2>
              )}
              {sourceVideo && (
                <p>
                  {sourceVideo.season != null && sourceVideo.episode != null
                    ? `S${sourceVideo.season}E${sourceVideo.episode}`
                    : ""}
                  {sourceVideo.title ? ` - ${sourceVideo.title}` : ""}
                </p>
              )}
            </div>
            <div className="source-column">
            <header>
              <div>
                {sourceResume ? (
                  <h2>Resume from {sourceResume}</h2>
                ) : (
                  <h2>{sourceVideo ? sourceVideo.title || meta.name : meta.name}</h2>
                )}
              </div>
              <div className="source-sheet-tools">
                {/* Picking the player here rather than in Settings: which one
                    suits a source is a property of the source, and it is the
                    moment you are looking at them. */}
                {!platform.player && <label className="source-player">
                  <span>Play in</span>
                  <select
                    value={sheetPlayer}
                    onChange={(event) =>
                      onDefaultPlayer(event.target.value as ExternalPlayerMode)
                    }
                  >
                    <option value="internal">Nuvio web player</option>
                    {platform.externalPlayer.options("player").map((option) => (
                      <option key={option.mode} value={option.mode}>
                        {option.label}
                        {option.reportsBack ? " ✓" : ""}
                      </option>
                    ))}
                  </select>
                </label>}
                {sourceAddons.length > 1 && (
                  <label className="source-player">
                    <span>Addon</span>
                    <select
                      value={activeAddon}
                      onChange={(event) => setSourceAddon(event.target.value)}
                    >
                      <option value="">All addons</option>
                      {sourceAddons.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {/* Outside the tools group so a phone can wrap the pickers onto
                  their own row and leave the way out at the top right. */}
              <button
                className="circle-button"
                onClick={() => {
                  window.clearTimeout(autoPlayTimer.current);
                  sourceAbort.current?.abort();
                  sourceRequest.current += 1;
                  setSourceOpen(false);
                }}
              >
                <X />
              </button>
            </header>
            {downloadNote && <div className="sheet-note">{downloadNote}</div>}
            {sourceBusy ? (
              <div className="sheet-loading" role="status">
                <i className="mini-spinner" aria-hidden="true" />
                <span>Fetching addon sources…</span>
              </div>
            ) : visibleStreams.length ? (
              <div className="source-list">
                {visibleStreams.map((stream, index) => (
                  <article
                    key={`${stream.addonName}:${index}`}
                    // Copy and download moved here from buttons on every row.
                    // Touch has no right-click, so a long press opens the same
                    // menu — the pattern the episode list already uses.
                    onContextMenu={(event) => {
                      if (!stream.url) return;
                      event.preventDefault();
                      setSourceMenu({
                        stream,
                        index,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                    {...sourceHold(stream, index)}
                  >
                    <button
                      className="source-main"
                      disabled={!stream.url && !stream.externalUrl}
                      onClick={() => {
                        // A hold that opened the menu must not also play.
                        if (holdFired.current) {
                          holdFired.current = false;
                          return;
                        }
                        playFresh(stream, sourceVideo, sheetPlayer);
                      }}
                    >
                      <span>
                        {stream.addonLogo ? (
                          <img src={stream.addonLogo} alt="" />
                        ) : (
                          <Play size={18} />
                        )}
                      </span>
                      <div>
                        {streamBadgeSettings.placement === "TOP" && (
                          <SourceBadges
                            stream={stream}
                            settings={streamBadgeSettings}
                          />
                        )}
                        <strong>{stream.name || stream.addonName}</strong>
                        <p>
                          {stream.title ||
                            stream.description ||
                            stream.behaviorHints?.filename}
                        </p>
                        <small>
                          {stream.addonName}
                          {(() => {
                            const target =
                              stream.url || stream.externalUrl || "";
                            const verdict = assessPlayback(
                              target,
                              stream.behaviorHints?.filename,
                            );
                            if (!verdict.playable)
                              return shouldUseRemuxFallback(
                                target,
                                stream.behaviorHints?.filename,
                              )
                                ? " · Remuxes locally on this device"
                                : " · Needs an external player";
                            if (verdict.audioRisk) return " · Audio may not play";
                            return stream.behaviorHints?.notWebReady
                              ? " · External player recommended"
                              : "";
                          })()}
                        </small>
                        {streamBadgeSettings.placement === "BOTTOM" && (
                          <SourceBadges
                            stream={stream}
                            settings={streamBadgeSettings}
                          />
                        )}
                      </div>
                    </button>
                  </article>
                ))}
                {sourceMenu && (
                  <ContextMenu
                    x={sourceMenu.x}
                    y={sourceMenu.y}
                    onClose={() => setSourceMenu(null)}
                    items={[
                      {
                        label: "Copy link",
                        icon: <Copy size={16} />,
                        onSelect: () =>
                          void navigator.clipboard.writeText(
                            sourceMenu.stream.url!,
                          ),
                      },
                      // Downloading is a shell capability. In a browser the
                      // entry is not built rather than shown and refused —
                      // "Copy link" is the useful thing there, and it is
                      // already above.
                      ...(platform.downloads
                        ? [
                            {
                              label:
                                savedSource === sourceMenu.index
                                  ? "Queued"
                                  : "Download",
                              icon: <DownloadIcon size={16} />,
                              onSelect: () => {
                                const at = sourceMenu.index;
                                void queueDownload(sourceMenu.stream, sourceVideo)
                                  .then(() => {
                                    setSavedSource(at);
                                    setDownloadNote("Added to Downloads");
                                    window.setTimeout(
                                      () =>
                                        setSavedSource((current) =>
                                          current === at ? null : current,
                                        ),
                                      2500,
                                    );
                                  })
                                  .catch((reason: unknown) =>
                                    setDownloadNote(
                                      reason instanceof Error
                                        ? reason.message
                                        : "Could not be queued",
                                    ),
                                  );
                              },
                            },
                            // Only for an episode that belongs to a season, so
                            // a film never offers to download a season it has
                            // no concept of.
                            ...(meta.type === "series" &&
                            sourceVideo?.season != null
                              ? [
                                  {
                                    label: `Download season ${sourceVideo.season}`,
                                    icon: <DownloadIcon size={16} />,
                                    onSelect: () =>
                                      void queueSeason(
                                        sourceMenu.stream,
                                        sourceVideo,
                                      ),
                                  },
                                ]
                              : []),
                          ]
                        : []),
                    ]}
                  />
                )}
                {sourcesPending && (
                  /* Under the results rather than over them: what has arrived
                     stays usable, and a slower addon landing later no longer
                     looks like one that failed. */
                  <div className="source-pending" role="status">
                    <i className="mini-spinner" aria-hidden="true" />
                    <span>
                      {pendingAddons.length
                        ? `Still scraping — ${pendingAddons.join(", ")}`
                        : "Still checking other addons…"}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="sheet-loading">
                No sources were returned by the installed addons.
              </div>
            )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * One episode. The whole row is the play target; a right-click or a touch
 * hold opens the menu instead. Watched state shows as a check badge, and a
 * partial resume point as a bar across the bottom of the thumbnail.
 */
export function EpisodeRow({
  video,
  rating,
  watched,
  percent,
  remaining,
  blurred,
  onPlay,
  onMenu,
}: {
  video: Video;
  /** IMDb's own score for this episode, where the service knows one. */
  rating?: number;
  watched: boolean;
  percent: number;
  /** How much is left, for a part-watched episode. */
  remaining?: string;
  blurred: boolean;
  onPlay(): void;
  onMenu(x: number, y: number): void;
}) {
  const hold = useLongPress(onMenu);
  return (
    <button
      className={`episode-row${watched ? " is-watched" : ""}${blurred ? " is-spoiler-blurred" : ""}`}
      onClick={() => {
        // A hold already opened the menu; the tap that ends it is not a play.
        if (hold.consumedTap()) return;
        onPlay();
      }}
      onContextMenu={hold.onContextMenu}
      onTouchStart={hold.onTouchStart}
      onTouchMove={hold.onTouchMove}
      onTouchEnd={hold.onTouchEnd}
      onTouchCancel={hold.onTouchCancel}
    >
      <span className="episode-thumb">
        {video.thumbnail ? (
          <img src={video.thumbnail} alt="" loading="lazy" />
        ) : (
          <span className="episode-placeholder" />
        )}
        <i className="episode-code">
          S{video.season}E{video.episode}
        </i>
        {/* The corner the watched mark uses, since an episode is either
            finished or part-way through, never both. */}
        {watched ? (
          <i className="episode-watched" aria-label="Watched">
            <Eye size={13} strokeWidth={2.6} />
          </i>
        ) : (
          remaining && <i className="episode-remaining">{remaining} left</i>
        )}
        {percent > 0 && percent < 90 && (
          <i className="episode-progress" style={{ width: `${percent}%` }} />
        )}
        {/* Bottom left, held above whatever height the progress bar takes at
            this size — it sat on the bar the last time it lived here. */}
        {rating != null && (
          <i className="episode-imdb" title={`IMDb ${formatRating(rating)}`}>
            <img src={publicAsset("rating_imdb.png")} alt="IMDb" />
            {formatRating(rating)}
          </i>
        )}
      </span>
      <span>
        <small>
          {episodeReleaseDate(video.released) ||
            `Season ${video.season} · Episode ${video.episode}`}
        </small>
        <strong>{video.title}</strong>
        <p>{video.overview}</p>
      </span>
    </button>
  );
}
