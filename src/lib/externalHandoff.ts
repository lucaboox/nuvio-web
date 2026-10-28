import type { Meta, Video } from "../types";

/**
 * A breadcrumb left behind when a stream is handed to another player.
 *
 * Launching one is a top-level navigation, and Android will happily kill a
 * backgrounded PWA outright while the other app has the screen. Either way
 * coming back is a cold start: the picker asks who is watching, the title that
 * was open is gone, and so is the prompt that was the only way to record where
 * the other player got to.
 *
 * This is what puts all three back. It is deliberately narrow — only a return
 * from a hand-off skips the picker, so opening the app normally still asks.
 */
const KEY = "nuvio-external-handoff";

/** Long enough for a film with interruptions, short enough not to resume yesterday. */
const MAX_AGE_MS = 4 * 60 * 60 * 1000;

export type ExternalHandoff = {
  profileIndex: number;
  at: number;
  meta: Meta;
  video?: Video;
};

/** Returns when it was handed off, which is also how other tabs tell it apart. */
export function rememberExternalHandoff(
  profileIndex: number,
  meta: Meta,
  video?: Video,
) {
  const at = Date.now();
  try {
    const payload: ExternalHandoff = {
      profileIndex,
      at,
      // The episode list is re-fetched from the addon on the way back and is
      // far and away the biggest thing here — a long-running series would put
      // this near the storage quota on its own.
      meta: { ...meta, videos: [] },
      video,
    };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // A blocked or full store costs the resume, never the hand-off itself.
  }
  return at;
}

/** The pending hand-off, or null when there is none worth resuming. */
export function readExternalHandoff(): ExternalHandoff | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as ExternalHandoff;
    if (!value?.meta?.id || typeof value.profileIndex !== "number") return null;
    if (Date.now() - (value.at ?? 0) > MAX_AGE_MS) {
      clearExternalHandoff();
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function clearExternalHandoff() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do — a stale entry ages out by itself.
  }
}

export const EXTERNAL_ANSWER_KEY = "nuvio-external-answer";

/** How a hand-off was settled, in whichever tab settled it. */
export type ExternalHandoffAnswer =
  | ExternalPlayerReport
  | { outcome: "dismissed" };

/**
 * Tells other tabs that a hand-off has been answered.
 *
 * On a Mac, and in a Safari tab on iOS, a player's callback opens a new tab
 * rather than going back to the one that launched it. The new tab records the
 * report, and the old one would go on asking where you stopped, for a title
 * that is already saved. Writing the answer here fires a storage event in
 * every other tab, and stays readable for a tab that was asleep when it fired.
 */
export function announceExternalAnswer(at: number, answer: ExternalHandoffAnswer) {
  try {
    localStorage.setItem(EXTERNAL_ANSWER_KEY, JSON.stringify({ at, answer }));
  } catch {
    // The other tab keeps its prompt, which is how it was before.
  }
}

/** The answer to the hand-off made at `at`, if another tab gave one. */
export function readExternalAnswer(at: number): ExternalHandoffAnswer | null {
  try {
    const raw = localStorage.getItem(EXTERNAL_ANSWER_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { at?: number; answer?: ExternalHandoffAnswer };
    return value?.at === at && value.answer ? value.answer : null;
  } catch {
    return null;
  }
}

/**
 * What the other player reported on its way back.
 *
 * Only Outplayer and Lenna say anything: their callbacks reopen us with the
 * outcome, and the one fired on closing appends where it stopped and how long
 * the video was. That is exactly what the prompt would otherwise have to ask, so
 * when this is present the prompt is skipped and the position simply saved.
 */
export type ExternalPlayerReport =
  | { outcome: "finished" }
  | { outcome: "stopped"; positionMs: number; durationMs: number };

const LOG_KEY = "nuvio-web-return-log";

/**
 * Reads a report out of any address, wherever it was found.
 *
 * The address bar is one source. On an installed iOS web app it is never the
 * source: webapp:// opens the app at its start_url and discards the path and
 * query it was given — the Shortcut receives the full address intact and the
 * app still wakes at "/" with nothing. So the same address also arrives by
 * clipboard, and is read the same way.
 */
export function parseExternalReport(
  address: string,
): ExternalPlayerReport | null {
  const query = address.includes("?")
    ? address.slice(address.indexOf("?"))
    : address;
  const params = new URLSearchParams(query);
  const outcome = params.get("nuvio-external");
  if (outcome !== "finished" && outcome !== "stopped") return null;
  if (outcome === "finished") return { outcome: "finished" };
  // Both are reported in seconds, and a fractional position is normal.
  const seconds = (value: string | null) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1000) : 0;
  };
  return {
    outcome: "stopped",
    positionMs: seconds(params.get("position")),
    durationMs: seconds(params.get("duration")),
  };
}

/** Reads the report out of the address bar and takes it back out again. */
export function takeExternalReport(): ExternalPlayerReport | null {
  if (typeof window === "undefined") return null;
  const report = parseExternalReport(window.location.search);
  if (!report) return null;

  // The parameters are the player's, and they should not survive a refresh or
  // end up in a shared link.
  const clean = new URL(window.location.href);
  for (const key of [
    "nuvio-external",
    "url",
    "position",
    "duration",
    "errorCode",
    "errorMessage",
  ])
    clean.searchParams.delete(key);
  window.history.replaceState(null, "", clean.toString());
  return report;
}
