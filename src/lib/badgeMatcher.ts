import type { Stream } from "../types";
import type { StreamBadgeFilter, StreamBadgeSettings } from "./webSettings";

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, { resolve(badges: StreamBadgeFilter[]): void; timer: ReturnType<typeof setTimeout> }>();
const cache = new Map<string, StreamBadgeFilter[]>();
let activeFilters: StreamBadgeFilter[] | null = null;
let activeRules = "";
let rulesVersion = 0;
// Quarantine a ruleset that exceeds the worker budget instead of retrying it
// for every scroll/re-render. Replacing/editing the import changes this key.
const blockedRules = new Set<string>();
export function matchBadges(stream: Stream, settings: StreamBadgeSettings): Promise<StreamBadgeFilter[]> {
  if (!settings.filters.length) return Promise.resolve([]);
  if (activeFilters !== settings.filters) {
    activeFilters = settings.filters;
    const serialized = JSON.stringify(settings.filters);
    if (serialized !== activeRules) { activeRules = serialized; rulesVersion += 1; cache.clear(); }
  }
  const rules = activeRules;
  if (blockedRules.has(rules)) return Promise.resolve([]);
  // Do not duplicate an entire imported ruleset in every cached stream key.
  const key = JSON.stringify([rulesVersion, stream]);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  try {
    if (!worker) {
      worker = new Worker(new URL("./badgeWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<{ id: number; badges: StreamBadgeFilter[] }>) => {
        const task = pending.get(event.data.id);
        if (!task) return;
        clearTimeout(task.timer); pending.delete(event.data.id); task.resolve(event.data.badges);
      };
    }
    return new Promise((resolve) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        if (blockedRules.size >= 10) blockedRules.delete(blockedRules.values().next().value!);
        blockedRules.add(rules);
        worker?.terminate(); worker = null;
        for (const task of pending.values()) { clearTimeout(task.timer); task.resolve([]); }
        pending.clear();
      }, 2000);
      pending.set(id, { timer, resolve: (badges) => {
        if (cache.size >= 200) cache.delete(cache.keys().next().value!);
        cache.set(key, badges); resolve(badges);
      } });
      try { worker!.postMessage({ id, stream, settings: { filters: settings.filters } }); }
      catch { clearTimeout(timer); pending.delete(id); resolve([]); }
    });
  } catch { return Promise.resolve([]); }
}
