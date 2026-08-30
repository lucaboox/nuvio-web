/**
 * Device-local search history — never synced, and capped at ten entries.
 *
 * Not in the account blob on purpose: what someone searched for is the most
 * personal thing this app holds, and it has no business arriving on the family
 * TV because it was typed on a phone.
 */
const STORAGE_KEY = "nuvio.recentSearches";
const LIMIT = 10;

export function readRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .filter((entry): entry is string => typeof entry === "string")
          .slice(0, LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function rememberSearch(query: string): string[] {
  const value = query.trim();
  if (!value) return readRecentSearches();
  // Case-insensitive dedupe, so "dune" and "Dune" do not both take a slot.
  const next = [
    value,
    ...readRecentSearches().filter(
      (entry) => entry.toLowerCase() !== value.toLowerCase(),
    ),
  ].slice(0, LIMIT);
  write(next);
  return next;
}

export function forgetSearch(query: string): string[] {
  const next = readRecentSearches().filter((entry) => entry !== query);
  write(next);
  return next;
}

export function clearRecentSearches(): string[] {
  write([]);
  return [];
}

function write(entries: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // History is a convenience; a full store must not break search.
  }
}
