import { useSyncExternalStore } from "react";
import en from "../locales/en.json";

/**
 * Interface strings, kept out of the components.
 *
 * Deliberately not a library. What a library adds beyond this is plural rules
 * and date formatting, and the platform already ships both as `Intl` — so the
 * dependency would buy loading and a key syntax, and cost a permanent
 * upgrade obligation. Everything here is about sixty lines.
 *
 * English is bundled because it is the fallback and is therefore always needed.
 * Every other locale is fetched when it is chosen: twenty languages of the
 * whole interface is far more than any one reader wants in their bundle.
 */
export type Messages = Record<string, string>;

/**
 * The languages on offer, each with a complete file.
 *
 * Listed only where every key is translated. A half-translated language in this
 * menu is a promise the app does not keep: you choose it, most of the screen
 * stays English, and the setting looks broken rather than incomplete.
 */
export const LOCALES: Array<{ tag: string; label: string }> = [
  { tag: "en", label: "English" },
  { tag: "de", label: "Deutsch" },
  { tag: "es", label: "Español" },
  { tag: "fr", label: "Français" },
  { tag: "it", label: "Italiano" },
  { tag: "ja", label: "日本語" },
];

const STORAGE_KEY = "nuvio-web-language";
const fallback = en as Messages;

let messages: Messages = fallback;
let tag = "en";
const listeners = new Set<() => void>();
/** Bumped on every change so `useSyncExternalStore` sees a new snapshot. */
let version = 0;

function announce() {
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * The language to start in.
 *
 * "system" means follow the browser, which is what someone who never opens the
 * setting should get. An explicit choice is remembered on the device — it is a
 * property of who is reading, not of the account.
 */
export function storedLanguage(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "system";
  } catch {
    return "system";
  }
}

function resolve(choice: string): string {
  if (choice !== "system") return choice;
  const preferred = typeof navigator === "undefined" ? [] : navigator.languages;
  for (const candidate of preferred ?? []) {
    const base = candidate.split("-")[0].toLowerCase();
    if (LOCALES.some((locale) => locale.tag === base)) return base;
  }
  return "en";
}

export async function setLanguage(choice: string): Promise<void> {
  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // A device that cannot remember the choice still honours it this session.
  }
  const next = resolve(choice);
  if (next === "en") {
    messages = fallback;
    tag = "en";
    announce();
    return;
  }
  try {
    // Vite needs the shape of the path to be static so it can find every file
    // at build time; only the name inside it varies.
    const loaded = (await import(`../locales/${next}.json`)) as {
      default: Messages;
    };
    // English underneath, so a locale that is missing a key shows the English
    // rather than the key itself. A partly translated screen is worth having;
    // a screen of identifiers is not.
    messages = { ...fallback, ...loaded.default };
    tag = next;
  } catch {
    messages = fallback;
    tag = "en";
  }
  announce();
}

/** The active BCP 47 tag, for `Intl` and for the `lang` attribute. */
export const currentLanguage = () => tag;

/**
 * One string.
 *
 * `{name}` placeholders are replaced from `vars`. A missing key returns the key
 * so it is obvious on screen and in a test, rather than rendering as nothing.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const template = messages[key] ?? fallback[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * Plural forms, by the rules of the active language.
 *
 * `Intl.PluralRules` knows that Polish has three forms and Japanese has one, so
 * the keys are suffixed by the category it returns: `key.one`, `key.other`, and
 * whichever else a language needs.
 */
export function plural(
  key: string,
  count: number,
  vars?: Record<string, string | number>,
): string {
  let category = "other";
  try {
    category = new Intl.PluralRules(tag).select(count);
  } catch {
    category = count === 1 ? "one" : "other";
  }
  const exact = `${key}.${category}`;
  const chosen = messages[exact] ?? fallback[exact] ? exact : `${key}.other`;
  return t(chosen, { count, ...vars });
}

/** Re-renders the tree when the language changes. */
export function useLanguage(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => `${tag}:${version}`,
    () => "en:0",
  );
}
