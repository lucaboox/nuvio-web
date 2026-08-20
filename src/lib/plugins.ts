import { platform } from "../platform";
import { normalizePluginManifestUrl } from "./pluginUrl";
import { safeHttpUrl } from "./security";
import type {
  PluginManifest,
  PluginManifestScraper,
  PluginRepository,
  PluginRow,
  PluginScraper,
  PluginState,
  Stream,
} from "../types";

// Browser providers are best-effort additions to the normal Stremio addon
// results. Native Nuvio can afford a longer QuickJS timeout, but making the
// source sheet wait a full minute for a CORS-blocked website feels like a
// frozen app. Keep both the whole invocation and each provider request
// bounded; a slow/incompatible plugin then fails without holding up addons.
const PLUGIN_TIMEOUT_MS = 15_000;
const PLUGIN_FETCH_TIMEOUT_MS = 10_000;
// Native Nuvio gives providers a controlled QuickJS/fetch bridge. A PWA
// cannot offer the same network boundary or CORS compatibility, so keep the
// implementation dormant until a safe web-specific runtime exists.
export const WEB_PLUGINS_SUPPORTED = false;
let pluginCryptoSourcePromise: Promise<string> | null = null;
function pluginCryptoSource(): Promise<string> {
  pluginCryptoSourcePromise ??= import("crypto-js/crypto-js.js?raw").then(
    (module) => module.default,
  );
  return pluginCryptoSourcePromise;
}
const EMPTY_STATE: PluginState = {
  pluginsEnabled: false,
  groupStreamsByRepository: false,
  repositories: [],
  scrapers: [],
};

const stateKey = (profileIndex: number) => `plugins_state_${profileIndex}`;
// Match Nuvio's device-local key exactly. Provider settings deliberately do
// not belong to the profile settings blob or the repository-list sync.
const settingsKey = (scraperId: string) => `settings_${scraperId}`;
const legacySettingsKey = (scraperId: string) => `plugin_settings_${scraperId}`;
export { normalizePluginManifestUrl } from "./pluginUrl";

export async function readLocalPluginState(
  profileIndex: number,
): Promise<PluginState> {
  const saved = await platform.storage.get<PluginState>(stateKey(profileIndex));
  return saved
    ? {
        pluginsEnabled: WEB_PLUGINS_SUPPORTED && saved.pluginsEnabled !== false,
        groupStreamsByRepository: saved.groupStreamsByRepository === true,
        repositories: Array.isArray(saved.repositories) ? saved.repositories : [],
        scrapers: Array.isArray(saved.scrapers) ? saved.scrapers : [],
      }
    : { ...EMPTY_STATE };
}

export async function persistPluginState(
  profileIndex: number,
  state: PluginState,
): Promise<void> {
  await platform.storage.set(stateKey(profileIndex), state);
}

function browserPlatformTags(): Set<string> {
  const ua = navigator.userAgent.toLowerCase();
  const mobile = /iphone|ipad|ipod|android/.test(ua);
  return new Set([
    "web",
    "browser",
    mobile ? "mobile" : "desktop",
    ...(ua.includes("iphone") || ua.includes("ipad") ? ["ios"] : []),
    ...(ua.includes("android") ? ["android"] : []),
    ...(ua.includes("windows") ? ["windows"] : []),
    ...(ua.includes("mac os") ? ["macos"] : []),
    ...(ua.includes("linux") ? ["linux"] : []),
  ]);
}

function supportedOnThisBrowser(scraper: PluginManifestScraper): boolean {
  const tags = browserPlatformTags();
  const supported = new Set(
    (scraper.supportedPlatforms ?? []).map((value) => value.toLowerCase()),
  );
  const disabled = new Set(
    (scraper.disabledPlatforms ?? []).map((value) => value.toLowerCase()),
  );
  if (supported.size && ![...tags].some((tag) => supported.has(tag))) return false;
  return ![...tags].some((tag) => disabled.has(tag));
}

async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } finally {
    window.clearTimeout(timer);
  }
}

function assertManifest(value: unknown): PluginManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid plugin manifest.");
  const manifest = value as Partial<PluginManifest>;
  if (!manifest.name?.trim()) throw new Error("Plugin manifest name is missing.");
  if (!manifest.version?.trim()) throw new Error("Plugin manifest version is missing.");
  if (!Array.isArray(manifest.scrapers) || manifest.scrapers.length === 0)
    throw new Error("Plugin manifest has no providers.");
  return manifest as PluginManifest;
}

export async function fetchPluginRepository(
  manifestUrl: string,
  previous: PluginState,
): Promise<{ repository: PluginRepository; scrapers: PluginScraper[] }> {
  const normalized = normalizePluginManifestUrl(manifestUrl);
  const payload = await fetchText(normalized);
  const manifest = assertManifest(JSON.parse(payload));
  const previousById = new Map(previous.scrapers.map((item) => [item.id, item]));
  const base = new URL(".", normalized);
  const settled = await Promise.allSettled(
    manifest.scrapers.filter(supportedOnThisBrowser).map(async (item) => {
      if (!item.id?.trim() || !item.name?.trim() || !item.filename?.trim())
        throw new Error("Plugin provider is missing required fields.");
      const id = `${normalized.toLowerCase()}:${item.id}`;
      const codeUrl = new URL(item.filename, base).toString();
      const code = await fetchText(codeUrl);
      const old = previousById.get(id);
      const manifestEnabled = item.enabled !== false;
      return {
        id,
        repositoryUrl: normalized,
        name: item.name,
        description: item.description ?? "",
        version: item.version ?? manifest.version,
        filename: item.filename,
        supportedTypes: item.supportedTypes ?? ["movie", "tv"],
        enabled: manifestEnabled && (old?.enabled ?? true),
        manifestEnabled,
        hasSettings: item.hasSettings === true,
        logo: item.logo ? new URL(item.logo, base).toString() : undefined,
        contentLanguage: item.contentLanguage ?? [],
        formats: item.formats ?? item.supportedFormats,
        code,
      } satisfies PluginScraper;
    }),
  );
  const scrapers = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (!scrapers.length)
    throw new Error(
      "No browser-compatible providers could be downloaded from this repository.",
    );
  return {
    repository: {
      manifestUrl: normalized,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      scraperCount: scrapers.length,
      lastUpdated: Date.now(),
    },
    scrapers,
  };
}

/**
 * Reconciles the authoritative synced repository rows with device-local code
 * and scraper switches. An empty first server pull preserves/migrates local
 * repositories, matching PluginRepository in the official client.
 */
export async function hydratePluginState(
  profileIndex: number,
  rows: PluginRow[],
): Promise<{ state: PluginState; migrationRows?: PluginRow[] }> {
  const local = await readLocalPluginState(profileIndex);
  const sourceRows = rows.length
    ? rows
    : local.repositories.map((repository, sortOrder) => ({
        url: repository.manifestUrl,
        name: repository.name,
        enabled: true,
        sortOrder,
      }));
  const wanted = new Set(sourceRows.map((row) => normalizePluginManifestUrl(row.url)));
  let state: PluginState = {
    ...local,
    repositories: local.repositories.filter((item) => wanted.has(item.manifestUrl)),
    scrapers: local.scrapers.filter((item) => wanted.has(item.repositoryUrl)),
  };
  const byUrl = new Map(state.repositories.map((item) => [item.manifestUrl, item]));
  const repositories: PluginRepository[] = [];
  for (const row of sourceRows.sort((a, b) => a.sortOrder - b.sortOrder)) {
    const url = normalizePluginManifestUrl(row.url);
    try {
      const refreshed = await fetchPluginRepository(url, state);
      repositories.push(refreshed.repository);
      state = {
        ...state,
        repositories: [...repositories],
        scrapers: [
          ...state.scrapers.filter((item) => item.repositoryUrl !== url),
          ...refreshed.scrapers,
        ],
      };
    } catch (error) {
      const existing = byUrl.get(url);
      repositories.push({
        manifestUrl: url,
        name: existing?.name || row.name || new URL(url).hostname,
        description: existing?.description,
        version: existing?.version,
        scraperCount:
          existing?.scraperCount ??
          state.scrapers.filter((item) => item.repositoryUrl === url).length,
        lastUpdated: existing?.lastUpdated ?? 0,
        error: error instanceof Error ? error.message : "Repository refresh failed.",
      });
    }
  }
  state = { ...state, repositories };
  await persistPluginState(profileIndex, state);
  return {
    state,
    migrationRows:
      rows.length === 0 && sourceRows.length > 0 ? sourceRows : undefined,
  };
}

export async function readPluginSettings(
  scraperId: string,
): Promise<Record<string, unknown>> {
  const saved = await platform.storage.get<Record<string, unknown>>(
    settingsKey(scraperId),
  );
  if (saved) return saved;
  // Keep the first prototype's values if somebody already configured a
  // provider before the storage key was aligned with Nuvio.
  const legacy = await platform.storage.get<Record<string, unknown>>(
    legacySettingsKey(scraperId),
  );
  if (legacy) await platform.storage.set(settingsKey(scraperId), legacy);
  return legacy ?? {};
}

export async function savePluginSettings(
  scraperId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  await platform.storage.set(settingsKey(scraperId), settings);
}

function sandboxSource(
  token: string,
  code: string,
  cryptoSource: string,
  action: "settings" | "streams",
  settings: Record<string, unknown>,
  args: unknown[],
): string {
  return `"use strict";
const __token = ${JSON.stringify(token)};
const __settings = ${JSON.stringify(settings)};
const __args = ${JSON.stringify(args)};
const __send = (ok, value) => parent.postMessage({ source: "nuvio-plugin-sandbox", token: __token, ok, value }, "*");
globalThis.SCRAPER_SETTINGS = __settings;
globalThis.process = { env: {} };
const __nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async function(input, init) {
  init = init || {};
  const controller = new AbortController();
  const upstream = init.signal;
  const abort = () => controller.abort(upstream && upstream.reason);
  if (upstream && upstream.aborted) abort();
  else if (upstream) upstream.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Plugin request timed out", "TimeoutError")), ${PLUGIN_FETCH_TIMEOUT_MS});
  try {
    return await __nativeFetch(input, {
      ...init,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (upstream) upstream.removeEventListener("abort", abort);
  }
};
globalThis.Buffer = class Buffer extends Uint8Array {
  static from(value, encoding) {
    if (typeof value !== "string") return new Buffer(value);
    if (encoding === "base64") return new Buffer(Uint8Array.from(atob(value), c => c.charCodeAt(0)));
    return new Buffer(new TextEncoder().encode(value));
  }
  toString(encoding) {
    if (encoding === "base64") return btoa(String.fromCharCode(...this));
    if (encoding === "hex") return Array.from(this, b => b.toString(16).padStart(2, "0")).join("");
    return new TextDecoder().decode(this);
  }
};
function __collection(nodes) {
  const list = Array.from(nodes || []);
  return {
    length: list.length,
    get: i => i == null ? list : list[i],
    first: () => __collection(list.slice(0, 1)),
    last: () => __collection(list.slice(-1)),
    eq: i => __collection([list[i < 0 ? list.length + i : i]].filter(Boolean)),
    find: selector => __collection(list.flatMap(node => Array.from(node.querySelectorAll?.(selector) || []))),
    text: () => list.map(node => node.textContent || "").join(""),
    html: () => list[0]?.innerHTML ?? null,
    attr: name => list[0]?.getAttribute?.(name) ?? undefined,
    next: () => __collection(list.map(node => node.nextElementSibling).filter(Boolean)),
    prev: () => __collection(list.map(node => node.previousElementSibling).filter(Boolean)),
    children: selector => __collection(list.flatMap(node => Array.from(node.children || [])).filter(node => !selector || node.matches?.(selector))),
    parent: () => __collection([...new Set(list.map(node => node.parentElement).filter(Boolean))]),
    filter: selectorOrCallback => __collection(list.filter((node, index) => typeof selectorOrCallback === "function" ? selectorOrCallback.call(node, index, node) : node.matches?.(selectorOrCallback))),
    toArray: () => list.slice(),
    each: fn => { list.forEach((node, index) => fn(index, node)); return __collection(list); },
    map: fn => ({ get: () => list.map((node, index) => fn(index, node)) }),
  };
}

const cheerio = { load(html) {
  const document = new DOMParser().parseFromString(String(html), "text/html");
  const $ = (selector, context) => {
    if (typeof selector !== "string") return __collection(selector?.length != null && !selector.nodeType ? selector : [selector]);
    const roots = context ? __collection(context).get() : [document];
    return __collection(roots.flatMap(root => Array.from(root.querySelectorAll(selector))));
  };
  $.html = value => value ? value.outerHTML : document.documentElement.outerHTML;
  $.root = () => __collection([document.documentElement]);
  return $;
}};
${cryptoSource}
const CryptoJS = globalThis.CryptoJS;
function __mergeAxios(defaults, input, extra) {
  const config = typeof input === "string"
    ? { ...(defaults || {}), ...(extra || {}), url: input }
    : { ...(defaults || {}), ...(input || {}) };
  config.headers = { ...((defaults || {}).headers || {}), ...((input && typeof input === "object" ? input.headers : extra?.headers) || {}) };
  return config;
}
function __axiosUrl(config) {
  let url = String(config.url || "");
  if (config.baseURL) url = new URL(url, String(config.baseURL).replace(/\\/?$/, "/")).toString();
  else url = new URL(url, location.href).toString();
  if (config.params && typeof config.params === "object") {
    const target = new URL(url);
    Object.entries(config.params).forEach(([key, value]) => {
      if (value == null) return;
      (Array.isArray(value) ? value : [value]).forEach(item => target.searchParams.append(key, String(item)));
    });
    url = target.toString();
  }
  return url;
}
async function axios(config, maybeConfig) {
  config = __mergeAxios({}, config, maybeConfig);
  const headers = { ...(config.headers || {}) };
  let body = config.data;
  if (body && typeof body === "object" && !(body instanceof FormData) && !(body instanceof URLSearchParams)) {
    body = JSON.stringify(body); if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
  }
  const controller = new AbortController();
  const timeout = Number(config.timeout || 0);
  const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : 0;
  let response;
  try {
    response = await fetch(__axiosUrl(config), { method: config.method || "GET", headers, body, credentials: "omit", redirect: "follow", referrerPolicy: "no-referrer", signal: controller.signal });
  } finally { if (timer) clearTimeout(timer); }
  let data;
  if (config.responseType === "arraybuffer") data = await response.arrayBuffer();
  else if (config.responseType === "blob") data = await response.blob();
  else {
    const text = await response.text();
    data = text;
    if (config.responseType !== "text") try { data = JSON.parse(text); } catch {}
  }
  const accepted = typeof config.validateStatus === "function" ? config.validateStatus(response.status) : response.ok;
  if (!accepted) { const error = new Error("HTTP " + response.status); error.response = { status: response.status, data }; throw error; }
  return { data, status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers.entries()), config };
}
axios.get = (url, config) => axios({ ...(config || {}), url, method: "GET" });
axios.post = (url, data, config) => axios({ ...(config || {}), url, data, method: "POST" });
axios.put = (url, data, config) => axios({ ...(config || {}), url, data, method: "PUT" });
axios.patch = (url, data, config) => axios({ ...(config || {}), url, data, method: "PATCH" });
axios.delete = (url, config) => axios({ ...(config || {}), url, method: "DELETE" });
axios.head = (url, config) => axios({ ...(config || {}), url, method: "HEAD" });
axios.request = config => axios(config);
axios.create = defaults => {
  const instance = (config, extra) => axios(__mergeAxios(defaults, config, extra));
  instance.get = (url, config) => instance(url, { ...(config || {}), method: "GET" });
  instance.post = (url, data, config) => instance(url, { ...(config || {}), data, method: "POST" });
  instance.put = (url, data, config) => instance(url, { ...(config || {}), data, method: "PUT" });
  instance.patch = (url, data, config) => instance(url, { ...(config || {}), data, method: "PATCH" });
  instance.delete = (url, config) => instance(url, { ...(config || {}), method: "DELETE" });
  instance.head = (url, config) => instance(url, { ...(config || {}), method: "HEAD" });
  instance.request = config => instance(config);
  instance.defaults = defaults || {};
  return instance;
};
axios.default = axios;
cheerio.default = cheerio;
function require(name) {
  if (["cheerio", "cheerio-without-node-native", "react-native-cheerio"].includes(name)) return cheerio;
  if (name === "crypto-js") return CryptoJS;
  if (name === "axios") return axios;
  throw new Error("Unsupported browser plugin module: " + name);
}
var module = { exports: {} }; var exports = module.exports;
try {
  (function() {\n${code}\n})();
  Promise.resolve().then(async () => {
    if (${JSON.stringify(action)} === "settings") {
      const fn = module.exports.onSettings || globalThis.onSettings;
      __send(true, typeof fn === "function" ? await fn() : []);
    } else {
      const fn = module.exports.getStreams || globalThis.getStreams;
      if (typeof fn !== "function") throw new Error("getStreams is not exported by this provider.");
      __send(true, await fn(...__args) || []);
    }
  }).catch(error => __send(false, error?.message || String(error)));
} catch (error) { __send(false, error?.message || String(error)); }`;
}

async function executeSandbox<T>(
  scraper: PluginScraper,
  action: "settings" | "streams",
  settings: Record<string, unknown>,
  args: unknown[] = [],
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const token = crypto.randomUUID();
  const cryptoSource = await pluginCryptoSource();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const source = sandboxSource(token, scraper.code, cryptoSource, action, settings, args);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  Object.assign(frame.style, {
    position: "fixed",
    width: "1px",
    height: "1px",
    right: "0",
    bottom: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  frame.sandbox.add("allow-scripts");
  return new Promise<T>((resolve, reject) => {
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      frame.remove();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; token?: string; ok?: boolean; value?: unknown };
      if (
        event.source === frame.contentWindow &&
        data?.source === "nuvio-plugin-sandbox-ready" &&
        data.token === token
      ) {
        frame.contentWindow?.postMessage(
          { source: "nuvio-plugin-sandbox-run", token, code: source },
          "*",
        );
        return;
      }
      if (
        event.source !== frame.contentWindow ||
        data?.source !== "nuvio-plugin-sandbox" ||
        data.token !== token
      )
        return;
      cleanup();
      if (data.ok) resolve(data.value as T);
      else reject(new Error(String(data.value || "Plugin execution failed.")));
    };
    timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`${scraper.name} timed out after 15 seconds.`));
    }, PLUGIN_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    // The host document stays opaque because allow-same-origin is absent.
    // Plugin code can evaluate only inside this disposable isolated frame.
    const hostUrl = new URL("plugin-sandbox.html", document.baseURI);
    hostUrl.hash = encodeURIComponent(token);
    frame.src = hostUrl.toString();
    document.body.append(frame);
  });
}

export async function pluginSettingsLayout(
  scraper: PluginScraper,
): Promise<Array<Record<string, unknown>>> {
  const result = await executeSandbox<unknown[]>(scraper, "settings", {});
  return Array.isArray(result)
    ? result.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

function supportsType(scraper: PluginScraper, type: string): boolean {
  const normalized = ["series", "show", "other"].includes(type.toLowerCase())
    ? "tv"
    : type.toLowerCase();
  return scraper.supportedTypes
    .map((value) => (["series", "show", "other"].includes(value.toLowerCase()) ? "tv" : value.toLowerCase()))
    .includes(normalized);
}

type RuntimeResult = {
  title?: string;
  name?: string;
  url?: string | { url?: string };
  quality?: string;
  size?: string;
  language?: string;
  provider?: string;
  type?: string;
  infoHash?: string;
  headers?: Record<string, string>;
};

function runtimeResultsToStreams(
  results: RuntimeResult[],
  scraper: PluginScraper,
  groupName: string,
): Stream[] {
  return results.flatMap((item): Stream[] => {
    const rawUrl = typeof item.url === "string" ? item.url : item.url?.url;
    const url = safeHttpUrl(rawUrl);
    if (!url) return [];
    const headers = Object.fromEntries(
      Object.entries(item.headers ?? {}).filter(
        ([key, value]) =>
          key.toLowerCase() !== "range" &&
          key.trim() &&
          typeof value === "string" &&
          value.trim(),
      ),
    );
    return [{
      name: item.name || item.title || scraper.name,
      title: item.title || item.name || "",
      description: [item.quality, item.size, item.language].filter(Boolean).join(" • "),
      url,
      infoHash: item.infoHash,
      addonName: groupName,
      addonLogo: scraper.logo,
      behaviorHints: Object.keys(headers).length
        ? { notWebReady: true, proxyHeaders: { request: headers } }
        : undefined,
    }];
  });
}

async function executePluginStreams(
  scraper: PluginScraper,
  groupName: string,
  tmdbId: string,
  mediaType: string,
  season?: number,
  episode?: number,
  signal?: AbortSignal,
): Promise<Stream[]> {
  const settings = await readPluginSettings(scraper.id);
  const normalizedType = ["series", "show", "other"].includes(mediaType.toLowerCase())
    ? "tv"
    : mediaType.toLowerCase();
  const results = await executeSandbox<RuntimeResult[]>(
    scraper,
    "streams",
    settings,
    [tmdbId, normalizedType, season, episode],
    signal,
  );
  return runtimeResultsToStreams(
    Array.isArray(results) ? results : [],
    scraper,
    groupName,
  );
}

/** Executes one provider without swallowing its error, for the Settings test. */
export async function testPluginScraper(
  scraper: PluginScraper,
  tmdbId: string,
  mediaType: string,
  season?: number,
  episode?: number,
): Promise<Stream[]> {
  if (!WEB_PLUGINS_SUPPORTED)
    throw new Error("Plugins are unavailable in the web app.");
  return executePluginStreams(
    { ...scraper, enabled: true },
    scraper.name,
    tmdbId,
    mediaType,
    season,
    episode,
  );
}

export async function loadPluginStreams(
  state: PluginState,
  tmdbId: string,
  mediaType: string,
  season?: number,
  episode?: number,
  signal?: AbortSignal,
): Promise<Stream[]> {
  if (!WEB_PLUGINS_SUPPORTED || !state.pluginsEnabled) return [];
  const targets = state.scrapers.filter(
    (scraper) => scraper.enabled && scraper.manifestEnabled && supportsType(scraper, mediaType),
  );
  const repoNames = new Map(
    state.repositories.map((repository) => [repository.manifestUrl, repository.name]),
  );
  const settled = await Promise.allSettled(
    targets.map((scraper) =>
      executePluginStreams(
        scraper,
        state.groupStreamsByRepository
          ? repoNames.get(scraper.repositoryUrl) || scraper.name
          : scraper.name,
        tmdbId,
        mediaType,
        season,
        episode,
        signal,
      ),
    ),
  );
  return settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}
