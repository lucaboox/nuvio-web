/**
 * Times entered as digits, filling from the right.
 *
 * A phone's numeric keypad has no colon, so `24:10` cannot be typed into a
 * numeric field at all — and asking for the full keyboard to get one character
 * puts a text keyboard in front of a number. Stopwatches and camera timers
 * solve this by dropping the separator from the input entirely: digits push in
 * from the seconds end and the colons are drawn, never typed.
 *
 *   4      → 0:04
 *   241    → 2:41
 *   2410   → 24:10
 *   12345  → 1:23:45
 *
 * Six digits is the ceiling, which is 99:59:59 — longer than anything with a
 * resume point.
 */

const NOT_DIGITS = /\D/g;
const MAX_DIGITS = 6;
const HOUR = 3600;

/** Everything below reads the digits the same way, so it is read once here. */
function timecodeParts(digits: string) {
  const clean = digits.replace(NOT_DIGITS, "").slice(0, MAX_DIGITS);
  // Below five digits there are no hours, so four places is the whole value.
  const padded = clean.padStart(clean.length <= 4 ? 4 : MAX_DIGITS, "0");
  return {
    hours: padded.length > 4 ? Number(padded.slice(0, padded.length - 4)) : 0,
    minutes: Number(padded.slice(-4, -2)),
    seconds: Number(padded.slice(-2)),
  };
}

/**
 * Adds one digit at the seconds end.
 *
 * Leading zeros are dropped rather than kept: they mean nothing in a time and
 * would otherwise consume the six places available.
 */
export function appendDigit(digits: string, digit: string): string {
  const next = (digits + digit).replace(NOT_DIGITS, "");
  return next.replace(/^0+(?=\d)/, "").slice(0, MAX_DIGITS);
}

export function dropDigit(digits: string): string {
  return digits.slice(0, -1);
}

/** What the field shows, colons included. */
export function formatDigits(digits: string): string {
  const { hours, minutes, seconds } = timecodeParts(digits);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/**
 * Seconds, or null where the digits do not describe a time.
 *
 * Deliberately refuses rather than reinterprets: `2470` reads as 24:70, which
 * almost certainly means 24:07 or 24:10, and quietly accepting it writes a
 * resume point a minute out from where you actually were.
 */
export function digitsToSeconds(digits: string): number | null {
  const clean = digits.replace(NOT_DIGITS, "");
  if (!clean) return null;
  const { hours, minutes, seconds } = timecodeParts(clean);
  if (seconds > 59) return null;
  // Without hours the minutes place is the whole value, so 90:00 is fine.
  if (hours > 0 && minutes > 59) return null;
  return hours * HOUR + minutes * 60 + seconds;
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
