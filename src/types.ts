export type BackendConfig = { url: string; key: string; selfHosted: boolean };
export type AuthUser = { id: string; email?: string };
export type Session = {
  user: AuthUser;
  backend: BackendConfig;
};
export type Profile = {
  id: string;
  userId: string;
  profileIndex: number;
  name: string;
  avatarColorHex: string;
  avatarId?: string;
  avatarUrl?: string;
  /** Secondary profiles can deliberately share profile 1's plugin list. */
  usesPrimaryPlugins?: boolean;
  /**
   * The same for addons. A mirroring profile stores no addon rows of its own,
   * so its addons must be read from profile 1 or it has none at all.
   */
  usesPrimaryAddons?: boolean;
  /** Locked profiles ask for a four-digit PIN before they can be opened. */
  pinEnabled?: boolean;
};
export type AvatarCatalogItem = {
  id: string;
  displayName: string;
  category: string;
  sortOrder: number;
  backgroundColor?: string;
  imageUrl: string;
};
export type AddonRow = {
  url: string;
  name?: string;
  enabled: boolean;
  sortOrder: number;
};
export type ManifestCatalog = {
  id: string;
  type: string;
  name?: string;
  extra?: Array<{ name: string; isRequired?: boolean; options?: string[] }>;
};
export type AddonManifest = {
  id: string;
  name: string;
  version?: string;
  /** Present in every real manifest; the addon list shows it instead of the URL. */
  description?: string;
  logo?: string;
  types?: string[];
  idPrefixes?: string[];
  resources?: Array<
    string | { name: string; types?: string[]; idPrefixes?: string[] }
  >;
  catalogs?: ManifestCatalog[];
  behaviorHints?: {
    configurable?: boolean;
    configurationRequired?: boolean;
  };
};
export type InstalledAddon = AddonRow & {
  manifest?: AddonManifest;
  error?: string;
};
export type Video = {
  id: string;
  title: string;
  season?: number;
  episode?: number;
  released?: string;
  thumbnail?: string;
  overview?: string;
  runtime?: number;
  imdbRating?: string;
  /** Which service the score came from, so the badge can be honest about it. */
  ratingSource?: "imdb" | "tmdb";
  available?: boolean;
};
export type PluginRow = {
  url: string;
  name?: string;
  enabled: boolean;
  sortOrder: number;
};
export type PluginManifestScraper = {
  id: string;
  name: string;
  description?: string;
  version: string;
  filename: string;
  supportedTypes?: string[];
  enabled?: boolean;
  hasSettings?: boolean;
  logo?: string;
  contentLanguage?: string[];
  supportedPlatforms?: string[];
  disabledPlatforms?: string[];
  formats?: string[];
  supportedFormats?: string[];
};
export type PluginManifest = {
  name: string;
  version: string;
  description?: string;
  author?: string;
  scrapers: PluginManifestScraper[];
};
export type PluginRepository = {
  manifestUrl: string;
  name: string;
  description?: string;
  version?: string;
  scraperCount: number;
  lastUpdated: number;
  error?: string;
};
export type PluginScraper = {
  id: string;
  repositoryUrl: string;
  name: string;
  description: string;
  version: string;
  filename: string;
  supportedTypes: string[];
  enabled: boolean;
  manifestEnabled: boolean;
  hasSettings: boolean;
  logo?: string;
  contentLanguage: string[];
  formats?: string[];
  code: string;
};
export type PluginState = {
  pluginsEnabled: boolean;
  groupStreamsByRepository: boolean;
  repositories: PluginRepository[];
  scrapers: PluginScraper[];
};
export type Person = {
  name: string;
  role?: string;
  photo?: string;
  tmdbId?: number;
};
export type MetaTrailer = {
  id: string;
  key: string;
  name: string;
  site: string;
  trailerType: string;
  displayName?: string;
};
export type ExternalRating = { source: string; value: number };
export type Meta = {
  id: string;
  type: string;
  name: string;
  poster?: string;
  background?: string;
  banner?: string;
  /** Stremio's posterShape: "poster" | "landscape" | "square". */
  posterShape?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  released?: string;
  imdbRating?: string;
  genres: string[];
  runtime?: string;
  cast: Person[];
  director: string[];
  writer: string[];
  status?: string;
  ageRating?: string;
  language?: string;
  trailers: MetaTrailer[];
  externalRatings: ExternalRating[];
  defaultVideoId?: string;
  selectedVideoId?: string;
  videos: Video[];
  manifestUrl: string;
  addonName: string;
};
export type CatalogSection = {
  key: string;
  name: string;
  type: string;
  manifestUrl: string;
  addonName: string;
  catalogId: string;
  items: Meta[];
};
export type Stream = {
  name: string;
  title: string;
  description: string;
  url?: string;
  externalUrl?: string;
  infoHash?: string;
  fileIdx?: number;
  addonName: string;
  addonLogo?: string;
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
    filename?: string;
    videoSize?: number;
    proxyHeaders?: { request?: Record<string, string> };
  };
  /**
   * A source an addon expects the client to resolve, rather than a playable
   * URL. Debrid entries arrive this way — the addon says which service holds
   * the file and whether it is cached, and something with a key turns that into
   * a link. Kept whole rather than flattened because the filters read deep into
   * it, and dropping fields here would silently narrow what they can sort on.
   */
  clientResolve?: {
    type?: string;
    service?: string;
    isCached?: boolean;
    infoHash?: string;
    fileIdx?: number;
    magnetUri?: string;
    torrentName?: string;
    filename?: string;
    stream?: {
      raw?: {
        torrentName?: string;
        filename?: string;
        size?: number;
        folderSize?: number;
        parsed?: {
          raw_title?: string;
          parsed_title?: string;
          resolution?: string;
          quality?: string;
          codec?: string;
          hdr?: string[];
        };
      };
    };
  };
};
export type LibraryItem = Meta & { addedAt?: number };
export type ProgressRow = {
  contentId: string;
  contentType: string;
  videoId: string;
  season?: number;
  episode?: number;
  positionMs: number;
  durationMs: number;
  lastWatched: number;
  /** The server's own key for this row. Opaque — reuse it rather than
   *  rebuilding it, or a delete/update creates a duplicate row instead. */
  progressKey?: string;
};
export type WatchedItem = {
  contentId: string;
  contentType: string;
  title: string;
  season?: number;
  episode?: number;
  watchedAt: number;
};
export type ExternalPlayerMode =
  | "internal"
  | "copy"
  | "vlc"
  | "nextplayer"
  | "mxplayer"
  | "mpv"
  | "android-chooser"
  | "outplayer"
  | "infuse"
  | "iina"
  | "m3u";
export type NavKey =
  | "home"
  | "discover"
  | "calendar"
  | "downloads"
  | "library"
  | "addons"
  | "settings";

/** One catalog feeding a collection folder. */
export type CollectionCatalogSource = {
  /**
   * "addon", "tmdb" or "trakt". Nuvio defaults it to "addon" when absent, and
   * only addon sources carry a resolvable addonId — a TMDB or Trakt source is
   * a list on that service, not a catalog on an installed addon.
   */
  provider: string;
  addonId: string;
  type: string;
  catalogId: string;
  genre?: string;
  /** Set on TMDB and Trakt sources; used for labelling them. */
  title?: string;
  mediaType?: string;
  /** LIST | COLLECTION | COMPANY | NETWORK | DISCOVER | PERSON | DIRECTOR. */
  tmdbSourceType?: string;
  tmdbId?: number;
  traktListId?: number;
  sortBy?: string;
  sortHow?: string;
  /** Passed through to TMDB's discover endpoint verbatim. */
  filters?: Record<string, string | number>;
};
export type CollectionFolder = {
  id: string;
  title: string;
  coverImageUrl?: string;
  coverEmoji?: string;
  tileShape?: string;
  hideTitle?: boolean;
  catalogSources: CollectionCatalogSource[];
};
export type Collection = {
  id: string;
  title: string;
  backdropImageUrl?: string;
  pinToTop: boolean;
  folders: CollectionFolder[];
};
