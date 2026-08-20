/**
 * What a shell can do, written as things to ask for rather than shells to
 * recognise.
 *
 * The UI never tests which client it is running inside. It asks whether a
 * capability is present and renders what that answer allows: a Downloads page
 * exists where `downloads` does and is simply not built where it is not. The
 * absence removes the affordance, the way a missing `onCreate` removes the
 * profile tile rather than a flag greying it out.
 *
 * The point is that a feature written once appears in both clients. A check for
 * "am I in the desktop app" would put that back the other way round — every new
 * feature needing a branch per shell, which is the divergence this exists to
 * end.
 *
 * These contracts are the half that does not differ. Each shell writes its own
 * `index.ts` to satisfy them, and only that file differs between the two.
 */

import type { SkipSegment } from "../lib/skipSegments.ts";
import type { ExternalPlayerMode } from "../types.ts";

/**
 * Key-value storage that survives a restart.
 *
 * Deliberately the smaller of the two shapes behind it. The browser has
 * IndexedDB, which stores structured values under a key; the desktop shell
 * writes files. Anything richer than get/set/remove — indexes, cursors,
 * transactions — is reachable from one of those and not the other, so it stays
 * out of the contract and inside whichever shell can offer it.
 *
 * Values are structured-cloneable, not JSON. A `Date` comes back a `Date`.
 */
export type StorageApi = {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
};

export type RequestOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Abandon the wait. A shell that cannot cancel in flight still stops here. */
  signal?: AbortSignal;
  /** Give up after this long, per attempt. */
  timeoutMs?: number;
  /** Refuse a body past this size, measured in bytes. */
  maxBytes?: number;
};

export type RequestResponse = {
  ok: boolean;
  status: number;
  /** Header names lower-cased, which is the one form every shell agrees on. */
  headers: Record<string, string>;
  body: string;
};

/**
 * One HTTP round trip, for the app's own data.
 *
 * Text in, text out, and deliberately nothing more. No streaming, no `Response`,
 * no body that is not a string — because the desktop shell answers this across
 * an IPC hop, and a live stream does not survive one. Keeping the contract this
 * narrow is what lets a shell implement it at all.
 *
 * Media bytes therefore never come through here. The browser's player reads its
 * own ranges and the desktop hands a URL to libmpv; neither wants this, and
 * routing a film through a JSON-shaped call would be absurd.
 *
 * Two properties every shell has to keep. Nothing ambient is ever sent — no
 * cookies, no referrer — because these addresses come from addons the viewer
 * installed and a provider key is not theirs to leak onward. And a refusal is
 * an answer: 404 and 500 resolve with `ok: false`, and only a request that
 * never completed throws. Callers read `status` to tell "no" from "broken".
 */
export type RequestApi = (
  url: string,
  options?: RequestOptions,
) => Promise<RequestResponse>;

/** Where a list of players is being offered, which changes what belongs in it. */
export type ExternalPlayerSurface = "settings" | "player";

export type ExternalPlayerOption = {
  mode: ExternalPlayerMode;
  /** As shown to the viewer, already resolved for this device. */
  label: string;
  /**
   * Whether the player tells us what happened when it is done. Most do not,
   * and have to be asked afterwards instead — which is a prompt the viewer
   * sees, so it is worth saying which players avoid it.
   */
  reportsBack: boolean;
};

export type ExternalPlayerLaunchOptions = {
  /** Resume point. Not every player can be told about it. */
  positionSeconds?: number;
  /** An external subtitle file, if the stream came with one. */
  subtitleUrl?: string;
  /**
   * Builds the address a player should return to, given the query it should
   * carry. A function rather than a string because the browser's route back
   * from an installed iOS web app has to fold that query inside the text it
   * passes on, not onto its own end. Absent where nothing can reach us — and
   * absent entirely in a shell that never left.
   */
  returnUrlFor?: (query: string) => string;
};

/**
 * Handing a stream to something that is not this app's own player.
 *
 * Shared because both shells need it and neither can do it the same way: the
 * browser fires URL schemes and intents at the operating system and hopes
 * something answers, while a desktop shell can look at what is installed.
 * Which players exist is therefore the shell's answer to give, not a list the
 * UI can hold.
 */
export type ExternalPlayerApi = {
  options(surface: ExternalPlayerSurface): ExternalPlayerOption[];
  label(mode: ExternalPlayerMode): string;
  /** Whether a mode remembered from a previous run still applies here. */
  isAvailable(mode: ExternalPlayerMode): boolean;
  launch(
    mode: ExternalPlayerMode,
    url: string,
    title: string,
    options?: ExternalPlayerLaunchOptions,
  ): void;
  /** Resolves false where the clipboard was refused and the viewer was asked. */
  copyUrl(url: string): Promise<boolean>;
};

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

export type DownloadItem = {
  id: string;
  contentId: string;
  contentType: string;
  videoId: string;
  title: string;
  showName?: string;
  season?: number;
  episode?: number;
  sourceName: string;
  status: DownloadStatus;
  bytesDownloaded: number;
  /** Absent until the host says how big the file is, which not all do. */
  totalBytes?: number;
  filePath?: string;
  /** How to play what has been saved. Absent until the download completes. */
  playUrl?: string;
  artworkCached: boolean;
  error?: string;
  createdAt: number;
  /**
   * Skip markers fetched while there was a network, so an offline replay still
   * has them. In the vocabulary of `lib/skipSegments`: a shell whose queue
   * records something else — `outro` where this says `credits` — maps to this
   * one on the way out, because the UI reading them is the shared one.
   */
  skipSegments: SkipSegment[];
};

export type DownloadsSnapshot = {
  /** The folder downloads are being written to, as the viewer would see it. */
  root: string;
  items: DownloadItem[];
};

/** Everything needed to save a source, gathered where the source was chosen. */
export type DownloadRequest = {
  contentId: string;
  contentType: string;
  videoId: string;
  title: string;
  showName?: string;
  season?: number;
  episode?: number;
  posterUrl?: string;
  backdropUrl?: string;
  url: string;
  /** Headers the source insists on, which a browser could not have attached. */
  requestHeaders?: Record<string, string>;
  sourceName: string;
  filename?: string;
};

/**
 * Saving a source to watch without a network.
 *
 * Desktop only, and not for want of trying on the web: a browser cannot write
 * a file it can later play back under its own path, cannot resume a transfer
 * across a restart, and cannot attach the request headers many sources
 * require. The queue lives in the shell.
 */
export type DownloadsApi = {
  list(): Promise<DownloadsSnapshot>;
  enqueue(request: DownloadRequest): Promise<void>;
  cancel(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  /** Forgets the item and deletes what was written for it. */
  remove(id: string): Promise<void>;
  /** Poster art cached alongside the file, as a URL. Null where there is none. */
  artwork(id: string): Promise<string | null>;
  openFolder(): Promise<void>;
  /** Moves the download root, carrying existing files with it. */
  moveStorage(path: string): Promise<void>;
};

export type DebridProvider = "torbox" | "premiumize" | "realdebrid";

export type DebridAccount = {
  provider: DebridProvider;
  /** Whether a credential is stored and the service accepted it. */
  connected: boolean;
  /** The account as the service names it, where it says. */
  username?: string;
};

/**
 * Debrid accounts.
 *
 * Desktop only, and permanently so rather than pending work. Torbox sends no
 * cross-origin headers at all, so a browser cannot reach its API — not the
 * account linking, not the library, not link resolving. No amount of effort in
 * the web client changes that, which is why the capability is absent there and
 * the Integrations page says why in plain words.
 *
 * Resolving a cached link into a playable URL is not here yet, because neither
 * shell does it: the desktop's source list still labels those entries
 * "resolver not ported". When one of them can, it belongs on this contract.
 */
export type DebridApi = {
  /** Services this shell can talk to, in the order they should be offered. */
  readonly providers: readonly DebridProvider[];
  accounts(): Promise<DebridAccount[]>;
  connect(provider: DebridProvider, apiKey: string): Promise<void>;
  disconnect(provider: DebridProvider): Promise<void>;
};

/**
 * The whole of what a shell supplies.
 *
 * Optional members are the ones a shell may not have. Required ones every
 * shell must answer for, even if the answer is a thin one — there is no
 * sensible UI without storage, and every client can hand a stream somewhere.
 */
export type Platform = {
  downloads?: DownloadsApi;
  debrid?: DebridApi;
  externalPlayer: ExternalPlayerApi;
  request: RequestApi;
  storage: StorageApi;
};
