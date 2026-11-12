/**
 * Per-season posters, as an addon sends them in `app_extras`.
 *
 * Ported from Nuvio's MetaDetailsParser. AIOMetadata moved to a keyed form,
 * `{ "1": url, "2": url }`, under `seasonPosters` or `seasonPosterByNumber`;
 * older versions and other addons send a plain array, which has to be lined
 * up against the seasons the title actually has.
 */
export function parseSeasonPosters(
  appExtras: Record<string, unknown>,
  seasonNumbers: readonly number[],
): Record<number, string> {
  const keyed = parseKeyed(appExtras.seasonPosters);
  if (Object.keys(keyed).length) return keyed;
  const byNumber = parseKeyed(appExtras.seasonPosterByNumber);
  if (Object.keys(byNumber).length) return byNumber;

  const posters = appExtras.seasonPosters;
  if (!Array.isArray(posters)) return {};
  const seasons = [...new Set(seasonNumbers.filter((season) => season >= 0))].sort(
    (a, b) => a - b,
  );
  const positive = seasons.filter((season) => season > 0);
  // The array has no keys, so which season each entry belongs to is read off
  // its length: one per season, one per real season, or one per real season
  // with an empty slot standing in for specials. Failing all of those, it is
  // taken to start at season 1.
  const order =
    seasons.length === posters.length
      ? seasons
      : positive.length === posters.length
        ? positive
        : positive.length && posters.length === positive.length + 1 && posters[0] == null
          ? [0, ...positive]
          : posters.map((_, index) => index + 1);
  const result: Record<number, string> = {};
  posters.forEach((poster, index) => {
    const url = usable(poster);
    if (url) result[order[index]!] = url;
  });
  return result;
}

function parseKeyed(value: unknown): Record<number, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<number, string> = {};
  for (const [key, poster] of Object.entries(value as Record<string, unknown>)) {
    const season = Number(key);
    const url = usable(poster);
    if (Number.isInteger(season) && url) result[season] = url;
  }
  return result;
}

const usable = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
