import type {
  Collection,
  CollectionFolder,
  AddonRow,
  AvatarCatalogItem,
  BackendConfig,
  LibraryItem,
  Meta,
  Profile,
  PluginRow,
  ProgressRow,
  Session,
  WatchedItem,
} from "../types";
import { platform } from "../platform/index.ts";
import {
  blobRawValue,
  blobStringPayload,
  blobTypedValue,
  emptySettingsBlob,
  withBlobRawValue,
  withBlobStringPayload,
  withBlobTypedValue,
  type SettingsBlob,
  type SyncPreferenceType,
  type SyncPreferenceValue,
} from "./settingsBlob";
import {
  decodeProviderCredentials,
  providerCredentialPayload,
  withProviderCredential,
  type ProviderCredentialRow,
} from "./providerCredentials";

export type { ProviderCredentialRow };

export {
  blobStringPayload,
  blobTypedValue,
  withBlobRawValue,
  withBlobStringPayload,
  withBlobTypedValue,
};
export type { SettingsBlob, SyncPreferenceType, SyncPreferenceValue };

const CONFIG_KEY = "backend-config";
/**
 * This installation's identity, kept across reloads.
 *
 * Mirrors `SyncClientIdentity` — same shape, same validation, and the same
 * insistence that it is stored rather than made up each time. It was generated
 * per page load here, which was survivable while it only suppressed the echo
 * of this client's own sync writes, but it also names the device in the
 * account's device list, and a fresh name on every reload fills that list with
 * one entry per visit.
 */
const CLIENT_ID_KEY = "nuvio-web-client-id";
const CLIENT_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function generateClientId() {
  const bytes = new Uint8Array(32);
  globalThis.crypto?.getRandomValues?.(bytes);
  return `nuvio-web-${Array.from(
    bytes,
    (byte) => CLIENT_ID_ALPHABET[byte % CLIENT_ID_ALPHABET.length],
  ).join("")}`;
}

/** As the other clients validate it: 16–96 of letters, digits, "-" or "_". */
const isValidClientId = (value: string) =>
  value.length >= 16 && value.length <= 96 && /^[A-Za-z0-9_-]+$/.test(value);

function loadClientId() {
  try {
    const stored = localStorage.getItem(CLIENT_ID_KEY)?.trim();
    if (stored && isValidClientId(stored)) return stored;
    const generated = generateClientId();
    localStorage.setItem(CLIENT_ID_KEY, generated);
    return generated;
  } catch {
    // Without storage it is per-session, which is what it was throughout.
    return generateClientId();
  }
}

export const CLIENT_ID = loadClientId();
let activeSession: Session | null = null;

// The session lives wherever the shell keeps it — a Worker in the browser, a
// process outside the webview in the desktop shell. This module only ever
// learns who is signed in, never the credential proving it.
platform.auth.onSessionLost(() => {
  activeSession = null;
});

export function officialBackend(): BackendConfig | null {
  const url = import.meta.env.VITE_NUVIO_SUPABASE_URL?.trim().replace(
    /\/+$/,
    "",
  );
  const key = import.meta.env.VITE_NUVIO_SUPABASE_ANON_KEY?.trim();
  return url && key ? { url, key, selfHosted: false } : null;
}

export function normalizeBackend(
  url: string,
  key: string,
  selfHosted = true,
): BackendConfig {
  const parsed = new URL(url.trim());
  if (
    !/^https?:$/.test(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "Enter a plain HTTP(S) backend URL without credentials, query, or fragment.",
    );
  }
  if (
    parsed.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
  ) {
    throw new Error("Remote self-hosted backends must use HTTPS.");
  }
  const cleanKey = key.trim();
  if (!cleanKey || cleanKey.includes("\n") || cleanKey.includes("\r"))
    throw new Error("Enter a valid publishable key.");
  return {
    url: parsed.toString().replace(/\/+$/, ""),
    key: cleanKey,
    selfHosted,
  };
}

/**
 * Signs in inside the dedicated token vault. The Window receives identity and
 * backend metadata only; credentials never cross the Worker message boundary.
 */
export async function signIn(
  backend: BackendConfig,
  email: string,
  password: string,
): Promise<Session> {
  activeSession = null;
  const session = await platform.auth.signIn(backend, email, password);
  await platform.storage.set(CONFIG_KEY, backend);
  activeSession = session;
  return activeSession;
}

/**
 * Restores by rotating the persisted refresh credential inside the Worker.
 * The Window receives identity/backend metadata, never either credential.
 */
export async function restoreSession(): Promise<Session | null> {
  activeSession = null;
  try {
    const session = await platform.auth.restore();
    activeSession = session;
    return session;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  activeSession = null;
  await platform.auth.signOut();
}

async function secureAuthorized<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!activeSession) throw new Error("Sign in first.");
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => {
    headers[key] = value;
  });
  return platform.auth.request<T>(path, {
    method: init.method,
    body: typeof init.body === "string" ? init.body : undefined,
    headers,
  });
}

export async function rpc<T>(name: string, body: unknown): Promise<T> {
  return secureAuthorized<T>(`/rest/v1/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function camelProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id ?? ""),
    userId: String(row.user_id ?? row.userId ?? ""),
    profileIndex: Number(row.profile_index ?? row.profileIndex ?? 1),
    name: String(row.name ?? "Profile"),
    avatarColorHex: String(
      row.avatar_color_hex ?? row.avatarColorHex ?? "#397a63",
    ),
    avatarId: row.avatar_id ? String(row.avatar_id) : undefined,
    usesPrimaryPlugins:
      row.uses_primary_plugins === true || row.usesPrimaryPlugins === true,
    pinEnabled: row.pin_enabled === true || row.pinEnabled === true,
    usesPrimaryAddons:
      row.uses_primary_addons === true || row.usesPrimaryAddons === true,
    avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
  };
}

/** Six, matching `MAX_PROFILES` in the official clients. */
export const MAX_PROFILES = 6;

/**
 * Adds a profile, mirroring `ProfileRepository.createProfile`.
 *
 * `sync_push_profiles` replaces the whole set rather than appending, so the
 * existing ones are sent back alongside the new one — omitting them deletes
 * them. The new index is the lowest free slot, which is how the other clients
 * pick it and keeps the two agreeing about who is who.
 */
export async function createProfile(
  existing: Profile[],
  name: string,
  avatarColorHex: string,
): Promise<void> {
  const taken = new Set(existing.map((item) => item.profileIndex));
  let nextIndex = 0;
  for (let index = 1; index <= MAX_PROFILES; index += 1) {
    if (!taken.has(index)) {
      nextIndex = index;
      break;
    }
  }
  if (!nextIndex) throw new Error(`Nuvio allows ${MAX_PROFILES} profiles.`);

  const payload = (item: Profile) => ({
    profile_index: item.profileIndex,
    name: item.name,
    avatar_color_hex: item.avatarColorHex,
    uses_primary_addons: item.usesPrimaryAddons ?? false,
    uses_primary_plugins: item.usesPrimaryPlugins ?? false,
    avatar_id: item.avatarId ?? null,
    avatar_url: item.avatarUrl ?? null,
  });

  await rpc("sync_push_profiles", {
    p_client_max_profiles: MAX_PROFILES,
    p_profiles: [
      ...existing.map(payload),
      {
        profile_index: nextIndex,
        name: name.trim(),
        avatar_color_hex: avatarColorHex,
        uses_primary_addons: false,
        uses_primary_plugins: false,
        avatar_id: null,
        avatar_url: null,
      },
    ],
    p_origin_client_id: CLIENT_ID,
  });
}

export async function loadProfiles(): Promise<Profile[]> {
  const rows = await rpc<Array<Record<string, unknown>>>(
    "sync_pull_profiles",
    {},
  );
  return rows.map(camelProfile).sort((a, b) => a.profileIndex - b.profileIndex);
}

export async function loadAvatarCatalog(): Promise<AvatarCatalogItem[]> {
  if (!activeSession) throw new Error("Sign in first.");
  const rows = await rpc<Array<Record<string, unknown>>>(
    "get_avatar_catalog",
    {},
  );
  const base = activeSession.backend.url.replace(/\/+$/, "");
  return rows
    .filter((row) => row.is_active !== false)
    .map((row) => {
      const storagePath = String(row.storage_path ?? "").replace(/^\/+/, "");
      return {
        id: String(row.id ?? ""),
        displayName: String(row.display_name ?? "Avatar"),
        category: String(row.category ?? ""),
        sortOrder: Number(row.sort_order ?? 0),
        backgroundColor: row.bg_color ? String(row.bg_color) : undefined,
        imageUrl: row.image_url
          ? String(row.image_url)
          : storagePath
            ? `${base}/storage/v1/object/public/avatars/${storagePath}`
            : "",
      };
    })
    .filter((item) => item.id && item.imageUrl)
    .sort(
      (left, right) =>
        left.category.localeCompare(right.category) ||
        left.sortOrder - right.sortOrder,
    );
}

/**
 * Which profile's addon rows to read.
 *
 * A profile set to mirror the primary keeps no rows of its own, so querying by
 * its own index returns nothing and the home page comes up empty. Matches the
 * desktop client's `effective_addon_profile_id`.
 */
export function effectiveAddonProfileIndex(profile: Profile | null): number {
  if (!profile) return 1;
  return profile.usesPrimaryAddons && profile.profileIndex !== 1
    ? 1
    : profile.profileIndex;
}

export async function loadAddons(profileIndex: number): Promise<AddonRow[]> {
  const query = new URLSearchParams({
    profile_id: `eq.${profileIndex}`,
    select: "url,name,enabled,sort_order",
    order: "sort_order.asc",
  });
  const rows = await secureAuthorized<Array<Record<string, unknown>>>(
    `/rest/v1/addons?${query}`,
  );
  return rows.map((row) => ({
    url: String(row.url ?? ""),
    name: row.name ? String(row.name) : undefined,
    enabled: row.enabled !== false,
    sortOrder: Number(row.sort_order ?? 0),
  }));
}

export async function saveAddons(
  profileIndex: number,
  addons: AddonRow[],
): Promise<void> {
  await rpc("sync_push_addons", {
    p_profile_id: profileIndex,
    p_addons: addons.map((addon, index) => ({
      url: addon.url,
      name: addon.name ?? "",
      enabled: addon.enabled,
      sort_order: index,
    })),
    p_origin_client_id: CLIENT_ID,
  });
}

function libraryMeta(row: Record<string, unknown>): LibraryItem {
  const manifest = String(row.addon_base_url ?? "");
  return {
    id: String(row.content_id ?? ""),
    type: String(row.content_type ?? "movie"),
    name: String(row.name ?? "Untitled"),
    poster: row.poster ? String(row.poster) : undefined,
    background: row.background ? String(row.background) : undefined,
    description: row.description ? String(row.description) : undefined,
    releaseInfo: row.release_info ? String(row.release_info) : undefined,
    imdbRating: row.imdb_rating != null ? String(row.imdb_rating) : undefined,
    genres: Array.isArray(row.genres) ? row.genres.map(String) : [],
    cast: [],
    director: [],
    writer: [],
    trailers: [],
    externalRatings: [],
    videos: [],
    manifestUrl:
      !manifest || manifest.includes("manifest.json")
        ? manifest
        : `${manifest.replace(/\/+$/, "")}/manifest.json`,
    addonName: "",
    addedAt: Number(row.added_at ?? 0),
  };
}

export async function loadLibrary(
  profileIndex: number,
): Promise<LibraryItem[]> {
  const result: LibraryItem[] = [];
  for (let offset = 0; offset < 1000; offset += 200) {
    const rows = await rpc<Array<Record<string, unknown>>>(
      "sync_pull_library",
      { p_profile_id: profileIndex, p_limit: 200, p_offset: offset },
    );
    result.push(...rows.map(libraryMeta));
    if (rows.length < 200) break;
  }
  return result;
}

export async function loadProgress(
  profileIndex: number,
): Promise<ProgressRow[]> {
  const rows = await rpc<Array<Record<string, unknown>>>(
    "sync_pull_watch_progress",
    { p_profile_id: profileIndex, p_limit: 1000 },
  );
  return rows.map((row) => ({
    contentId: String(row.content_id ?? ""),
    contentType: String(row.content_type ?? ""),
    videoId: String(row.video_id ?? ""),
    season: row.season == null ? undefined : Number(row.season),
    episode: row.episode == null ? undefined : Number(row.episode),
    positionMs: Number(row.position ?? row.position_ms ?? 0),
    durationMs: Number(row.duration ?? row.duration_ms ?? 0),
    lastWatched: Number(row.last_watched ?? 0),
    progressKey: row.progress_key ? String(row.progress_key) : undefined,
  }));
}

export async function loadWatchedItems(
  profileIndex: number,
): Promise<WatchedItem[]> {
  const result: WatchedItem[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const rows = await rpc<Array<Record<string, unknown>>>(
      "sync_pull_watched_items",
      { p_profile_id: profileIndex, p_page: page, p_page_size: 200 },
    );
    result.push(
      ...rows
        .map((row) => ({
          contentId: String(row.content_id ?? ""),
          contentType: String(row.content_type ?? ""),
          title: String(row.title ?? ""),
          season: row.season == null ? undefined : Number(row.season),
          episode: row.episode == null ? undefined : Number(row.episode),
          watchedAt: Number(row.watched_at ?? 0),
        }))
        .filter((row) => row.contentId),
    );
    if (rows.length < 200) break;
  }
  return result;
}

/**
 * Nuvio stores settings per platform, one row each for `desktop` and
 * `mobile`. The web client has no row of its own, so it joins whichever one
 * matches the device it is running on: installed on a phone it shares the
 * mobile app's settings, on a desktop browser the desktop client's.
 */
export function settingsPlatform(): "desktop" | "mobile" {
  const coarse = matchMedia?.("(pointer: coarse)").matches ?? false;
  return coarse || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? "mobile"
    : "desktop";
}

export async function loadSettingsBlob(
  profileIndex: number,
): Promise<SettingsBlob> {
  const rows = await rpc<Array<Record<string, unknown>>>(
    "sync_pull_profile_settings_blob",
    { p_profile_id: profileIndex, p_platform: settingsPlatform() },
  );
  const value = rows?.[0]?.settings_json;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return emptySettingsBlob();
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as SettingsBlob)
    : emptySettingsBlob();
}

/** The RPC replaces the platform row wholesale, so callers always send all of it. */
export async function pushSettingsBlob(
  profileIndex: number,
  next: SettingsBlob,
): Promise<SettingsBlob> {
  await rpc("sync_push_profile_settings_blob", {
    p_profile_id: profileIndex,
    p_platform: settingsPlatform(),
    p_settings_json: next,
    p_origin_client_id: CLIENT_ID,
  });
  return next;
}

export type PinVerifyResult = {
  unlocked: boolean;
  retryAfterSeconds: number;
  message?: string;
};

/**
 * Checks a profile's PIN against the backend.
 *
 * The same RPC the official clients call, so a PIN set on one works on all of
 * them. Verification is deliberately server-side: the PIN is never sent to the
 * client to compare against, and the backend is what enforces the lockout after
 * repeated failures.
 */
export async function verifyProfilePin(
  profileIndex: number,
  pin: string,
): Promise<PinVerifyResult> {
  const raw = await rpc<unknown>("verify_profile_pin", {
    p_profile_id: profileIndex,
    p_pin: pin,
  });
  const row = (Array.isArray(raw) ? raw[0] : raw) as
    | Record<string, unknown>
    | undefined;
  return {
    unlocked: row?.unlocked === true,
    retryAfterSeconds: Number(row?.retry_after_seconds ?? 0) || 0,
    message: row?.message ? String(row.message) : undefined,
  };
}

export async function loadProviderCredentials(
  profileIndex: number,
): Promise<ProviderCredentialRow[]> {
  // Match the official client: create any provider rows that do not exist yet
  // before pulling the authoritative remote snapshot. The seed RPC only fills
  // missing rows, so existing/unknown credentials are never overwritten.
  const seedRows: ProviderCredentialRow[] = [
    { provider: "tmdb", credentialJson: { api_key: "" } },
    { provider: "mdblist", credentialJson: { api_key: "" } },
    { provider: "animeskip", credentialJson: { client_id: "" } },
    { provider: "introdb", credentialJson: { api_key: "" } },
  ];
  await rpc("sync_seed_provider_credentials", {
    p_profile_id: profileIndex,
    p_credentials: providerCredentialPayload(seedRows),
    p_origin_client_id: CLIENT_ID,
  });
  return decodeProviderCredentials(
    await rpc<unknown>("sync_pull_provider_credentials", {
      p_profile_id: profileIndex,
    }),
  );
}

/**
 * Credential pushes replace the provider array wholesale. Pull immediately
 * before the merge so a browser tab cannot erase a credential changed by a
 * different Nuvio client since startup.
 */
export async function updateProviderCredential(
  profileIndex: number,
  provider: "tmdb" | "mdblist" | "animeskip" | "introdb",
  value: string,
): Promise<ProviderCredentialRow[]> {
  const field = provider === "animeskip" ? "client_id" : "api_key";
  const current = await loadProviderCredentials(profileIndex);
  const next = withProviderCredential(current, provider, field, value);
  await rpc("sync_push_provider_credentials", {
    p_profile_id: profileIndex,
    p_credentials: providerCredentialPayload(next),
    p_origin_client_id: CLIENT_ID,
  });
  return next;
}

/** Reads one typed boolean out of the blob, matching Nuvio's storage shape. */
export function blobBoolean(
  blob: SettingsBlob | null,
  feature: string,
  key: string,
  fallback: boolean,
): boolean {
  return blobTypedValue(blob, feature, key, "boolean", fallback);
}

/**
 * Writes one typed boolean and pushes the whole blob back.
 *
 * The push replaces the row wholesale, so the existing blob has to be read,
 * merged into, and returned intact — sending only the changed key would drop
 * every other setting on that platform.
 */
export async function pushBlobBoolean(
  profileIndex: number,
  blob: SettingsBlob,
  feature: string,
  key: string,
  value: boolean,
): Promise<SettingsBlob> {
  return pushSettingsBlob(
    profileIndex,
    withBlobTypedValue(blob, feature, key, "boolean", value),
  );
}

/**
 * Episode release alerts are stored as a **raw** boolean, not the typed
 * `{type,value}` wrapper every other setting uses — Nuvio decodes
 * `notifications_settings` into a plain payload struct. Writing it typed would
 * make the other clients read it as false.
 */
export function blobRawBoolean(
  blob: SettingsBlob | null,
  feature: string,
  key: string,
  fallback: boolean,
): boolean {
  return blobRawValue(
    blob,
    feature,
    key,
    (value): value is boolean => typeof value === "boolean",
    fallback,
  );
}

export async function pushBlobRawBoolean(
  profileIndex: number,
  blob: SettingsBlob,
  feature: string,
  key: string,
  value: boolean,
): Promise<SettingsBlob> {
  return pushSettingsBlob(
    profileIndex,
    withBlobRawValue(blob, feature, key, value),
  );
}

/** Identifies one watchable thing: a movie, or one episode of a series. */
export type WatchIdentity = {
  contentId: string;
  contentType: string;
  season?: number;
  episode?: number;
};

/**
 * Nuvio's key for a resume point. A half-identified episode falls back to the
 * bare content id, matching buildWatchProgressKey on the other clients — get
 * this wrong and the row is orphaned rather than replaced.
 */
function buildProgressKey(identity: WatchIdentity): string {
  return identity.season != null && identity.episode != null
    ? `${identity.contentId}_s${identity.season}e${identity.episode}`
    : identity.contentId;
}

/**
 * The server's stored key is opaque and may have come from another client, so
 * an existing row's key always wins over a recomputed one. Recomputing would
 * insert a duplicate instead of replacing the row.
 */
function resolveProgressKey(
  rows: ProgressRow[],
  identity: WatchIdentity,
): string {
  const logical = rows.filter(
    (row) =>
      row.contentId === identity.contentId &&
      row.season === identity.season &&
      row.episode === identity.episode,
  );
  const freshest = [...logical].sort((a, b) => b.lastWatched - a.lastWatched)[0];
  return freshest?.progressKey?.trim() || buildProgressKey(identity);
}

/**
 * Marks or clears one title/episode as watched, and drops any resume point for
 * it so the two can never disagree. Mirrors the desktop client's payloads
 * exactly; `progressRows` is the current snapshot, used only to recover the
 * server's own progress key.
 */
export async function setWatched(
  profileIndex: number,
  identity: WatchIdentity,
  title: string,
  watched: boolean,
  progressRows: ProgressRow[],
): Promise<void> {
  if (watched) {
    await rpc("sync_push_watched_items", {
      p_profile_id: profileIndex,
      p_items: [
        {
          content_id: identity.contentId,
          content_type: identity.contentType,
          title,
          season: identity.season ?? null,
          episode: identity.episode ?? null,
          watched_at: Date.now(),
        },
      ],
      p_origin_client_id: CLIENT_ID,
    });
  } else {
    await rpc("sync_delete_watched_items", {
      p_profile_id: profileIndex,
      p_keys: [
        {
          content_id: identity.contentId,
          season: identity.season ?? null,
          episode: identity.episode ?? null,
        },
      ],
      p_origin_client_id: CLIENT_ID,
    });
  }
  // A stale resume point would still draw a progress bar under a row the user
  // just toggled, so clear it in both directions.
  await rpc("sync_delete_watch_progress", {
    p_profile_id: profileIndex,
    p_keys: [resolveProgressKey(progressRows, identity)],
    p_origin_client_id: CLIENT_ID,
  });
}

/**
 * Drops the resume point for one title/episode, leaving its watched mark alone.
 *
 * `setWatched` also clears progress, but only as a consequence of deciding
 * watched or not. A part-watched episode is neither: it reads as unwatched, so
 * the only toggle on offer marks it watched — which is not what starting it
 * over means. This is the way back to untouched.
 */
export async function clearProgress(
  profileIndex: number,
  identity: WatchIdentity,
  progressRows: ProgressRow[],
): Promise<void> {
  await rpc("sync_delete_watch_progress", {
    p_profile_id: profileIndex,
    p_keys: [resolveProgressKey(progressRows, identity)],
    p_origin_client_id: CLIENT_ID,
  });
}

/**
 * Adds one title to the synced library.
 *
 * Field-for-field with the desktop client's `library::add`. Two details are
 * easy to get wrong and both would write a row Nuvio reads back badly:
 * `imdb_rating` is stored as a **number**, not the display string, and
 * `poster_shape` is upper-cased with "POSTER" as the default.
 */
export async function addToLibrary(
  profileIndex: number,
  item: Meta,
): Promise<void> {
  const rating = Number.parseFloat(item.imdbRating ?? "");
  await rpc("sync_push_library_items", {
    p_profile_id: profileIndex,
    p_items: [
      {
        content_id: item.id,
        content_type: item.type,
        name: item.name,
        poster: item.poster ?? null,
        poster_shape: (item.posterShape ?? "POSTER").toUpperCase(),
        // Nuvio falls back to the banner when there is no backdrop.
        background: item.background ?? item.banner ?? null,
        description: item.description ?? null,
        release_info: item.releaseInfo ?? null,
        imdb_rating: Number.isFinite(rating) ? rating : null,
        genres: item.genres ?? [],
        addon_base_url: item.manifestUrl ?? "",
        added_at: Date.now(),
      },
    ],
    p_origin_client_id: CLIENT_ID,
  });
}

export async function removeFromLibrary(
  profileIndex: number,
  contentId: string,
  contentType: string,
): Promise<void> {
  await rpc("sync_delete_library_items", {
    p_profile_id: profileIndex,
    p_keys: [{ content_id: contentId, content_type: contentType }],
    p_origin_client_id: CLIENT_ID,
  });
}

/** Below this, a resume point is noise rather than a position worth keeping. */
const PROGRESS_STORE_THRESHOLD_MS = 1000;
const COMPLETION_THRESHOLD_FRACTION = 0.9;

export const isComplete = (
  positionMs: number,
  durationMs: number,
  ended: boolean,
) =>
  ended ||
  (durationMs > 0 && positionMs / durationMs >= COMPLETION_THRESHOLD_FRACTION);

/**
 * Stores a resume point, mirroring the desktop client's `progress::push`.
 *
 * A finished row is pinned to the full duration rather than left at 9x%.
 * Without that the other clients keep the title in Continue Watching forever
 * and never advance to the next episode.
 */
export async function pushProgress(
  profileIndex: number,
  identity: WatchIdentity & { videoId: string },
  positionMs: number,
  durationMs: number,
  ended: boolean,
  progressRows: ProgressRow[],
): Promise<boolean> {
  const position = Math.max(0, Math.round(positionMs));
  const duration = Math.max(0, Math.round(durationMs));
  const completed = isComplete(position, duration, ended);
  if (!completed && position < PROGRESS_STORE_THRESHOLD_MS) return false;
  await rpc("sync_push_watch_progress", {
    p_profile_id: profileIndex,
    p_entries: [
      {
        content_id: identity.contentId,
        content_type: identity.contentType,
        video_id: identity.videoId,
        season: identity.season ?? null,
        episode: identity.episode ?? null,
        position: completed && duration > 0 ? duration : position,
        duration,
        last_watched: Date.now(),
        progress_key: resolveProgressKey(progressRows, identity),
      },
    ],
    p_origin_client_id: CLIENT_ID,
  });
  return true;
}

export function currentSession(): Session | null {
  return activeSession;
}

/**
 * Collections for the home screen.
 *
 * The row stores its payload in `collections_json`, which the backend may hand
 * back either as a JSON string or as an already-parsed object depending on the
 * column type — the desktop client handles both, so this does too.
 */
export async function loadCollections(
  profileIndex: number,
): Promise<Collection[]> {
  const rows = await rpc<Array<Record<string, unknown>>>(
    "sync_pull_collections",
    { p_profile_id: profileIndex },
  );
  const raw = rows?.[0]?.collections_json;
  if (raw == null) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) => {
      const value = entry as Record<string, unknown>;
      const folders = Array.isArray(value.folders) ? value.folders : [];
      return {
        id: String(value.id ?? ""),
        title: String(value.title ?? "Collection"),
        backdropImageUrl: value.backdropImageUrl
          ? String(value.backdropImageUrl)
          : undefined,
        pinToTop: !!value.pinToTop,
        folders: folders.map((item) => {
          const folder = item as Record<string, unknown>;
          // Two lists exist and only one is authoritative. Nuvio writes modern
          // sources — the ones that can be TMDB or Trakt — to `sources`, and
          // keeps `catalogSources` as a legacy addon-only fallback for folders
          // saved by older builds. Its `resolvedSources` is
          // `sources.ifEmpty { catalogSources }`, and reading only the fallback
          // is why every TMDB/Trakt collection arrived with nothing in it.
          const modern = Array.isArray(folder.sources) ? folder.sources : [];
          const legacy = Array.isArray(folder.catalogSources)
            ? folder.catalogSources
            : [];
          const sources = modern.length ? modern : legacy;
          return {
            id: String(folder.id ?? ""),
            title: String(folder.title ?? "Folder"),
            coverImageUrl: folder.coverImageUrl
              ? String(folder.coverImageUrl)
              : undefined,
            coverEmoji: folder.coverEmoji
              ? String(folder.coverEmoji)
              : undefined,
            tileShape: folder.tileShape ? String(folder.tileShape) : undefined,
            hideTitle: !!folder.hideTitle,
            catalogSources: sources.map((source) => {
              const entry = source as Record<string, unknown>;
              return {
                // Nuvio omits this for addon sources and sets it to "tmdb" or
                // "trakt" otherwise. Dropping it made every TMDB and Trakt
                // source look like an addon source with a blank addonId, which
                // then failed as "Collection addon  is not installed".
                provider: String(entry.provider ?? "addon").toLowerCase(),
                addonId: String(entry.addonId ?? ""),
                type: String(entry.type ?? ""),
                catalogId: String(entry.catalogId ?? ""),
                genre: entry.genre ? String(entry.genre) : undefined,
                title: entry.title ? String(entry.title) : undefined,
                mediaType: entry.mediaType ? String(entry.mediaType) : undefined,
                tmdbSourceType: entry.tmdbSourceType
                  ? String(entry.tmdbSourceType)
                  : undefined,
                tmdbId: Number.isFinite(Number(entry.tmdbId))
                  ? Number(entry.tmdbId)
                  : undefined,
                traktListId: Number.isFinite(Number(entry.traktListId))
                  ? Number(entry.traktListId)
                  : undefined,
                sortBy: entry.sortBy ? String(entry.sortBy) : undefined,
                sortHow: entry.sortHow ? String(entry.sortHow) : undefined,
                // Kept as-is: these are TMDB discover parameters and the
                // service, not this client, decides what they mean.
                filters:
                  entry.filters && typeof entry.filters === "object"
                    ? (entry.filters as Record<string, string | number>)
                    : undefined,
              };
            }),
          } satisfies CollectionFolder;
        }),
      } satisfies Collection;
    })
    .filter((collection) => collection.id);
}

/**
 * The home layout: which catalogs and collections are shown, and in what
 * order. Writes use the same shared payload as Nuvio and merge a fresh remote
 * copy first so fields introduced by another client are not discarded.
 *
 * Nuvio keeps this in a `home_catalog_shared` row, with `mobile` and `tv` rows
 * left over from before it was shared. The shared row wins; the legacy ones
 * only fill in when it is absent.
 */
const HOME_LAYOUT_PLATFORMS = ["home_catalog_shared", "mobile", "tv"] as const;
export const COLLECTION_KEY_PREFIX = "collection_";

export type HomeLayoutItem = {
  key: string;
  enabled: boolean;
  order: number;
  isCollection: boolean;
  customTitle: string;
  /** Original synced row, retained so newer Nuvio fields survive edits. */
  raw: Record<string, unknown>;
};
export type HomeLayout = {
  items: HomeLayoutItem[];
  /** Ordering position by preference key, for a stable sort. */
  orderOf: Map<string, number>;
  enabledOf: Map<string, boolean>;
  /** A row renamed in Nuvio wins over the generated title. */
  customTitleOf: Map<string, string>;
  /** Appends " - Movies"/" - Series" to catalog rows. Defaults on. */
  showCatalogType: boolean;
  hideUnreleasedContent: boolean;
};

/** Mirrors the desktop client's `media_type_label`. */
export function mediaTypeLabel(contentType: string): string {
  const value = contentType.trim().toLowerCase();
  if (value === "movie") return "Movies";
  if (value === "series") return "Series";
  if (value === "anime") return "Anime";
  if (value === "channel") return "Channels";
  if (value === "tv") return "TV";
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

/**
 * Mirrors Kotlin's `SyncCatalogItem.preferenceKey()`. The explicit `key` wins,
 * because addon ids can themselves contain colons — which makes rebuilding the
 * three-part form ambiguous.
 */
function preferenceKey(item: Record<string, unknown>): string {
  const explicit = String(item.key ?? "").trim();
  if (explicit) return explicit;
  if (item.is_collection)
    return `${COLLECTION_KEY_PREFIX}${String(item.collection_id ?? "")}`;
  return `${String(item.addon_id ?? "")}:${String(item.type ?? "")}:${String(item.catalog_id ?? "")}`;
}

export async function loadHomeLayout(
  profileIndex: number,
): Promise<HomeLayout | null> {
  for (const platform of HOME_LAYOUT_PLATFORMS) {
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await rpc<Array<Record<string, unknown>>>(
        "sync_pull_home_catalog_settings",
        { p_profile_id: profileIndex, p_platform: platform },
      );
    } catch {
      // A network failure is not "no layout" — fall through and try the next
      // platform rather than treating it as an empty result.
      continue;
    }
    const raw = rows?.[0]?.settings_json;
    if (raw == null) continue;
    let parsed: unknown = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
    }
    const payload = parsed as {
      items?: Array<Record<string, unknown>>;
      show_catalog_type?: boolean;
      hide_unreleased_content?: boolean;
    };
    if (!Array.isArray(payload?.items) || payload.items.length === 0) continue;

    const items: HomeLayoutItem[] = payload.items.map((item) => ({
      key: preferenceKey(item),
      enabled: item.enabled !== false,
      order: Number(item.order ?? 0),
      isCollection: !!item.is_collection,
      customTitle: String(item.custom_title ?? ""),
      raw: { ...item },
    }));
    items.sort((a, b) => a.order - b.order);
    return {
      items,
      orderOf: new Map(items.map((item, index) => [item.key, index])),
      enabledOf: new Map(items.map((item) => [item.key, item.enabled])),
      customTitleOf: new Map(
        items
          .filter((item) => item.customTitle.trim())
          .map((item) => [item.key, item.customTitle.trim()]),
      ),
      // Absent means older payload; the other clients default this on.
      showCatalogType: payload.show_catalog_type !== false,
      hideUnreleasedContent: payload.hide_unreleased_content === true,
    };
  }
  return null;
}

/** Plugin repositories use the same authoritative ordered-list model as Nuvio. */
export async function loadPlugins(profileIndex: number): Promise<PluginRow[]> {
  const query = new URLSearchParams({
    profile_id: `eq.${profileIndex}`,
    select: "url,name,enabled,sort_order",
    order: "sort_order.asc",
  });
  const rows = await secureAuthorized<Array<Record<string, unknown>>>(
    `/rest/v1/plugins?${query}`,
  );
  return rows.map((row) => ({
    url: String(row.url ?? ""),
    name: row.name ? String(row.name) : undefined,
    enabled: row.enabled !== false,
    sortOrder: Number(row.sort_order ?? 0),
  }));
}

export async function savePlugins(
  profileIndex: number,
  plugins: PluginRow[],
): Promise<void> {
  await rpc("sync_push_plugins", {
    p_profile_id: profileIndex,
    p_plugins: plugins.map((plugin, index) => ({
      url: plugin.url,
      name: plugin.name ?? "",
      // The official client syncs repository installation, not local scraper
      // switches. Repositories therefore remain enabled in the server row.
      enabled: true,
      sort_order: index,
    })),
  });
}

/**
 * Pushes the shared Home organizer without dropping fields introduced by a
 * newer Nuvio client. Home settings are a separate whole-payload sync (not a
 * profile-settings feature), so the shared row is re-read immediately before
 * each merge and write.
 */
export async function pushHomeLayout(
  profileIndex: number,
  next: HomeLayout,
): Promise<HomeLayout> {
  const rows = await rpc<Array<Record<string, unknown>>>(
    "sync_pull_home_catalog_settings",
    { p_profile_id: profileIndex, p_platform: "home_catalog_shared" },
  );
  const rawPayload = rows?.[0]?.settings_json;
  let remote: Record<string, unknown> = {};
  try {
    const parsed =
      typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      remote = { ...(parsed as Record<string, unknown>) };
  } catch {
    throw new Error("The synced Home layout could not be read safely.");
  }

  const remoteItems = Array.isArray(remote.items)
    ? remote.items.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  const nextKeys = new Set(next.items.map((item) => item.key));
  const items: Record<string, unknown>[] = next.items.map((item, order) => ({
    ...item.raw,
    enabled: item.enabled,
    order,
    custom_title: item.customTitle,
    key: item.raw.key ?? item.key,
  }));
  // A catalog installed by another device since this screen loaded is unknown
  // here, not deleted. Preserve it after the edited rows.
  for (const item of remoteItems) {
    if (!nextKeys.has(preferenceKey(item))) items.push(item);
  }

  await rpc("sync_push_home_catalog_settings", {
    p_profile_id: profileIndex,
    p_platform: "home_catalog_shared",
    p_settings_json: {
      ...remote,
      show_catalog_type: next.showCatalogType,
      hide_unreleased_content: next.hideUnreleasedContent,
      items,
    },
    p_origin_client_id: CLIENT_ID,
  });
  return (await loadHomeLayout(profileIndex)) ?? next;
}

// ---------------------------------------------------------------------------
// Delta sync
//
// Pulling every progress and watched row on each load does not scale with a
// long history. The backend keeps an append-only event log per table, so a
// client snapshots once and then asks only for what changed.
//
// The ordering below is load-bearing and mirrors Nuvio's own client: read the
// cursor BEFORE taking the snapshot. A write landing mid-snapshot is then
// replayed as a delta rather than lost between the two calls.
// ---------------------------------------------------------------------------

const DELTA_PAGE_SIZE = 900;

export type DeltaOperation = "upsert" | "delete";

async function deltaCursor(rpcName: string, profileIndex: number) {
  const value = await rpc<number | null>(rpcName, { p_profile_id: profileIndex });
  return typeof value === "number" ? value : null;
}

/**
 * Walks the event log from `since`, applying each page via `apply`.
 * Returns the new cursor. A short page means the log is caught up.
 */
async function drainDelta(
  rpcName: string,
  profileIndex: number,
  since: number,
  apply: (events: Array<Record<string, unknown>>) => void,
): Promise<number> {
  let cursor = since;
  for (;;) {
    const events = await rpc<Array<Record<string, unknown>>>(rpcName, {
      p_profile_id: profileIndex,
      p_since_event_id: cursor,
      p_limit: DELTA_PAGE_SIZE,
    });
    if (!events?.length) break;
    apply(events);
    cursor = events.reduce(
      (highest, event) => Math.max(highest, Number(event.event_id ?? 0)),
      cursor,
    );
    if (events.length < DELTA_PAGE_SIZE) break;
  }
  return cursor;
}

export const progressDeltaCursor = (profileIndex: number) =>
  deltaCursor("sync_get_watch_progress_delta_cursor", profileIndex);
export const watchedDeltaCursor = (profileIndex: number) =>
  deltaCursor("sync_get_watched_items_delta_cursor", profileIndex);

/** Applies progress events onto a snapshot, keyed the way the server keys them. */
export async function pullProgressDelta(
  profileIndex: number,
  since: number,
  rows: ProgressRow[],
): Promise<{ rows: ProgressRow[]; cursor: number }> {
  const byKey = new Map(rows.map((row) => [row.progressKey ?? "", row]));
  const cursor = await drainDelta(
    "sync_pull_watch_progress_delta",
    profileIndex,
    since,
    (events) => {
      for (const event of events) {
        const key = String(event.progress_key ?? "");
        if (String(event.operation ?? "").toLowerCase() === "delete") {
          byKey.delete(key);
          continue;
        }
        byKey.set(key, {
          contentId: String(event.content_id ?? ""),
          contentType: String(event.content_type ?? ""),
          videoId: String(event.video_id ?? ""),
          season: event.season == null ? undefined : Number(event.season),
          episode: event.episode == null ? undefined : Number(event.episode),
          positionMs: Number(event.position ?? 0),
          durationMs: Number(event.duration ?? 0),
          lastWatched: Number(event.last_watched ?? 0),
          progressKey: key,
        });
      }
    },
  );
  return { rows: [...byKey.values()].filter((row) => row.contentId), cursor };
}

export async function pullWatchedDelta(
  profileIndex: number,
  since: number,
  items: WatchedItem[],
): Promise<{ items: WatchedItem[]; cursor: number }> {
  const key = (item: { contentId: string; season?: number; episode?: number }) =>
    `${item.contentId}:${item.season ?? ""}:${item.episode ?? ""}`;
  const byKey = new Map(items.map((item) => [key(item), item]));
  const cursor = await drainDelta(
    "sync_pull_watched_items_delta",
    profileIndex,
    since,
    (events) => {
      for (const event of events) {
        const entry: WatchedItem = {
          contentId: String(event.content_id ?? ""),
          contentType: String(event.content_type ?? ""),
          title: String(event.title ?? ""),
          season: event.season == null ? undefined : Number(event.season),
          episode: event.episode == null ? undefined : Number(event.episode),
          watchedAt: Number(event.watched_at ?? 0),
        };
        if (String(event.operation ?? "").toLowerCase() === "delete")
          byKey.delete(key(entry));
        else byKey.set(key(entry), entry);
      }
    },
  );
  return { items: [...byKey.values()].filter((item) => item.contentId), cursor };
}
