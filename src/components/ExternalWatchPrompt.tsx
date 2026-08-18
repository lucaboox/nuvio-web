import { useState } from "react";
import type { Meta, Video } from "../types";

/**
 * Asks what happened after a stream was handed to another player.
 *
 * Nothing reports back from VLC, so a title watched externally would otherwise
 * leave no trace — no resume point, nothing marked watched, and Continue
 * Watching stuck showing an episode you already finished. This is the manual
 * substitute for the progress the internal player reports on its own.
 */
const HOUR = 3600;

/**
 * Strictly `m:ss` or `h:mm:ss`, with real minute and second values.
 *
 * Deliberately refuses a half-typed time: `24:1` reads as twenty-four minutes
 * and one second but almost always means `24:10`, and silently accepting it
 * writes a resume point a minute and a half from where you actually were.
 */
export function parseTimecode(value: string): number | null {
  const trimmed = value.trim();
  const short = /^(\d{1,3}):([0-5]\d)$/.exec(trimmed);
  if (short) return Number(short[1]) * 60 + Number(short[2]);
  const long = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(trimmed);
  if (long)
    return Number(long[1]) * HOUR + Number(long[2]) * 60 + Number(long[3]);
  return null;
}

export function formatSeconds(total: number): string {
  const hours = Math.floor(total / HOUR);
  const minutes = Math.floor((total % HOUR) / 60);
  const seconds = Math.floor(total % 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/** Minutes from `Video.runtime` (a number) or `Meta.runtime` ("142 min"). */
export function runtimeMinutes(meta: Meta, video?: Video): number | null {
  if (typeof video?.runtime === "number" && video.runtime > 0)
    return video.runtime;
  const text = meta.runtime ?? "";
  const hours = /(\d+)\s*h/i.exec(text);
  const mins = /(\d+)\s*m/i.exec(text);
  const total = (Number(hours?.[1] ?? 0) * 60) + Number(mins?.[1] ?? 0);
  if (total > 0) return total;
  const bare = /^\s*(\d+)\s*$/.exec(text);
  return bare ? Number(bare[1]) : null;
}



export function ExternalWatchPrompt({
  meta,
  video,
  onFinished,
  onStopped,
  onDismiss,
}: {
  meta: Meta;
  video?: Video;
  onFinished(): void;
  onStopped(positionMs: number, durationMs: number): void;
  onDismiss(): void;
}) {
  const known = runtimeMinutes(meta, video);
  const [partial, setPartial] = useState(false);
  const [stoppedAt, setStoppedAt] = useState("");
  const [total, setTotal] = useState("");

  // The runtime the addon reported, when it reported one — shown rather than
  // asked for, so there is nothing to mistype.
  const knownSeconds = known ? known * 60 : null;
  const duration = knownSeconds ?? parseTimecode(total);
  const position = parseTimecode(stoppedAt);

  const problem =
    stoppedAt.trim() === ""
      ? null
      : position == null
        ? "Use m:ss or h:mm:ss — 24:10, or 1:24:10."
        : duration == null
          ? "Enter the total length too."
          : position >= duration
            ? `That is past the end of ${formatSeconds(duration)} — use “I finished it”.`
            : null;
  const ready = position != null && duration != null && problem == null;

  return (
    <div className="sheet-backdrop" onClick={onDismiss}>
      <section
        className="watch-prompt"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="eyebrow">EXTERNAL PLAYER</span>
        <h2>{video?.title || meta.name}</h2>
        <p>
          Nothing reports back from an external player, so tell Nuvio what
          happened and it will sync like any other playback.
        </p>
        {partial ? (
          <>
            <div className="watch-prompt-fields">
              <label>
                Stopped at
                <input
                  autoFocus
                  inputMode="numeric"
                  placeholder="24:10"
                  value={stoppedAt}
                  aria-invalid={problem != null}
                  onChange={(event) => setStoppedAt(event.target.value)}
                />
              </label>
              {knownSeconds == null ? (
                <label>
                  Total length
                  <input
                    inputMode="numeric"
                    placeholder="48:00"
                    value={total}
                    onChange={(event) => setTotal(event.target.value)}
                  />
                </label>
              ) : (
                <span className="watch-prompt-total">
                  of {formatSeconds(knownSeconds)}
                </span>
              )}
            </div>
            <p className={problem ? "watch-prompt-hint is-error" : "watch-prompt-hint"}>
              {problem ??
                (ready
                  ? `${formatSeconds(position!)} of ${formatSeconds(duration!)} · ${Math.round((position! / duration!) * 100)}% watched`
                  : "Enter where you stopped, as m:ss or h:mm:ss.")}
            </p>
            <div className="watch-prompt-actions">
              <button className="secondary" onClick={() => setPartial(false)}>
                Back
              </button>
              <button
                className="primary"
                disabled={!ready}
                onClick={() => onStopped(position! * 1000, duration! * 1000)}
              >
                Save position
              </button>
            </div>
          </>
        ) : (
          <div className="watch-prompt-actions">
            <button className="secondary" onClick={onDismiss}>
              Not now
            </button>
            <button className="secondary" onClick={() => setPartial(true)}>
              I stopped partway
            </button>
            <button className="primary" onClick={onFinished}>
              I finished it
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
