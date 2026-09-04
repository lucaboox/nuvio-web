# Shared playback/settings audit

## Reference

Compared with the official source in `composeApp/src/commonMain/kotlin/com/nuvio/app/features`:

- `player/PlayerSettingsRepository.kt` and desktop `PlayerSettingsStorage.desktop.kt`: defaults and typed sync keys.
- `player/skip/PlayerNextEpisodeRules.kt` and `player/PlayerNextEpisodeAutoPlay.kt`: thresholds, post-credit scenes, source fallback and three-second countdown.
- `streams/StreamAutoPlaySelector.kt`: source scope, selected addon/plugin names and case-insensitive regex.
- `streams/StreamBadgeRules.kt`, `StreamBadgeSettingsRepository.kt`, `StreamBadgeChip.kt`: three imports, one active, import schema and badge presentation.
- `home/components/HomeContinueWatchingSection.kt`: blur applies to unwatched Next Up episode thumbnails, not only future air dates.

## Fixed/wired in this pass

- Playback is grouped into general controls, Stream auto-play, Next episode, Skipping, Audio & subtitles, Subtitle rendering and Fusion badges.
- The skip preference actually gates timing requests, skip buttons and automatic skipping. Intro/recap/outro choices use the official string-set values. Automatic skips run once per segment per playback, not on every time update.
- Next episode uses the synced percentage (99% default) or minutes (2 default), considers post-credit scenes, offers a cancellable three-second automatic countdown, and does not auto-play unaired episodes.
- Source auto-play respects addon scope/selections, regex, wait budget, binge-group reuse/preference, and the manual-mode next-episode fallback rule. Missing matches return to source selection instead of leaving the player loading indefinitely. Disabled plugin-only scope is not silently broadened.
- Fusion imports can be added, refreshed, selected, removed, previewed and individually enabled. Unknown imported fields survive edits. Patterns run in a bounded worker rather than freezing React; a timed-out ruleset is quarantined for the page session.
- Player episode picker now respects unwatched blur (excluding the current episode). The blur CSS no longer blurs the IMDb icon. Continue Watching's misleading “unaired” label now describes the official behavior; it requires episode thumbnails, not title posters.
- Each native playback launch carries a read-only snapshot of current UI audio/subtitle preferences. This fixes the stale shell-cache path without fetching the account again or rewriting its settings blob. Native font, colors, bold, outline, position, language and libass style preservation consequently use current settings.

## Scope and remaining platform limits

- Existing typed settings writes and serialized payload formats are retained. New threshold values are `float`, auto-skip/addon selections are `string_set`, and Fusion rules remain a JSON `string` under `stream_badge_settings.stream_badge_rules`.
- This is a targeted audit, not a claim that every setting in the official app has been ported.
- Browser skip timings come from the existing IntroDB endpoint. Desktop now uses the shell's existing cached-download/IntroDB/AniSkip/optional AnimeSkip providers; the current AnimeSkip toggle/client ID are passed read-only. IntroDB submission is not implemented by this shared player, and browser AnimeSkip support remains unavailable.
- Browser subtitle style controls affect browser-rendered text cues where tracks are available. Native/libmpv has full ASS rendering already. Browser ASS effects are **not implemented** in this pass; a libass/WASM renderer such as [JASSUB](https://github.com/ThaUnknown/jassub) needs a dedicated subtitle source/track pipeline, worker assets and rendering tests on iOS. Android `CUES`/OpenGL/Canvas options are not exposed as nonfunctional switches.
- Native “Preserve ASS/SSA styling” uses the existing official `use_libass` setting to select mpv's `sub-ass-override=no` versus `force`; it does not load a new renderer. See [mpv subtitle options](https://mpv.io/manual/stable/#options-sub-ass-override).
- External player apps own their own auto-next, skip and subtitle behavior. The shared controls apply to the two **internal** players.
- Browser badge imports still require the host's CORS permission. No proxy/server was added.

## Verification

Automated tests cover sync types/defaults, thresholds and post-credits behavior, source scopes/fallbacks/waiting, blur rules, skip gating, Fusion normalization and matching, and the read-only native preference override. Physical iOS playback remains a device test, not something these unit tests establish.
