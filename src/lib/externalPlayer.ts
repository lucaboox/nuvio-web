import type {
  ExternalPlayerLaunchOptions,
  ExternalPlayerSurface,
} from "../platform/types.ts";
import type { ExternalPlayerMode } from "../types";
import { safeHttpUrl } from "./security.ts";

export const isAppleMobile = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS reports itself as a Mac, so the touch count is the giveaway.
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const isAndroid = () => /Android/i.test(navigator.userAgent);

export const isMacOS = () =>
  !isAppleMobile() && /Macintosh|Mac OS X/i.test(navigator.userAgent);

const isStandalone = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true ||
  window.matchMedia?.("(display-mode: standalone)").matches === true;

/**
 * Whether a link back to us would actually reach us.
 *
 * An installed iOS web app cannot capture links. iOS hands every https URL to
 * Safari no matter whose scope it falls in — home-screen web apps get no URL
 * scheme and no universal links — and Safari is a separate storage container
 * from the installed app: different cookies, different local storage. So the
 * tab that opens is signed out and has never heard of the title that was
 * playing. It cannot save anything.
 *
 * A player handed that address would send the viewer somewhere useless, so it
 * is handed none, and the prompt back in the app asks instead. Android
 * captures in-scope links into the installed app, so this only bites Apple.
 */
export const canReturnToApp = () => !(isAppleMobile() && isStandalone());

/** True only where the Shortcut route below is the one way back. */
export const isInstalledAppleWebApp = () => isAppleMobile() && isStandalone();

/**
 * This app's own address, as webapp:// needs it.
 *
 * Derived rather than written down: the installed app is whichever origin it
 * was added to the home screen from — a tunnel while testing, Pages once
 * deployed — and webapp:// only resolves the one that matches. The trailing
 * slash is required; without it iOS does not find the app at all.
 */
export function installedAppUrl() {
  const url = `${window.location.origin}${import.meta.env.BASE_URL}`;
  return url.endsWith("/") ? url : `${url}/`;
}

/** The Shortcut's name, which has to match the one installed on the device. */
export const RETURN_SHORTCUT_NAME = "Open Nuvio";

/** Where to get it, so nobody has to build it by hand. */
export const RETURN_SHORTCUT_URL =
  "https://www.icloud.com/shortcuts/abe18a0678c8497ab7d64367c681791b";

/**
 * A way back into an installed iOS web app, by way of Shortcuts.
 *
 * iOS gives an https link to Safari, which is a separate storage container
 * from the installed app and so is signed out and knows nothing. webapp://
 * opens the installed app itself, but Safari will not follow it. The Shortcuts
 * app will: handed the webapp:// address as text, a one-step shortcut opens
 * it, and the app comes to the front where the session and the note about what
 * was playing already are.
 *
 * What this cannot carry is the position. A player appends `position` and
 * `duration` to the address it is given — here that is the shortcuts:// one,
 * so they arrive as parameters of the shortcut rather than inside the text it
 * passes on, and Shortcuts drops what it does not recognise. Finishing needs
 * no parameters and so survives; stopping part-way comes back to the prompt.
 */
export function shortcutReturnUrl(
  appUrl: string,
  query: string,
  shortcutName = RETURN_SHORTCUT_NAME,
) {
  // The slash is load-bearing, so it is enforced here rather than assumed of
  // whoever passed the address in.
  const host = appUrl.replace(/^https?:\/\//i, "").replace(/\/*$/, "/");
  const target = `webapp://${host}${query}`;
  const params = new URLSearchParams({
    name: shortcutName,
    input: "text",
    text: target,
  });
  // Form encoding writes a space as "+", which only means a space to a reader
  // that knows it is reading a form. The name has to match a Shortcut exactly,
  // and "Open+Nuvio" is not "Open Nuvio" to anything that does not.
  return `shortcuts://run-shortcut?${params.toString().replaceAll("+", "%20")}`;
}

type PlayerPlatform = "android" | "apple-mobile" | "macos" | "desktop";

type ExternalPlayerDefinition = {
  mode: ExternalPlayerMode;
  label: string | Partial<Record<PlayerPlatform, string>>;
  platforms: Record<ExternalPlayerSurface, readonly PlayerPlatform[]>;
  /**
   * Whether the player tells us what happened when it is done. Only Outplayer
   * does; everything else is a one-way trip and has to be asked afterwards.
   */
  reportsBack?: boolean;
};

const EVERYWHERE = [
  "android",
  "apple-mobile",
  "macos",
  "desktop",
] as const satisfies readonly PlayerPlatform[];

const externalPlayerDefinitions: readonly ExternalPlayerDefinition[] = [
  {
    mode: "copy",
    // Pasting a URL into a player works on every platform, so this is offered
    // as a default on every platform too.
    label: "Copy stream URL",
    platforms: { settings: EVERYWHERE, player: EVERYWHERE },
  },
  {
    // vlc-x-callback is an iOS scheme. VLC for macOS registers no URL scheme
    // of its own, so there is nothing to hand a stream to there; copy is the
    // honest route on a Mac.
    mode: "vlc",
    label: "VLC",
    platforms: { settings: ["android", "apple-mobile"], player: ["android", "apple-mobile"] },
  },
  {
    mode: "nextplayer",
    label: "Next Player",
    platforms: { settings: ["android"], player: ["android"] },
  },
  {
    mode: "mxplayer",
    label: "MX Player",
    platforms: { settings: ["android"], player: ["android"] },
  },
  {
    mode: "mpv",
    label: { android: "mpv", macos: "mpv (mpv-handler plugin required)", desktop: "mpv (mpv-handler plugin required)" },
    platforms: { settings: ["android", "macos", "desktop"], player: ["android", "macos", "desktop"] },
  },
  {
    mode: "android-chooser",
    label: "Android video player chooser",
    platforms: { settings: ["android"], player: ["android"] },
  },
  {
    // iOS and iPadOS only — there is no Outplayer for macOS to answer the
    // scheme.
    mode: "outplayer",
    label: "Outplayer",
    platforms: { settings: ["apple-mobile"], player: ["apple-mobile"] },
    reportsBack: true,
  },
  {
    mode: "infuse",
    label: "Infuse",
    platforms: { settings: ["apple-mobile", "macos"], player: ["apple-mobile", "macos"] },
  },
  {
    mode: "iina",
    label: "IINA",
    platforms: { settings: ["macos"], player: ["macos"] },
  },
  {
    mode: "m3u",
    label: "Download M3U playlist",
    platforms: { settings: EVERYWHERE, player: EVERYWHERE },
  },
];

function playerPlatform(): PlayerPlatform {
  if (isAndroid()) return "android";
  if (isAppleMobile()) return "apple-mobile";
  if (isMacOS()) return "macos";
  return "desktop";
}

export function externalPlayerOptions(surface: ExternalPlayerSurface) {
  const platform = playerPlatform();
  return externalPlayerDefinitions
    .filter((option) => option.platforms[surface].includes(platform))
    .map((option) => ({
      mode: option.mode,
      reportsBack: option.reportsBack === true,
      label:
        typeof option.label === "string"
          ? option.label
          : // Any wording beats none, and the mode beats a label belonging to
            // a different player.
            option.label[platform] ??
            Object.values(option.label)[0] ??
            option.mode,
    }));
}

export function externalPlayerLabel(mode: ExternalPlayerMode) {
  return (
    externalPlayerOptions("player").find((option) => option.mode === mode)
      ?.label ?? "Nuvio web player"
  );
}

export const isExternalPlayerAvailable = (mode: ExternalPlayerMode) =>
  mode === "internal" ||
  externalPlayerOptions("settings").some((option) => option.mode === mode);

function m3uFor(url: string, title: string) {
  return new Blob(
    [`#EXTM3U\n#EXTINF:-1,${title.replace(/[\r\n,]/g, " ")}\n${url}\n`],
    { type: "audio/x-mpegurl" },
  );
}

function download(blob: Blob, title: string, extension: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${title.replace(/[^a-z0-9 _.-]/gi, "_") || "Nuvio"}.${extension}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

export async function copyStreamUrl(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // Clipboard access can be refused even on HTTPS if the click is not
    // treated as a gesture. Fall back to a selectable prompt.
    window.prompt("Copy this stream URL", url);
    return false;
  }
}

export function infusePlaybackUrl(url: string, title: string) {
  let extension = ".mkv";
  try {
    const match = new URL(url).pathname.match(/\.(mkv|mp4|m4v|mov|avi|webm)$/i);
    if (match) extension = match[0].toLowerCase();
  } catch {
    // Signed and custom URLs do not always parse, but filename is optional.
  }
  const filename = `${title.replace(/[^a-z0-9 _.-]/gi, "_").trim() || "Nuvio"}${extension}`;
  const query = new URLSearchParams({ url, filename });
  return `infuse://x-callback-url/play?${query.toString()}`;
}

export function androidIntentUrl(
  url: string,
  title: string,
  packageName?: string,
) {
  const parsed = new URL(url);
  const packagePart = packageName ? `package=${packageName};` : "";
  // Without a fallback, an intent no installed app can answer drops the user
  // on a Chrome error page — out of the PWA entirely. Naming the page we are
  // already on sends them back here instead.
  const fallback =
    typeof window === "undefined"
      ? ""
      : `S.browser_fallback_url=${encodeURIComponent(window.location.href)};`;
  return `intent://${parsed.host}${parsed.pathname}${parsed.search}#Intent;scheme=${parsed.protocol.slice(0, -1)};${packagePart}action=android.intent.action.VIEW;type=video/*;S.title=${encodeURIComponent(title)};${fallback}end`;
}

/**
 * mpv-handler takes the stream URL as URL-safe base64 with the padding
 * stripped, and it reads that data as one path segment — splitting on the
 * first "/" it finds.
 *
 * Standard base64 therefore fails twice over: a "/" in the output truncates
 * the URL silently, and "+" and "=" do not decode. btoa also throws on
 * anything outside Latin-1, so the URL becomes UTF-8 bytes first.
 */
export function mpvHandlerUrl(url: string) {
  let binary = "";
  for (const byte of new TextEncoder().encode(url))
    binary += String.fromCharCode(byte);
  const data = btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `mpv-handler://play/${data}`;
}

/**
 * Where Outplayer should send the viewer back to, and what it should say.
 *
 * x-cancel fires when the video is closed and appends `position` and
 * `duration`; x-success fires when it played to the end. Between them the app
 * learns everything the "how far did you get?" prompt has to ask for, so on
 * this one player the prompt never has to appear.
 */
function outplayerCallbacks(returnUrlFor: (query: string) => string) {
  return {
    "x-success": returnUrlFor("?nuvio-external=finished"),
    "x-cancel": returnUrlFor("?nuvio-external=stopped"),
  };
}

/**
 * Outplayer's documented x-callback-url form.
 *
 * The bare `outplayer://<url>` form plays, but carries nothing either way: it
 * cannot start where you left off, and it reports nothing back. Parameters are
 * as listed in Outplayer under Settings -> URL Schemes.
 */
export function outplayerPlaybackUrl(
  url: string,
  options: ExternalPlayerLaunchOptions = {},
) {
  const query = new URLSearchParams({ url });
  const position = Math.floor(options.positionSeconds ?? 0);
  if (position > 0) query.set("position", String(position));
  if (options.subtitleUrl) query.set("subtitle", options.subtitleUrl);
  if (options.returnUrlFor)
    for (const [key, value] of Object.entries(
      outplayerCallbacks(options.returnUrlFor),
    ))
      query.set(key, value);
  return `outplayer://x-callback-url/play?${query.toString()}`;
}

/** Hands a stream to a registered player outside the browser. */
export function launchExternalPlayer(
  mode: ExternalPlayerMode,
  url: string,
  title: string,
  options: ExternalPlayerLaunchOptions = {},
) {
  const safeUrl = safeHttpUrl(url);
  if (!safeUrl) {
    // Never navigate to an addon-supplied custom scheme (especially
    // javascript:). Copying keeps unusual sources usable without executing
    // them in the PWA origin.
    void copyStreamUrl(url);
    return;
  }
  if (mode === "copy") {
    void copyStreamUrl(safeUrl);
    return;
  }
  if (mode === "vlc" && isAndroid()) {
    window.location.href = androidIntentUrl(safeUrl, title, "org.videolan.vlc");
    return;
  }
  if (mode === "nextplayer") {
    window.location.href = androidIntentUrl(
      safeUrl,
      title,
      "dev.anilbeesetti.nextplayer",
    );
    return;
  }
  if (mode === "mxplayer") {
    window.location.href = androidIntentUrl(
      safeUrl,
      title,
      "com.mxtech.videoplayer.ad",
    );
    return;
  }
  if (mode === "mpv" && isAndroid()) {
    window.location.href = androidIntentUrl(safeUrl, title, "is.xyz.mpv");
    return;
  }
  if (mode === "android-chooser") {
    window.location.href = androidIntentUrl(safeUrl, title);
    return;
  }
  if (mode === "vlc") {
    window.location.href = `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(safeUrl)}`;
    return;
  }
  if (mode === "outplayer") {
    window.location.href = outplayerPlaybackUrl(safeUrl, options);
    return;
  }
  if (mode === "infuse") {
    window.location.href = infusePlaybackUrl(safeUrl, title);
    return;
  }
  if (mode === "iina") {
    window.location.href = `iina://weblink?url=${encodeURIComponent(safeUrl)}`;
    return;
  }
  if (mode === "mpv") {
    window.location.href = mpvHandlerUrl(safeUrl);
    return;
  }
  if (mode === "m3u") download(m3uFor(safeUrl, title), title, "m3u");
}
