import type { PlayerApi, PlayerSource } from "../platform/types.ts";

// The native player is a singleton. Serialize lifecycle requests so an old
// prepare cannot finish after its stop, or a late cleanup stop a newer stream.
const queues = new WeakMap<PlayerApi, Promise<unknown>>();
export function startNativePlaybackSession(player: PlayerApi, source: PlayerSource) {
  const enqueue = (work: () => Promise<void>) => {
    const task = (queues.get(player) ?? Promise.resolve()).catch(() => undefined).then(work);
    queues.set(player, task.catch(() => undefined));
    return task;
  };
  let cancelled = false;
  let started = false;
  let stopping: Promise<void> | undefined;
  const ready = enqueue(async () => {
    if (cancelled) return;
    started = true;
    await player.open(source);
  });
  return {
    ready,
    stop() {
      cancelled = true;
      return stopping ??= enqueue(async () => {
        if (started) await player.stop();
      });
    },
  };
}
