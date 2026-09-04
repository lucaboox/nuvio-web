export const DETAILS_DEBUG_KEY = "nuvio-details-debug";
export function detailsDebugEnabled(): boolean {
  try { return localStorage.getItem(DETAILS_DEBUG_KEY) === "true"; } catch { return false; }
}
export type TimingStatus = "pending" | "done" | "error" | "timeout" | "cancelled";
export type TimingEntry = { label: string; start: number; end?: number; status: TimingStatus; note?: string };

/** Per-open, bounded and memory-only. Never record request URLs or error bodies. */
export class DetailsTrace {
  readonly started: number;
  ended?: number;
  cancelled = false;
  readonly entries: TimingEntry[] = [];
  readonly title: string;
  private now: () => number;
  constructor(title: string, now = () => performance.now()) {
    this.title = title;
    this.now = now;
    this.started = now();
  }
  elapsed() { return (this.ended ?? this.now()) - this.started; }
  entryElapsed(entry: TimingEntry) { return (entry.end ?? this.now()) - entry.start; }
  start(label: string, note?: string) {
    if (this.cancelled || this.entries.length >= 200) return (_status: TimingStatus = "done") => {};
    const entry: TimingEntry = { label, note, start: this.now(), status: "pending" };
    this.entries.push(entry);
    return (status: TimingStatus = "done") => {
      if (entry.end !== undefined) return;
      entry.end = this.now();
      entry.status = status;
    };
  }
  finish() { this.ended ??= this.now(); }
  cancel() {
    this.cancelled = true;
    this.finish();
    for (const entry of this.entries) if (entry.end === undefined) {
      entry.end = this.now(); entry.status = "cancelled";
    }
  }
  report() {
    return JSON.stringify({ title: this.title, totalSeconds: this.elapsed() / 1000,
      state: this.cancelled ? "cancelled" : this.ended === undefined ? "loading" : "visible",
      resources: this.entries.map(entry => ({ label: entry.label, note: entry.note,
        startSeconds: (entry.start - this.started) / 1000,
        seconds: this.entryElapsed(entry) / 1000, status: entry.status })) }, null, 2);
  }
}

/**
 * The same span for work that does not await.
 *
 * Parsing and reshaping a large TMDB payload is real time on a phone, and
 * without this it was invisible: everything measured here was a request, so a
 * slow stage with fast requests had nowhere to show up.
 */
export function timedSync<T>(
  trace: DetailsTrace | undefined,
  label: string,
  work: () => T,
  note?: string,
): T {
  const finish = trace?.start(label, note);
  try {
    const result = work();
    finish?.();
    return result;
  } catch (error) {
    finish?.("error");
    throw error;
  }
}

export async function timed<T>(trace: DetailsTrace | undefined, label: string, work: () => Promise<T>, note?: string): Promise<T> {
  const finish = trace?.start(label, note);
  try { const result = await work(); finish?.(); return result; }
  catch (error) { finish?.(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "error"); throw error; }
}
