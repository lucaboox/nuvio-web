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
import type {
  BackendConfig,
  ExternalPlayerMode,
  Session,
} from "../types.ts";

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

/**
 * Who holds the session, and makes the calls that need it.
 *
 * Four calls, because that is what the account layer has always asked for —
 * this names a boundary that already existed rather than inventing one. The
 * point of it being a capability is that custody differs and should: a browser
 * keeps the token in an isolated Worker so the page cannot read it, while a
 * shell keeps it outside the webview entirely, where there is no page to leak
 * onto at all.
 *
 * What every shell must hold to is that the token itself never crosses this
 * boundary. Callers receive a `Session` — who is signed in — and ask for
 * authorized calls to be *made for them*. A shell that handed back a token so
 * the UI could attach it would satisfy the types and defeat the purpose.
 */
export type AuthApi = {
  signIn(
    backend: BackendConfig,
    email: string,
    password: string,
  ): Promise<Session>;
  /** Resumes a stored session, rotating whatever credential persisted it. */
  restore(): Promise<Session>;
  signOut(): Promise<void>;
  /** One authorized call against the account backend, made on our behalf. */
  request<T>(
    path: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<T>;
  /**
   * Announces a session lost outside any call — the holder crashed. Returns an
   * unsubscribe. Announced rather than thrown because it can happen while
   * nothing is waiting, and a session believed live is worse than none.
   */
  onSessionLost(listener: () => void): () => void;
};

/**
 * A player that is not the browser's own decoder.
 *
 * Optional, and absent in a browser — not as a gap, but because a page already
 * has a player and cannot be given a better one. A `<video>` element plays what
 * the browser can decode and no more; a shell with libmpv plays the rest, and
 * is the only thing that can open a file the shell itself wrote.
 *
 * The UI owns the controls and the shell owns decoding.  State is deliberately
 * a polled snapshot: it crosses IPC cleanly and lets the same React player
 * drive libmpv without exposing a native handle or event emitter to the page.
 */
/** The four picture modes, named as the settings blob stores them. */
export type ResizeMode = "Fit" | "Fill" | "Zoom" | "Stretch";

export type PlayerSource = {
  /** Latest UI playback preferences; read-only launch overrides, never a sync write. */
  preferences?: Record<string, { type: string; value: unknown }>;
  url: string;
  /** A resolver-provided fallback when the primary stream has no direct URL. */
  externalUrl?: string;
  /** Shown by the player while it loads, where it shows anything. */
  title?: string;
  /** Identifies the title, so the shell can attribute progress to it. */
  mediaId: string;
  startPositionMs?: number;
  /** Headers the source insists on, which a `<video>` element cannot attach. */
  requestHeaders?: Record<string, string>;
  /** Browser/OS language order, used by native players for the "Device" choice. */
  deviceLanguages?: string[];
  /** Metadata language, used by native players for the "Original" choice. */
  contentLanguage?: string;
  /** The exact server identity used by Nuvio's watch-progress RPCs. */
  progress: {
    contentId: string;
    contentType: string;
    videoId: string;
    season?: number;
    episode?: number;
  };
};

export type PlayerTrack = {
  id: number;
  kind: "audio" | "sub";
  title: string;
  lang: string;
  selected: boolean;
};

export type PlayerState = {
  active: boolean;
  loading: boolean;
  ended: boolean;
  paused: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  audioTrack: number;
  subtitleTrack: number;
  title: string;
  error?: string;
  warning?: string;
  tracks: PlayerTrack[];
};

export type PlayerApi = {
  open(source: PlayerSource): Promise<void>;
  state(): Promise<PlayerState>;
  togglePause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  seekRelative(offsetMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  toggleMute(): Promise<void>;
  /**
   * Mute stated outright rather than flipped.
   *
   * A toggle has to be told what the current state is, and the only source for
   * that is a poll that lags the change — raising the volume while muted then
   * left the shell muted and the next poll undid it.
   */
  setMuted?(muted: boolean): Promise<void>;
  setSpeed(speed: number): Promise<void>;
  /**
   * Picture mode, changed mid-playback from the player's own control.
   *
   * Optional: a shell that cannot rescale its surface simply does not offer
   * the button, the same way every other capability here works.
   */
  setResizeMode?(mode: ResizeMode): Promise<void>;
  setAudioTrack(id: number): Promise<void>;
  setSubtitleTrack(id: number): Promise<void>;
  skipSegments?(options: { contentId: string; videoId: string; season?: number; episode?: number; animeSkipEnabled: boolean; animeSkipClientId: string }): Promise<Array<{ startMs: number; endMs: number; type: string; provider: string }>>;
  /** Expands the native window, rather than a transparent webview element. */
  setFullscreen?(fullscreen: boolean): Promise<void>;
  /**
   * Hardware video enhancement this machine can actually perform.
   *
   * Absent everywhere it cannot be done, which is how the setting stays off
   * the screen for the browser, for a Mac, and for a Windows machine with no
   * NVIDIA adapter — rather than the settings page asking what it is running
   * on. `appliesToCurrentPlayback` is false where the pipeline is fixed when
   * the player starts, so the UI can say so instead of appearing to do
   * nothing.
   */
  videoEnhancement?: {
    kind: "rtx-super-resolution";
    appliesToCurrentPlayback: boolean;
  };
  stop(): Promise<void>;
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
  /**
   * Asks for a folder and answers with it, or null if nobody chose one.
   *
   * A capability rather than a dialog import: picking a directory is something
   * only a shell can do, and the shared page must not reach for a native API
   * to find that out.
   */
  chooseFolder(current?: string): Promise<string | null>;
  /** Moves the download root, carrying existing files with it. */
  moveStorage(path: string): Promise<void>;
};

export type DebridProvider = "torbox" | "premiumize" | "realdebrid";

export type DebridService = {
  id: DebridProvider;
  label: string;
  /** The synced credential row and field the key is kept in. */
  credentialProvider: string;
  credentialField: string;
};

/**
 * Debrid accounts, where the shell can reach them.
 *
 * The capability is about reachability, not storage. Keys live in the account's
 * synced provider credentials, which both shells already read and write — what
 * a browser cannot do is *use* them: Torbox sends no cross-origin headers, so a
 * page cannot link an account, browse a cloud library or resolve a link no
 * matter what key it holds.
 *
 * So this is absent on the web and its absence is the whole message: the
 * Integrations page says why instead of offering fields that could be filled in
 * and would still do nothing.
 */
export type DebridApi = {
  /** Services this shell can reach, in the order they should be offered. */
  readonly services: readonly DebridService[];
};

/**
 * The whole of what a shell supplies.
 *
 * Optional members are the ones a shell may not have. Required ones every
 * shell must answer for, even if the answer is a thin one — there is no
 * sensible UI without storage, and every client can hand a stream somewhere.
 */
/**
 * Reaching the episode-ratings service without a proxy in front of it.
 *
 * The service sends no cross-origin headers, so a browser cannot call it and
 * goes through a Cloudflare Worker instead. A shell makes its requests outside
 * any origin and has no such problem — and every request it sent through the
 * Worker would spend someone's Cloudflare budget on a hop it did not need.
 *
 * Present only where the shell was built with an address to use. Absent, the
 * Worker is used, which is what every browser build does.
 */
export type RatingsApi = {
  /** Base address, no trailing slash. `/api/shows/<id>/season-ratings` is appended. */
  readonly seasonRatingsBase: string;
};

/**
 * Replacing the running application, which only a shell can do.
 *
 * The browser's update is the service worker's: fetch a new bundle and reload.
 * A desktop build has to download a signed installer, verify it and restart
 * into it. Both answer "is there a newer version and will you take it", which
 * is why they share one control in Settings rather than two — but nothing about
 * the mechanism is shared, so it lives here.
 */
export type AppUpdate = {
  version: string;
  /** Release notes, where the feed carries them. */
  notes?: string;
  date?: string;
};

export type UpdatesApi = {
  /** The running build's version, for display. */
  currentVersion(): Promise<string>;
  /** Null when already current. */
  check(): Promise<AppUpdate | null>;
  /**
   * Downloads and installs, reporting 0..1 as it goes.
   *
   * A desktop update is tens of megabytes, so unlike the browser's there is a
   * real wait here and it has to be shown.
   */
  install(onProgress?: (fraction: number) => void): Promise<void>;
  /** Restarts into the installed version. */
  relaunch(): Promise<void>;
};

export type Platform = {
  downloads?: DownloadsApi;
  debrid?: DebridApi;
  ratings?: RatingsApi;
  updates?: UpdatesApi;
  auth: AuthApi;
  player?: PlayerApi;
  externalPlayer: ExternalPlayerApi;
  request: RequestApi;
  storage: StorageApi;
};
