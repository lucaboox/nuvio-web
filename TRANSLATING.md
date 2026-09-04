# Translating Nuvio Web

Every string a person reads lives in `src/locales/`, one JSON file per
language. Nothing user-facing is written into a component any more.

That is not tidiness. It is what makes a translation fixable by someone who
does not write TypeScript: a wrong word is a one-line change to a JSON file and
a pull request, rather than a change to a component that has to be reviewed as
code.

## Fixing or improving a translation

1. Open `src/locales/<language>.json`.
2. Find the key and change its value.
3. Open a pull request.

That is the whole process. You do not need to build the app or understand the
code to correct a word.

**The translations were written by an AI, not by native speakers.** They should
be right and they are consistent, but nobody who speaks these languages daily
has read them. If something sounds wrong to you, it probably is — please change
it. Corrections from people who actually speak the language are the point of
this file being separate.

## Adding a language

1. Copy `en.json` to `<tag>.json`, where the tag is the two-letter code —
   `pt.json`, `pl.json`, `tr.json`.
2. Translate the values. Leave the keys alone.
3. Add it to `LOCALES` in `src/lib/i18n.ts`.

Only add it to `LOCALES` once every key is translated. A half-translated
language in that menu is a promise the app does not keep: you pick it, most of
the screen stays English, and the setting looks broken rather than incomplete.
An untranslated key falls back to English, so a partial file is safe to work on
— it simply should not be offered until it is finished.

## Rules for the strings themselves

**Keep the `{placeholders}`.** `Download season {season}` must keep `{season}`
in the translation, in whatever position the sentence needs. A dropped
placeholder renders a sentence with a hole in it, and a test will fail.

**Plurals use suffixed keys.** `library.count.one` and `library.count.other`.
The right one is chosen by `Intl.PluralRules` for the language, so a language
with more forms may add `.few`, `.many` or `.zero`; anything missing falls back
to `.other`.

**Keep the register consistent within a language.** The existing files settle
this per language and it is worth matching: German uses infinitives for buttons
(*Herunterladen*, not *Laden Sie herunter*), Japanese stays in ですます, French
implies vouvoiement.

**Product and protocol names are not translated.** Nuvio, TMDB, MDBList,
Trakt, Fusion, regex. "Addon" is decided per language — German keeps *Addons*,
Spanish uses *Complementos*, Japanese *アドオン* — but whichever a file picks, it
uses everywhere.

## For anyone changing the app

Do not write user-facing text into a component. Add a key to `en.json`, use
`t("your.key")`, and add the translation to the other files — or leave them and
they fall back to English until someone translates it.

```tsx
// no
<button>Download</button>

// yes
<button>{t("sources.download")}</button>
```

Interpolation and counts:

```tsx
t("sources.downloadSeason", { season: 4 })   // Download season 4
plural("library.count", titles.length)       // 1 synced title / 7 synced titles
```

`t()` reads a module variable, so a component that renders translated text must
be under something that called `useLanguage()` — `App` does, which covers the
tree. A missing key renders as the key itself, which is deliberate: it is
obvious on screen and in a test, rather than rendering as nothing.

Three tests in `tests/i18n.test.mjs` hold the shape: no locale may carry a key
English lacks, every translation must keep the same placeholders, and plural
keys must come in complete sets. `tests/styleClasses.test.mjs` does the
equivalent job for CSS class names.

## What is not translated yet

Coverage is not complete. The remaining English is mostly long explanatory
copy — some settings descriptions, error messages and the empty states in
less-travelled screens. Those fall back to English rather than breaking, so the
app works in every listed language today; it is simply more English than it
should be in places.

Adding a key for one of those is the same three steps as any other string.
