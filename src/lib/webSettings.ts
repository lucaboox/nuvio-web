import { ACCENT_VALUES } from "./accents.ts";
import type { Stream } from "../types";
import type { DebridRules } from "./debridStreams";
import {
  readMetaScreenSettings,
  type MetaScreenSettings,
} from "./metaScreenSettings.ts";
import { DEFAULT_REUSE_CACHE_HOURS } from "./streamLinkCache.ts";
import { readBadgeRules } from "./fusionBadges.ts";
import {
  blobRawValue,
  blobStringPayload,
  blobTypedValue,
  type SettingsBlob,
} from "./settingsBlob.ts";

export type PosterSettings = {
  widthDp: number;
  heightDp: number;
  cornerRadiusDp: number;
  catalogLandscapeModeEnabled: boolean;
  hideLabelsEnabled: boolean;
  hoverPreviewEnabled: boolean;
  hoverPreviewOpenDelayMillis: number;
  hoverPreviewTrailerEnabled: boolean;
  hoverPreviewTrailerSoundEnabled: boolean;
  hoverPreviewTrailerStartSeconds: number;
  [key: string]: unknown;
};

export const POSTER_DEFAULTS: PosterSettings = {
  widthDp: 126,
  heightDp: 189,
  cornerRadiusDp: 12,
  catalogLandscapeModeEnabled: false,
  hideLabelsEnabled: false,
  hoverPreviewEnabled: true,
  hoverPreviewOpenDelayMillis: 2_000,
  hoverPreviewTrailerEnabled: false,
  hoverPreviewTrailerSoundEnabled: false,
  hoverPreviewTrailerStartSeconds: 0,
};

export type ResizeMode = "Fit" | "Fill" | "Zoom" | "Stretch";
export type AutoPlayMode = "MANUAL" | "FIRST_STREAM" | "REGEX_MATCH";

export type WebPlayerSettings = {
  showLoadingOverlay: boolean;
  showParentalGuide: boolean;
  resizeMode: ResizeMode;
  preferredAudioLanguage: string;
  secondaryPreferredAudioLanguage: string;
  preferredSubtitleLanguage: string;
  secondaryPreferredSubtitleLanguage: string;
  subtitleTextColor: string;
  subtitleBackgroundColor: string;
  subtitleOutlineColor: string;
  subtitleOutlineEnabled: boolean;
  subtitleOutlineWidth: number;
  subtitleBold: boolean;
  subtitleFontSizeSp: number;
  subtitleBottomOffset: number;
  subtitleUseForcedSubtitles: boolean;
  subtitleShowOnlyPreferredLanguages: boolean;
  addonSubtitleStartupMode:
    | "FAST_STARTUP"
    | "PREFERRED_ONLY"
    | "ALL_SUBTITLES";
  autoPlayMode: AutoPlayMode;
  autoPlayRegex: string;
  autoPlayTimeoutSeconds: number;
  autoPlaySource: "ALL_SOURCES" | "INSTALLED_ADDONS_ONLY" | "ENABLED_PLUGINS_ONLY";
  autoPlaySelectedAddons: string[];
  autoPlaySelectedPlugins: string[];
  autoPlayNextEpisode: boolean;
  autoPlayNextEpisodeFallback: boolean;
  preferBingeGroup: boolean;
  reuseBingeGroup: boolean;
  nextEpisodeThresholdMode: "PERCENTAGE" | "MINUTES_BEFORE_END";
  nextEpisodeThresholdPercent: number;
  nextEpisodeThresholdMinutes: number;
  autoSkipSegmentTypes: string[];
  useLibass: boolean;
  skipIntroEnabled: boolean;
  animeSkipEnabled: boolean;
  reuseLastStream: boolean;
  reuseLastStreamHours: number;
  /** NVIDIA RTX Video Super Resolution, where a shell can drive it. */
  rtxSuperResolution: boolean;
};

export type StreamBadgeFilter = {
  groupId?: string;
  id?: string;
  name?: string;
  pattern?: string;
  imageURL?: string;
  isEnabled?: boolean;
  tagColor?: string;
  tagStyle?: string;
  textColor?: string;
  borderColor?: string;
};

export type StreamBadgeSettings = {
  serializedRules?: string;
  showFileSizeBadges: boolean;
  placement: "TOP" | "BOTTOM";
  filters: StreamBadgeFilter[];
};

export type ContinueWatchingStyle = "Card" | "Wide" | "Poster";
export type ContinueWatchingSortMode =
  | "DEFAULT"
  | "STREAMING_STYLE"
  | "SPLIT_UPCOMING";

export type ContinueWatchingSettings = {
  isVisible: boolean;
  style: ContinueWatchingStyle;
  upNextFromFurthestEpisode: boolean;
  useEpisodeThumbnails: boolean;
  showUnairedNextUp: boolean;
  blurNextUp: boolean;
  dismissedNextUpKeys: string[];
  showResumePromptOnLaunch: boolean;
  sortMode: ContinueWatchingSortMode;
};

export const CONTINUE_WATCHING_DEFAULTS: ContinueWatchingSettings = {
  isVisible: true,
  style: "Card",
  upNextFromFurthestEpisode: true,
  useEpisodeThumbnails: true,
  showUnairedNextUp: true,
  blurNextUp: false,
  dismissedNextUpKeys: [],
  showResumePromptOnLaunch: true,
  sortMode: "DEFAULT",
};

export type WebSettings = {
  amoled: boolean;
  selectedTheme: string;
  desktopNavigationLayout: "Sidebar" | "TopBar";
  navBarStyle: string;
  poster: PosterSettings;
  player: WebPlayerSettings;
  streamBadges: StreamBadgeSettings;
  continueWatching: ContinueWatchingSettings;
  metaScreen: MetaScreenSettings;
  episodeReleaseAlerts: boolean;
  integrations: {
    tmdbEnabled: boolean;
    tmdbLanguage: string;
    tmdbUseTrailers: boolean;
    tmdbUseArtwork: boolean;
    tmdbUseBasicInfo: boolean;
    tmdbUseDetails: boolean;
    tmdbUseReleaseDates: boolean;
    tmdbUseCredits: boolean;
    tmdbUseEpisodes: boolean;
    mdbListEnabled: boolean;
    mdbListProviders: string[];
  };
};

const numberIn = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

const bool = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const string = (value: unknown, fallback: string) =>
  typeof value === "string" ? value : fallback;

function posterSettings(blob: SettingsBlob | null): PosterSettings {
  const raw = blobStringPayload(
    blob,
    "poster_card_style_settings_payload",
    POSTER_DEFAULTS,
  );
  return {
    ...raw,
    widthDp: numberIn(raw.widthDp, POSTER_DEFAULTS.widthDp, 88, 260),
    heightDp: numberIn(raw.heightDp, POSTER_DEFAULTS.heightDp, 112, 390),
    cornerRadiusDp: numberIn(
      raw.cornerRadiusDp,
      POSTER_DEFAULTS.cornerRadiusDp,
      0,
      40,
    ),
    catalogLandscapeModeEnabled: bool(
      raw.catalogLandscapeModeEnabled,
      false,
    ),
    hideLabelsEnabled: bool(raw.hideLabelsEnabled, false),
    hoverPreviewEnabled: bool(raw.hoverPreviewEnabled, true),
    hoverPreviewOpenDelayMillis: numberIn(
      raw.hoverPreviewOpenDelayMillis,
      2_000,
      0,
      10_000,
    ),
    hoverPreviewTrailerEnabled: bool(raw.hoverPreviewTrailerEnabled, false),
    hoverPreviewTrailerSoundEnabled: bool(
      raw.hoverPreviewTrailerSoundEnabled,
      false,
    ),
    hoverPreviewTrailerStartSeconds: numberIn(
      raw.hoverPreviewTrailerStartSeconds,
      0,
      0,
      600,
    ),
  };
}

function enumValue<T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function continueWatchingSettings(
  blob: SettingsBlob | null,
): ContinueWatchingSettings {
  const raw = blobStringPayload(
    blob,
    "continue_watching_settings_payload",
    {} as Record<string, unknown>,
  );
  const dismissed = Array.isArray(raw.dismissedNextUpKeys)
    ? [
        ...new Set(
          raw.dismissedNextUpKeys
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ]
    : [];
  return {
    isVisible: bool(raw.isVisible, true),
    style: enumValue(
      string(raw.style, "Card"),
      ["Card", "Wide", "Poster"] as const,
      "Card",
    ),
    upNextFromFurthestEpisode: bool(raw.upNextFromFurthestEpisode, true),
    useEpisodeThumbnails: bool(raw.use_episode_thumbnails_in_cw, true),
    showUnairedNextUp: bool(raw.show_unaired_next_up, true),
    blurNextUp: bool(raw.blur_continue_watching_next_up, false),
    dismissedNextUpKeys: dismissed,
    showResumePromptOnLaunch: bool(raw.showResumePromptOnLaunch, true),
    sortMode: enumValue(
      string(raw.sort_mode, "DEFAULT"),
      ["DEFAULT", "STREAMING_STYLE", "SPLIT_UPCOMING"] as const,
      "DEFAULT",
    ),
  };
}

function playerSettings(blob: SettingsBlob | null): WebPlayerSettings {
  const stringValue = (key: string, fallback: string) =>
    blobTypedValue(blob, "player_settings", key, "string", fallback);
  const booleanValue = (key: string, fallback: boolean) =>
    blobTypedValue(blob, "player_settings", key, "boolean", fallback);
  const intValue = (key: string, fallback: number) =>
    blobTypedValue(blob, "player_settings", key, "int", fallback);
  const floatValue = (key: string, fallback: number) =>
    blobTypedValue(blob, "player_settings", key, "float", fallback);
  const stringSet = (key: string) =>
    blobTypedValue(blob, "player_settings", key, "string_set", []);
  return {
    showLoadingOverlay: booleanValue("show_loading_overlay", true),
    showParentalGuide: booleanValue("show_parental_guide", true),
    resizeMode: enumValue(
      stringValue("resize_mode", "Fit"),
      ["Fit", "Fill", "Zoom", "Stretch"] as const,
      "Fit",
    ),
    preferredAudioLanguage: stringValue("preferred_audio_language", "device"),
    secondaryPreferredAudioLanguage: stringValue(
      "secondary_preferred_audio_language",
      "",
    ),
    preferredSubtitleLanguage: stringValue(
      "preferred_subtitle_language",
      "none",
    ),
    secondaryPreferredSubtitleLanguage: stringValue(
      "secondary_preferred_subtitle_language",
      "",
    ),
    subtitleTextColor: stringValue("subtitle_text_color", "#FFFFFFFF"),
    subtitleBackgroundColor: stringValue(
      "subtitle_background_color",
      "#00000000",
    ),
    subtitleOutlineColor: stringValue("subtitle_outline_color", "#FF000000"),
    subtitleOutlineEnabled: booleanValue("subtitle_outline_enabled", true),
    subtitleOutlineWidth: numberIn(
      intValue("subtitle_outline_width", 2),
      2,
      0,
      10,
    ),
    subtitleBold: booleanValue("subtitle_bold", false),
    subtitleFontSizeSp: numberIn(
      intValue("subtitle_font_size_sp", 18),
      18,
      6,
      40,
    ),
    subtitleBottomOffset: numberIn(
      intValue("subtitle_bottom_offset", 20),
      20,
      0,
      100,
    ),
    subtitleUseForcedSubtitles: booleanValue(
      "subtitle_use_forced_subtitles",
      false,
    ),
    subtitleShowOnlyPreferredLanguages: booleanValue(
      "subtitle_show_only_preferred_languages",
      false,
    ),
    addonSubtitleStartupMode: enumValue(
      stringValue("addon_subtitle_startup_mode", "ALL_SUBTITLES"),
      ["FAST_STARTUP", "PREFERRED_ONLY", "ALL_SUBTITLES"] as const,
      "ALL_SUBTITLES",
    ),
    autoPlayMode: enumValue(
      stringValue("stream_auto_play_mode", "MANUAL"),
      ["MANUAL", "FIRST_STREAM", "REGEX_MATCH"] as const,
      "MANUAL",
    ),
    autoPlayRegex: stringValue("stream_auto_play_regex", ""),
    autoPlayTimeoutSeconds: numberIn(
      intValue("stream_auto_play_timeout_seconds", 3),
      3,
      0,
      2147483647,
    ),
    autoPlaySource: enumValue(stringValue("stream_auto_play_source", "ALL_SOURCES"),
      ["ALL_SOURCES", "INSTALLED_ADDONS_ONLY", "ENABLED_PLUGINS_ONLY"] as const, "ALL_SOURCES"),
    autoPlaySelectedAddons: stringSet("stream_auto_play_selected_addons"),
    autoPlaySelectedPlugins: stringSet("stream_auto_play_selected_plugins"),
    autoPlayNextEpisode: booleanValue("stream_auto_play_next_episode_enabled", false),
    autoPlayNextEpisodeFallback: booleanValue("stream_auto_play_next_episode_fallback_enabled", true),
    preferBingeGroup: booleanValue("stream_auto_play_prefer_binge_group", true),
    reuseBingeGroup: booleanValue("stream_auto_play_reuse_binge_group", true),
    nextEpisodeThresholdMode: enumValue(stringValue("next_episode_threshold_mode", "PERCENTAGE"),
      ["PERCENTAGE", "MINUTES_BEFORE_END"] as const, "PERCENTAGE"),
    nextEpisodeThresholdPercent: numberIn(floatValue("next_episode_threshold_percent_v2", 99), 99, 97, 100),
    nextEpisodeThresholdMinutes: numberIn(floatValue("next_episode_threshold_minutes_before_end_v2", 2), 2, 0, 3.5),
    autoSkipSegmentTypes: stringSet("auto_skip_segment_types").filter((kind) => ["intro", "recap", "outro"].includes(kind)),
    useLibass: booleanValue("use_libass", false),
    skipIntroEnabled: booleanValue("skip_intro_enabled", true),
    // The key the official desktop client writes, so the switch here and the
    // one there are the same setting rather than two that happen to agree.
    rtxSuperResolution: booleanValue("nvidia_rtx_super_resolution_enabled", false),
    animeSkipEnabled: booleanValue("animeskip_enabled", false),
    // Off by default, matching the desktop client: skipping the stream picker
    // is a shortcut you opt into, not something that should start happening.
    reuseLastStream: booleanValue("stream_reuse_last_link_enabled", false),
    // The same 1–720 hour range the shell validates against, so a value set on
    // one client is never one the other has to reject.
    reuseLastStreamHours: numberIn(
      intValue("stream_reuse_last_link_cache_hours", DEFAULT_REUSE_CACHE_HOURS),
      DEFAULT_REUSE_CACHE_HOURS,
      1,
      720,
    ),
  };
}

function badgeFilters(blob: SettingsBlob | null): StreamBadgeFilter[] {
  const serialized = blobTypedValue(
    blob,
    "stream_badge_settings",
    "stream_badge_rules",
    "string",
    "",
  );
  if (!serialized) return [];
  try {
    const parsed = readBadgeRules(serialized);
    if (!Array.isArray(parsed.imports)) return [];
    const result: StreamBadgeFilter[] = [];
    for (const item of parsed.imports.slice(0, 3)) {
      if (!item || typeof item !== "object") continue;
      const source = item as { isActive?: unknown; filters?: unknown };
      if (source.isActive !== true || !Array.isArray(source.filters)) continue;
      for (const value of source.filters) {
        if (!value || typeof value !== "object") continue;
        const filter = value as StreamBadgeFilter;
        if (filter.isEnabled !== false && typeof filter.pattern === "string")
          result.push(filter);
      }
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * The Debrid rules Nuvio syncs, read from the same blob the other clients write.
 *
 * Read unconditionally, applied only where `platform.debrid` exists. A browser
 * has no use for them — it cannot resolve a cached link — but reading them
 * costs nothing and keeps this function free of any question about which shell
 * it is running in.
 */
export function readDebridRules(blob: SettingsBlob | null): DebridRules {
  const rule = <T extends string>(key: string, fallback: T) =>
    blobTypedValue(blob, "debrid_settings", key, "string", fallback) as T;
  return {
    debridEnabled: blobTypedValue(
      blob,
      "debrid_settings",
      "debrid_enabled",
      "boolean",
      false,
    ),
    debridPreferredResolverProviderId: blobTypedValue(
      blob,
      "debrid_settings",
      "debrid_preferred_resolver_provider_id",
      "string",
      "",
    ),
    debridStreamMaxResults: blobTypedValue(
      blob,
      "debrid_settings",
      "debrid_stream_max_results",
      "int",
      0,
    ),
    debridStreamSortMode: rule("debrid_stream_sort_mode", "DEFAULT"),
    debridStreamMinimumQuality: rule("debrid_stream_minimum_quality", "ANY"),
    debridStreamDolbyVisionFilter: rule("debrid_stream_dolby_vision_filter", "ANY"),
    debridStreamHdrFilter: rule("debrid_stream_hdr_filter", "ANY"),
    debridStreamCodecFilter: rule("debrid_stream_codec_filter", "ANY"),
  };
}

export function readWebSettings(blob: SettingsBlob | null): WebSettings {
  const placement = blobTypedValue(
    blob,
    "stream_badge_settings",
    "stream_badge_placement",
    "string",
    "BOTTOM",
  );
  return {
    amoled: blobTypedValue(
      blob,
      "theme_settings",
      "amoled_enabled",
      "boolean",
      false,
    ),
    selectedTheme: enumValue(
      blobTypedValue(
        blob,
        "theme_settings",
        "selected_theme",
        "string",
        "WHITE",
      ).trim().toUpperCase(),
      // Derived from the picker rather than listed again. Written out here it
      // was a second, silent source of truth: adding Gold to the picker left
      // this rejecting it, so choosing it fell straight back to White with no
      // sign of why.
      ACCENT_VALUES,
      "WHITE",
    ),
    desktopNavigationLayout: enumValue(
      blobTypedValue(
        blob,
        "theme_settings",
        "desktop_navigation_layout",
        "string",
        "Sidebar",
      ),
      ["Sidebar", "TopBar"] as const,
      "Sidebar",
    ),
    navBarStyle: blobTypedValue(
      blob,
      "theme_settings",
      "nav_bar_style",
      "string",
      "adaptive",
    ),
    poster: posterSettings(blob),
    player: playerSettings(blob),
    streamBadges: {
      serializedRules: blobTypedValue(blob, "stream_badge_settings", "stream_badge_rules", "string", ""),
      showFileSizeBadges: blobTypedValue(
        blob,
        "stream_badge_settings",
        "show_file_size_badges",
        "boolean",
        true,
      ),
      placement: placement === "TOP" ? "TOP" : "BOTTOM",
      filters: badgeFilters(blob),
    },
    continueWatching: continueWatchingSettings(blob),
    metaScreen: readMetaScreenSettings(blob),
    episodeReleaseAlerts: blobRawValue(
      blob,
      "notifications_settings",
      "episode_release_alerts_enabled",
      (value): value is boolean => typeof value === "boolean",
      false,
    ),
    integrations: {
      tmdbEnabled: blobTypedValue(
        blob,
        "tmdb_settings",
        "tmdb_enabled",
        "boolean",
        false,
      ),
      tmdbLanguage: blobTypedValue(
        blob,
        "tmdb_settings",
        "tmdb_language",
        "string",
        "en",
      ),
      tmdbUseTrailers: blobTypedValue(
        blob,
        "tmdb_settings",
        "tmdb_use_trailers",
        "boolean",
        true,
      ),
      tmdbUseArtwork: blobTypedValue(
        blob,
        "tmdb_settings",
        "tmdb_use_artwork",
        "boolean",
        true,
      ),
      tmdbUseBasicInfo: blobTypedValue(
        blob,
        "tmdb_settings",
        "tmdb_use_basic_info",
        "boolean",
        true,
      ),
      tmdbUseDetails: blobTypedValue(
        blob,
        "tmdb_settings",
        "tmdb_use_details",
        "boolean",
        true,
      ),
      tmdbUseReleaseDates: blobTypedValue(
        blob,
        "tmdb_settings",
        "tmdb_use_release_dates",
        "boolean",
        false,
      ),
      tmdbUseCredits: blobTypedValue(
        blob,
        "tmdb_settings",
        "tmdb_use_credits",
        "boolean",
        true,
      ),
      tmdbUseEpisodes: blobTypedValue(
        blob,
        "tmdb_settings",
        "tmdb_use_episodes",
        "boolean",
        true,
      ),
      mdbListEnabled: blobTypedValue(
        blob,
        "mdblist_settings",
        "mdblist_enabled",
        "boolean",
        false,
      ),
      mdbListProviders: [
        ["imdb", "mdblist_use_imdb"],
        ["tmdb", "mdblist_use_tmdb"],
        ["tomatoes", "mdblist_use_tomatoes"],
        ["metacritic", "mdblist_use_metacritic"],
        ["trakt", "mdblist_use_trakt"],
        ["letterboxd", "mdblist_use_letterboxd"],
        ["audience", "mdblist_use_audience"],
        ["mal", "mdblist_use_mal"],
      ]
        .filter(([, key]) =>
          blobTypedValue(
            blob,
            "mdblist_settings",
            key,
            "boolean",
            true,
          ),
        )
        .map(([provider]) => provider),
    },
  };
}

/** Matches the active official badge import against Nuvio's raw stream text. */
export function streamBadgesFor(
  stream: Stream,
  settings: StreamBadgeSettings,
): StreamBadgeFilter[] {
  const candidates = [
    stream.behaviorHints?.filename,
    stream.name,
    stream.title,
    stream.description,
    stream.addonName,
  ].filter((value): value is string => Boolean(value));
  const combined = candidates.join(" ");
  const matches: StreamBadgeFilter[] = [];
  const seen = new Set<string>();
  for (const filter of settings.filters) {
    if (!filter.pattern) continue;
    try {
      // Kotlin accepts leading inline flags; JavaScript requires them as the
      // RegExp flags argument. Unsupported patterns remain safely ignored.
      const flags = /^\(\?([ims]+)\)/.exec(filter.pattern);
      const regex = new RegExp(flags ? filter.pattern.slice(flags[0].length) : filter.pattern, flags?.[1]);
      if (!candidates.some((candidate) => regex.test(candidate)) && !regex.test(combined))
        continue;
    } catch {
      continue;
    }
    const identity = (filter.imageURL || filter.name || filter.id || "").toLowerCase();
    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);
    matches.push(filter);
  }
  return matches;
}

export function browserColor(value: string, fallback: string): string {
  const normalized = value.trim();
  // Nuvio persists Android-style #AARRGGBB; CSS expects #RRGGBBAA.
  if (/^#[\da-f]{8}$/i.test(normalized))
    return `#${normalized.slice(3)}${normalized.slice(1, 3)}`;
  return /^#[\da-f]{3,6}$/i.test(normalized) || /^rgba?\(/i.test(normalized)
    ? normalized
    : fallback;
}

export const readableFileSize = (bytes?: number): string | null => {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null;
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(gib >= 10 ? 1 : 2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
};
