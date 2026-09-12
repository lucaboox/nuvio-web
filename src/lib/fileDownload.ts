/**
 * Handing a source to the browser's own download manager.
 *
 * Not the Downloads page, and deliberately not a smaller version of it. That
 * queue belongs to a shell that can write a file the app will find again,
 * resume it across a restart and play it back with no network. A page can do
 * none of those. What a page can do is point the browser at an address and let
 * the download manager it already has take it from there.
 *
 * So there is nothing to show progress for and nothing to cancel from in here,
 * and the app never sees the file again. That is the whole trade, and it is
 * worth naming rather than papering over: in exchange the transfer resumes,
 * survives a reload, and lands where that viewer already looks for downloads.
 */

import { safeHttpUrl } from "./security.ts";

/** Containers these sources actually arrive in. */
const VIDEO_EXTENSION = /\.(mkv|mp4|m4v|mov|avi|webm|ts|m2ts|flv|wmv|mpe?g)$/i;

/** Characters Windows rejects in a name. Everything else is legal somewhere. */
const ILLEGAL = /[\\/:*?"<>|]+/g;

/**
 * The extension to end on, guessed in the order the guesses are worth making.
 *
 * A default is needed because a file with none is one the viewer has to tell
 * their system how to open. Matroska is that default, as it is for the Infuse
 * handoff: it is what most of these releases are, and every player worth
 * handing the file to reads the container rather than the name anyway.
 */
export function fileExtension(url: string, filename?: string): string {
  const declared = filename?.match(VIDEO_EXTENSION)?.[0];
  if (declared) return declared.toLowerCase();
  try {
    const found = new URL(url).pathname.match(VIDEO_EXTENSION)?.[0];
    if (found) return found.toLowerCase();
  } catch {
    // Signed and custom addresses do not always parse, and the name is a
    // suggestion in the first place.
  }
  return ".mkv";
}

/**
 * Drops what a file system will refuse, and nothing else.
 *
 * Narrow on purpose. A release name is full of dots, hyphens and brackets that
 * are legal everywhere, and they are the part worth keeping — it is what a
 * subtitle file or a library scanner matches against. Only what Windows
 * actually rejects goes, plus the trailing dot it silently eats.
 */
function safeName(value: string) {
  return value
    .replace(ILLEGAL, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
}

const pad = (value: number) => String(value).padStart(2, "0");

export type SaveName = {
  url: string;
  /** What the addon called the file, where it said. */
  filename?: string;
  /** The episode's own title, or the film's. */
  title: string;
  /** The show this belongs to, where it belongs to one. */
  showName?: string;
  season?: number;
  episode?: number;
};

/**
 * What to call the saved file.
 *
 * A suggestion, not a guarantee: `download` is ignored on a cross-origin
 * address, which is nearly all of them, and the browser falls back to the
 * host's `Content-Disposition` or the last path segment. Worth composing well
 * anyway — it is honoured on the ones that do allow it, and it is what the
 * viewer is told they are saving.
 */
export function saveFilename(name: SaveName): string {
  const extension = fileExtension(name.url, name.filename);
  // The addon's own filename is the release name, which is what every other
  // tool the viewer owns expects to see. Nothing composed here beats it.
  const declared = safeName(name.filename ?? "");
  if (declared)
    return VIDEO_EXTENSION.test(declared) ? declared : `${declared}${extension}`;

  const parts: string[] = [];
  const show = safeName(name.showName ?? "");
  if (show) parts.push(show);
  if (name.season != null && name.episode != null)
    parts.push(`S${pad(name.season)}E${pad(name.episode)}`);
  const own = safeName(name.title);
  // A film's title is already the line above; an episode's is not.
  if (own && own !== show) parts.push(own);
  return `${parts.join(" - ") || "Nuvio"}${extension}`;
}

/**
 * Whether this source asks for something a browser download cannot carry.
 *
 * A page hands the browser an address and nothing else; there is no way to
 * attach a header to a transfer the browser makes on its own. User-Agent,
 * Referer and Origin are excluded because the browser sends its own of each
 * and hosts that ask for them usually accept what arrives. Anything else — an
 * Authorization above all — will simply not be there.
 *
 * An answer to report, not a veto. Refusing the option outright would be wrong
 * for the sources that work regardless, so the viewer is told what might
 * happen rather than told no.
 */
export function needsUnsendableHeaders(
  headers?: Record<string, string>,
): boolean {
  return Object.keys(headers ?? {}).some(
    (name) => !/^(user-agent|referer|origin)$/i.test(name),
  );
}

/**
 * Starts the transfer, and answers whether it got as far as being started.
 *
 * False only for an address we would never navigate to — addon metadata is
 * untrusted and a `javascript:` URL in an href is why `safeHttpUrl` exists.
 * Past that this cannot know the outcome: the browser owns the transfer from
 * the click onward and reports nothing back to the page.
 */
export function saveToDevice(url: string, filename: string): boolean {
  const safe = safeHttpUrl(url);
  if (!safe) return false;
  const link = document.createElement("a");
  link.href = safe;
  link.download = filename;
  // An address that turns out to serve a page rather than a file is a
  // navigation, and without this it would be one that replaced the app.
  link.target = "_blank";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  return true;
}
