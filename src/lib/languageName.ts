/**
 * "en" as "English".
 *
 * Uses `Intl.DisplayNames` rather than a table: the browser already ships every
 * language name in every locale, so a Spanish user sees "Inglés" without this
 * file knowing anything about Spanish. A hardcoded map would have been a
 * hundred lines, English-only, and wrong the moment TMDB returned a code it did
 * not list.
 *
 * Anything it cannot name is returned unchanged, so a track labelled something
 * that is not a language code still shows what it actually said.
 */
const cache = new Map<string, string>();

/**
 * Subtitle conventions that collide with real ISO 639-3 codes.
 *
 * "sdh" is Southern Kurdish and "cc" is Atsam, so a track labelled for the
 * hard of hearing was being renamed to a language nobody had asked for. These
 * are labels, not languages, and are left exactly as they arrived.
 */
const NOT_LANGUAGES = new Set(["sdh", "cc", "hi", "forced", "full", "none"]);

let displayNames: Intl.DisplayNames | null | undefined;

function names(): Intl.DisplayNames | null {
  if (displayNames !== undefined) return displayNames;
  try {
    displayNames = new Intl.DisplayNames(undefined, {
      type: "language",
      // A code with no name comes back as the code, which is exactly the
      // fallback wanted here.
      fallback: "code",
    });
  } catch {
    displayNames = null;
  }
  return displayNames;
}

export function languageName(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const cached = cache.get(raw);
  if (cached !== undefined) return cached;

  // Codes arrive in every shape: "en", "eng", "en-US", "en_US", and sometimes
  // already spelled out. Only the first two are ISO 639 forms Intl resolves.
  const normalized = raw.replace("_", "-");
  const resolved = (() => {
    if (
      !NOT_LANGUAGES.has(normalized.toLowerCase()) &&
      /^[a-z]{2,3}(-[a-zA-Z0-9]+)*$/i.test(normalized)
    ) {
      const named = names()?.of(normalized);
      // `of` echoes the input when it has no name for it; treat that as a miss
      // so the original casing is preserved rather than a lowercased code.
      if (named && named.toLowerCase() !== normalized.toLowerCase()) return named;
    }
    // Not a code, or one nothing could name: show it as it came.
    return raw;
  })();

  const titled = resolved.charAt(0).toUpperCase() + resolved.slice(1);
  cache.set(raw, titled);
  return titled;
}
