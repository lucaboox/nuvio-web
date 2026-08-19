import { useEffect, useState } from "react";
import { Delete } from "lucide-react";
import type { Meta, Video } from "../types";
import {
  appendDigit,
  digitsToSeconds,
  dropDigit,
  formatDigits,
  formatSeconds,
} from "../lib/timecode";

/**
 * Asks what happened after a stream was handed to another player.
 *
 * Nothing reports back from VLC, so a title watched externally would otherwise
 * leave no trace — no resume point, nothing marked watched, and Continue
 * Watching stuck showing an episode you already finished. This is the manual
 * substitute for the progress the internal player reports on its own.
 */

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

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * The field, which is deliberately not an input.
 *
 * A button takes focus without summoning a keyboard, which is the whole point:
 * the keypad below is the only way in, so a phone never offers a numeric pad
 * with no colon on it.
 */
function TimecodeField({
  label,
  digits,
  active,
  invalid,
  onActivate,
}: {
  label: string;
  digits: string;
  active: boolean;
  invalid: boolean;
  onActivate(): void;
}) {
  return (
    <div className="timecode-field">
      <span>{label}</span>
      <button
        type="button"
        className={active ? "is-active" : undefined}
        aria-invalid={invalid}
        onClick={onActivate}
      >
        {formatDigits(digits)}
      </button>
    </div>
  );
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
  const [active, setActive] = useState<"stopped" | "total">("stopped");

  // The runtime the addon reported, when it reported one — shown rather than
  // asked for, so there is nothing to mistype.
  const knownSeconds = known ? known * 60 : null;
  const editingTotal = knownSeconds == null && active === "total";
  const duration = knownSeconds ?? digitsToSeconds(total);
  const position = digitsToSeconds(stoppedAt);

  const edit = (change: (digits: string) => string) => {
    if (editingTotal) setTotal(change);
    else setStoppedAt(change);
  };

  // A real keyboard still works, without there being anything for a phone to
  // open one for.
  useEffect(() => {
    if (!partial) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key >= "0" && event.key <= "9") {
        event.preventDefault();
        edit((digits) => appendDigit(digits, event.key));
      } else if (event.key === "Backspace") {
        event.preventDefault();
        edit(dropDigit);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `edit` only closes over which field is active; the digits themselves
    // come from the functional updates, so nothing here goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partial, editingTotal]);

  const problem =
    stoppedAt === ""
      ? null
      : position == null
        ? "That is not a time — 24:10 is entered as 2 4 1 0."
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
              <TimecodeField
                label="Stopped at"
                digits={stoppedAt}
                active={!editingTotal}
                invalid={problem != null}
                onActivate={() => setActive("stopped")}
              />
              {knownSeconds == null ? (
                <TimecodeField
                  label="Total length"
                  digits={total}
                  active={editingTotal}
                  invalid={false}
                  onActivate={() => setActive("total")}
                />
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
                  : "Type the digits — 24:10 is 2 4 1 0.")}
            </p>
            <div className="timecode-keypad">
              {KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => edit((digits) => appendDigit(digits, key))}
                >
                  {key}
                </button>
              ))}
              <button
                type="button"
                className="timecode-key-text"
                onClick={() => edit(() => "")}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => edit((digits) => appendDigit(digits, "0"))}
              >
                0
              </button>
              <button
                type="button"
                aria-label="Delete"
                onClick={() => edit(dropDigit)}
              >
                <Delete size={19} />
              </button>
            </div>
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
