import type { StreamBadgeFilter } from "./webSettings.ts";

export type BadgeImport = { sourceUrl: string; isActive: boolean; filters: StreamBadgeFilter[]; groups: Record<string, unknown>[]; [key: string]: unknown };
export type BadgeRules = { imports: BadgeImport[]; [key: string]: unknown };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Same three-import/one-active rule as StreamBadgeRules.normalized(). */
export function normalizeBadgeRules(rules: BadgeRules): BadgeRules {
  const imports: BadgeImport[] = [];
  for (const source of rules.imports) {
    if (typeof source.sourceUrl !== "string" || !source.sourceUrl.trim() || !Array.isArray(source.filters) || !source.filters.length) continue;
    const item = { ...source, sourceUrl: source.sourceUrl.trim() };
    const index = imports.findIndex((entry) => entry.sourceUrl.toLowerCase() === item.sourceUrl.toLowerCase());
    if (index >= 0) imports[index] = item;
    else if (imports.length < 3) imports.push(item);
  }
  const active = Math.max(0, imports.findIndex((entry) => entry.isActive));
  return { ...rules, imports: imports.map((entry, index) => ({ ...entry, isActive: index === active })) };
}

export function readBadgeRules(serialized: string): BadgeRules {
  try {
    const data = object(JSON.parse(serialized));
    return normalizeBadgeRules({ ...data, imports: Array.isArray(data.imports) ? data.imports.filter((entry) => entry && typeof entry === "object") as BadgeImport[] : [] });
  } catch { return { imports: [] }; }
}

export function parseBadgeImport(sourceUrl: string, payload: unknown): BadgeImport {
  const data = object(payload);
  if (!Array.isArray(data.filters) || data.filters.length > 1000) throw new Error("Badge JSON must contain at most 1,000 filters.");
  const filters = data.filters.map(object).filter((item) => typeof item.name === "string" && item.name.trim() && typeof item.pattern === "string" && item.pattern.trim()).map((item) => {
    if ((item.pattern as string).length > 2048) throw new Error("A badge pattern exceeds the supported size.");
    return { ...item, name: (item.name as string).trim(), pattern: (item.pattern as string).trim(), isEnabled: item.isEnabled !== false } as StreamBadgeFilter;
  });
  if (!filters.length) throw new Error("Badge JSON did not contain usable filters.");
  return { sourceUrl: sourceUrl.trim(), filters, groups: Array.isArray(data.groups) ? data.groups.map(object) : [], isActive: true };
}

export function upsertBadgeImport(rules: BadgeRules, source: BadgeImport): BadgeRules {
  const key = source.sourceUrl.toLowerCase();
  const found = rules.imports.some((entry) => entry.sourceUrl.toLowerCase() === key);
  if (!found && rules.imports.length >= 3) throw new Error("You can import up to three badge URLs. Remove one first.");
  const imports = rules.imports.map((entry) => entry.sourceUrl.toLowerCase() === key ? source : { ...entry, isActive: false });
  if (!found) imports.push(source);
  return normalizeBadgeRules({ ...rules, imports });
}
