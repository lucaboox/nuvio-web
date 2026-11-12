/// <reference lib="webworker" />

import type { AuthUser, BackendConfig } from "../types";
import { deleteValue, getValue, setValue } from "../lib/idb";

const SESSION_KEY = "refresh-session";
const BACKEND_KEY = "backend-config";
const AUTH_LOCK_KEY = "nuvio-web-auth-session";
const AUTH_CHANNEL_NAME = "nuvio-web-auth-vault-v2";
const workerId = globalThis.crypto.randomUUID();
const authChannel = new BroadcastChannel(AUTH_CHANNEL_NAME);

type WorkerCommand =
  | {
      id: number;
      type: "signIn";
      backend: BackendConfig;
      email: string;
      password: string;
    }
  | { id: number; type: "signOut" }
  | { id: number; type: "restore" }
  | {
      id: number;
      type: "request";
      path: string;
      init: { method?: string; body?: string; headers?: Record<string, string> };
    };

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  user?: AuthUser;
};

type StoredRefreshSession = {
  backend: BackendConfig;
  refreshToken: string;
  user: AuthUser;
  updatedAt: number;
};

type LegacyRefreshSession = {
  backendUrl?: string;
  refreshToken?: string;
  userId?: string;
  email?: string;
};

type WorkerResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string; retryable?: boolean };

/**
 * A refresh that could not be made, as opposed to one that was refused. The
 * stored session is kept and the page tries again rather than signing out.
 */
class RetryableError extends Error {
  readonly retryable = true;
}

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

let backend: BackendConfig | null = null;
let user: AuthUser | null = null;
let accessToken = "";
let refreshToken = "";
let generation = 0;
let requestController = new AbortController();
let refreshFlight: Promise<string> | null = null;

function clearMemorySession() {
  requestController.abort();
  requestController = new AbortController();
  generation += 1;
  backend = null;
  user = null;
  accessToken = "";
  refreshToken = "";
  refreshFlight = null;
}

async function clearSession() {
  clearMemorySession();
  await deleteValue(SESSION_KEY);
}

function invalidateOtherVaults() {
  authChannel.postMessage({ type: "invalidate", source: workerId });
}

authChannel.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data as { type?: string; source?: string } | null;
  if (message?.type === "invalidate" && message.source !== workerId)
    clearMemorySession();
});

async function withAuthLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(AUTH_LOCK_KEY, { mode: "exclusive" }, work);
  return work();
}

function assertRestPath(path: string) {
  if (
    !path.startsWith("/rest/v1/") ||
    path.includes("\\") ||
    /[\r\n\0]/.test(path)
  )
    throw new Error("The requested backend path is not allowed.");
}

function assertBackend(value: BackendConfig | null | undefined): BackendConfig {
  if (!value || typeof value.url !== "string" || typeof value.key !== "string")
    throw new Error("The saved backend configuration is invalid.");
  const parsed = new URL(value.url);
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !value.key?.trim() ||
    value.key.length > 16_384
  )
    throw new Error("The saved backend configuration is invalid.");
  return { ...value, url: parsed.toString().replace(/\/+$/, ""), key: value.key.trim() };
}

function validRefreshToken(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 16_384;
}

async function fetchJson<T>(
  targetBackend: BackendConfig,
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> },
  token = "",
  signal?: AbortSignal,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.delete("authorization");
  headers.delete("apikey");
  headers.set("apikey", targetBackend.key);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const timeoutController = new AbortController();
  const abort = () => timeoutController.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 20_000);
  try {
    const response = await fetch(`${targetBackend.url}${path}`, {
      method: init.method,
      body: init.body,
      headers,
      signal: timeoutController.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      let message = `Backend request failed (${response.status})`;
      try {
        const parsed = JSON.parse(text) as { msg?: string; message?: string };
        message = parsed.msg || parsed.message || message;
      } catch {
        if (text.trim()) message = text.slice(0, 240);
      }
      throw new RequestError(message, response.status);
    }
    return (text ? JSON.parse(text) : null) as T;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

async function acceptTokens(
  payload: TokenPayload,
  expectedGeneration: number,
  targetBackend: BackendConfig,
) {
  const nextAccess = payload.access_token?.trim();
  const nextRefresh = payload.refresh_token?.trim();
  if (!nextAccess || !nextRefresh || expectedGeneration !== generation)
    throw new Error("The backend did not return a usable session.");
  const nextUser = payload.user?.id ? payload.user : user;
  if (!nextUser?.id) throw new Error("The backend did not return a usable user.");
  // Rotation is durable before the new access token becomes usable. Only the
  // refresh credential is persisted; access tokens remain Worker-memory-only.
  await setValue<StoredRefreshSession>(SESSION_KEY, {
    backend: targetBackend,
    refreshToken: nextRefresh,
    user: nextUser,
    updatedAt: Date.now(),
  });
  if (expectedGeneration !== generation)
    throw new Error("The Nuvio session changed while signing in.");
  backend = targetBackend;
  accessToken = nextAccess;
  refreshToken = nextRefresh;
  user = nextUser;
}

async function refresh(): Promise<string> {
  if (refreshFlight) return refreshFlight;
  const currentBackend = backend;
  const currentGeneration = generation;
  if (!currentBackend || !refreshToken)
    throw new Error("The Nuvio session has expired. Sign in again.");
  const run = withAuthLock(async () => {
    const saved = await getValue<StoredRefreshSession>(SESSION_KEY);
    if (
      !saved ||
      saved.backend.url !== currentBackend.url ||
      !saved.refreshToken.trim()
    )
      throw new Error("The saved Nuvio session has expired. Sign in again.");
    const payload = await fetchJson<TokenPayload>(
      currentBackend,
      "/auth/v1/token?grant_type=refresh_token",
      { method: "POST", body: JSON.stringify({ refresh_token: saved.refreshToken }) },
      "",
      requestController.signal,
    );
    await acceptTokens(payload, currentGeneration, currentBackend);
    return accessToken;
  })
    .catch(async (error) => {
      if (error instanceof RequestError && [400, 401, 403].includes(error.status)) {
        await clearSession();
        invalidateOtherVaults();
      }
      throw error;
    })
    .finally(() => {
      if (refreshFlight === run) refreshFlight = null;
    });
  refreshFlight = run;
  return run;
}

async function authorizedRequest(
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> },
) {
  assertRestPath(path);
  const currentBackend = backend;
  const currentGeneration = generation;
  if (!currentBackend || !accessToken)
    throw new Error("Sign in first.");
  try {
    return await fetchJson(
      currentBackend,
      path,
      init,
      accessToken,
      requestController.signal,
    );
  } catch (error) {
    if (!(error instanceof RequestError) || error.status !== 401) throw error;
    const refreshed = await refresh();
    if (currentGeneration !== generation)
      throw new Error("The Nuvio session changed while this request was running.");
    return fetchJson(
      currentBackend,
      path,
      init,
      refreshed,
      requestController.signal,
    );
  }
}

async function handle(command: WorkerCommand): Promise<unknown> {
  if (command.type === "restore") {
    clearMemorySession();
    return withAuthLock(async () => {
      const raw = await getValue<StoredRefreshSession | LegacyRefreshSession>(SESSION_KEY);
      if (!raw) return null;
      const legacyBackend = await getValue<BackendConfig>(BACKEND_KEY);
      const targetBackend = assertBackend(
        "backend" in raw && raw.backend ? raw.backend : legacyBackend!,
      );
      const restoredUser =
        "user" in raw && raw.user?.id
          ? raw.user
          : {
              id: (raw as LegacyRefreshSession).userId ?? "",
              email: (raw as LegacyRefreshSession).email,
            };
      if (!validRefreshToken(raw.refreshToken) || !restoredUser.id) {
        await deleteValue(SESSION_KEY);
        return null;
      }
      // Older builds persisted an access token beside the refresh token in the
      // shared store. Rewrite before any network request so even an offline
      // migration removes that unnecessary credential immediately.
      if (!("backend" in raw) || "accessToken" in raw) {
        await setValue<StoredRefreshSession>(SESSION_KEY, {
          backend: targetBackend,
          refreshToken: raw.refreshToken,
          user: restoredUser,
          updatedAt: Date.now(),
        });
      }
      backend = targetBackend;
      user = restoredUser;
      refreshToken = raw.refreshToken;
      const restoreGeneration = generation;
      try {
        const payload = await fetchJson<TokenPayload>(
          targetBackend,
          "/auth/v1/token?grant_type=refresh_token",
          {
            method: "POST",
            body: JSON.stringify({ refresh_token: raw.refreshToken }),
          },
          "",
          requestController.signal,
        );
        await acceptTokens(payload, restoreGeneration, targetBackend);
        return { user, backend: targetBackend };
      } catch (error) {
        clearMemorySession();
        // Refused: the refresh token is spent or revoked, so the session is
        // over. Anything else (offline, a timeout, a 5xx, a 429) says nothing
        // about the session, and signing out over it is what put people on the
        // sign-in screen whenever the backend had a bad moment at launch.
        if (error instanceof RequestError && [400, 401, 403].includes(error.status)) {
          await deleteValue(SESSION_KEY);
          return null;
        }
        throw new RetryableError(
          error instanceof Error ? error.message : "Could not reach Nuvio.",
        );
      }
    });
  }
  if (command.type === "signIn") {
    return withAuthLock(async () => {
      await clearSession();
      invalidateOtherVaults();
      const targetBackend = assertBackend(command.backend);
      backend = targetBackend;
      const signInGeneration = generation;
      try {
        const payload = await fetchJson<TokenPayload>(
          targetBackend,
          "/auth/v1/token?grant_type=password",
          {
            method: "POST",
            body: JSON.stringify({ email: command.email, password: command.password }),
          },
          "",
          requestController.signal,
        );
        if (!payload.user?.id)
          throw new Error("The backend did not return a usable session.");
        user = payload.user;
        await acceptTokens(payload, signInGeneration, targetBackend);
        return { user, backend: targetBackend };
      } catch (error) {
        clearMemorySession();
        throw error;
      }
    });
  }
  if (command.type === "signOut") {
    const oldBackend = backend;
    const oldAccess = accessToken;
    await withAuthLock(async () => {
      await clearSession();
      invalidateOtherVaults();
    });
    if (oldBackend && oldAccess) {
      // scope=local, which the endpoint does not default to. Without it
      // GoTrue revokes every refresh token the account holds, so signing out
      // of this browser signed the same account out of the TV, the desktop app
      // and every other device at once.
      void fetchJson(
        oldBackend,
        "/auth/v1/logout?scope=local",
        { method: "POST" },
        oldAccess,
      ).catch(() => undefined);
    }
    return null;
  }
  return authorizedRequest(command.path, command.init);
}

self.addEventListener("message", (event: MessageEvent<WorkerCommand>) => {
  const command = event.data;
  void handle(command).then(
    (value) =>
      self.postMessage({ id: command.id, ok: true, value } satisfies WorkerResponse),
    (error) =>
      self.postMessage({
        id: command.id,
        ok: false,
        error: error instanceof Error ? error.message : "Authentication failed.",
        retryable: error instanceof RetryableError,
      } satisfies WorkerResponse),
  );
});

export {};
