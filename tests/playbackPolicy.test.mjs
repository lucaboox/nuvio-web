import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readWebSettings, streamBadgesFor } from "../src/lib/webSettings.ts";
import { automaticSkipSegment, nextEpisodeDue, selectAutoStream, shouldBlurEpisode, resolveAutoStream } from "../src/lib/playbackPolicy.ts";
import { nativePlayerPreferences } from "../src/lib/nativePlayerPreferences.ts";
import { withBlobTypedValue } from "../src/lib/settingsBlob.ts";
import { parseBadgeImport, readBadgeRules, upsertBadgeImport, normalizeBadgeRules } from "../src/lib/fusionBadges.ts";

const defaults = readWebSettings(null).player;
test("settings components use the shell-replaced platform entrypoint", () => {
  for (const file of ["PlaybackPolicySettings", "FusionBadgeSettings"]) {
    const source = readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), "utf8");
    assert.match(source, /from "\.\.\/platform\/index\.ts"/);
    assert.doesNotMatch(source, /from "\.\.\/platform"/);
  }
});
const stream = (addonName, title, group) => ({ name: title, title, description: "", addonName, url: "https://example.test/video", behaviorHints: { bingeGroup: group } });

test("skip toggle gates all automatic segment types and safely bounds end credits", () => {
  const intro = { kind: "intro", start: 10, end: 60 };
  const credits = { kind: "credits", start: 900, end: Infinity };
  const settings = { ...defaults, autoSkipSegmentTypes: ["intro", "outro"] };
  assert.equal(automaticSkipSegment([intro], 12, 1000, settings), intro);
  assert.equal(automaticSkipSegment([intro], 12, 1000, { ...settings, skipIntroEnabled: false }), null);
  assert.equal(automaticSkipSegment([intro], 12, 1000, defaults), null);
  assert.equal(automaticSkipSegment([credits], 930, 1000, settings), credits);
  assert.equal(automaticSkipSegment([credits], 1000, 1000, settings), null);
  assert.equal(automaticSkipSegment([intro], 12, 0, settings), null);
});
test("auto-play can select a progressive result without waiting for the slowest addon", async () => {
  const chosen = stream("A", "first");
  let finish;
  const result = await resolveAutoStream((onBatch) => {
    onBatch([chosen]);
    return new Promise((resolve) => { finish = resolve; });
  }, (streams) => streams[0] ?? null, 0);
  assert.equal(result, chosen);
  finish([chosen]);
});
test("wait-for-all and unmatched source policies settle without a timer overflow", async () => {
  const chosen = stream("A", "first");
  assert.equal(await resolveAutoStream(async (onBatch) => { onBatch([]); return [chosen]; }, (streams) => streams[0] ?? null, 2147483647), chosen);
  assert.equal(await resolveAutoStream(async () => [chosen], () => null, 3), null);
});

test("official next-episode defaults and typed float/string-set payloads are respected", () => {
  assert.equal(defaults.nextEpisodeThresholdPercent, 99);
  assert.equal(defaults.nextEpisodeThresholdMinutes, 2);
  assert.equal(defaults.autoPlayNextEpisode, false);
  let blob = { version: 3, features: { untouched: { keep: true } } };
  blob = withBlobTypedValue(blob, "player_settings", "next_episode_threshold_minutes_before_end_v2", "float", 3.2);
  blob = withBlobTypedValue(blob, "player_settings", "auto_skip_segment_types", "string_set", ["intro", "recap", "unknown"]);
  blob = withBlobTypedValue(blob, "player_settings", "stream_auto_play_timeout_seconds", "int", 2147483647);
  const settings = readWebSettings(blob).player;
  assert.equal(settings.nextEpisodeThresholdMinutes, 3.2);
  assert.deepEqual(settings.autoSkipSegmentTypes, ["intro", "recap"]);
  assert.equal(settings.autoPlayTimeoutSeconds, 2147483647);
  assert.deepEqual(blob.features.untouched, { keep: true });
});
test("percentage and minutes thresholds work without credits", () => {
  assert.equal(nextEpisodeDue(980, 1000, defaults, []), false);
  assert.equal(nextEpisodeDue(990, 1000, defaults, []), true);
  const settings = { ...defaults, nextEpisodeThresholdMode: "MINUTES_BEFORE_END" };
  assert.equal(nextEpisodeDue(879, 1000, settings, []), false);
  assert.equal(nextEpisodeDue(880, 1000, settings, []), true);
  assert.equal(nextEpisodeDue(1, 0, settings, []), false);
});
test("credits near the end advance the offer, but do not skip a post-credit scene", () => {
  assert.equal(nextEpisodeDue(910, 1000, defaults, [{ kind: "credits", start: 900, end: 1000 }]), true);
  assert.equal(nextEpisodeDue(910, 1000, defaults, [{ kind: "credits", start: 900, end: 940 }]), false);
  assert.equal(nextEpisodeDue(990, 1000, defaults, [{ kind: "credits", start: 900, end: 940 }]), true);
});
test("manual next episode prefers same release but does not silently choose another", () => {
  const first = stream("A", "first", "a");
  const same = stream("B", "same", "b");
  assert.equal(selectAutoStream([first, same], defaults, ["A", "B"], "b", true), same);
  assert.equal(selectAutoStream([first], defaults, ["A"], "b", true), null);
  assert.equal(selectAutoStream([first], { ...defaults, autoPlayNextEpisode: true }, ["A"], "b", true), first);
  assert.equal(selectAutoStream([first], { ...defaults, autoPlayNextEpisode: true, autoPlayNextEpisodeFallback: false }, ["A"], "b", true), null);
});
test("auto-play scopes, addon selections and case-insensitive regex are applied", () => {
  const a = stream("A", "1080p"); const b = stream("B", "2160p hevc");
  const settings = { ...defaults, autoPlayMode: "FIRST_STREAM", autoPlaySource: "INSTALLED_ADDONS_ONLY", autoPlaySelectedAddons: ["B"] };
  assert.equal(selectAutoStream([a, b], settings, ["A", "B"]), b);
  assert.equal(selectAutoStream([a], settings, ["A", "B"]), null);
  assert.equal(selectAutoStream([a, b], { ...settings, autoPlaySource: "ENABLED_PLUGINS_ONLY" }, ["A", "B"]), null);
  assert.equal(selectAutoStream([a, b], { ...settings, autoPlayMode: "REGEX_MATCH", autoPlayRegex: "HEVC" }, ["A", "B"]), b);
  assert.equal(selectAutoStream([b], { ...settings, autoPlayMode: "REGEX_MATCH", autoPlayRegex: "[" }, ["B"]), null);
});
test("episode blur covers unwatched artwork but not watched/current episodes", () => {
  assert.equal(shouldBlurEpisode(true, false), true);
  assert.equal(shouldBlurEpisode(false, false), false);
  assert.equal(shouldBlurEpisode(true, true), false);
  assert.equal(shouldBlurEpisode(true, false, true), false);
});
test("native launch receives current typed audio/subtitle preferences, not account data", () => {
  const data = nativePlayerPreferences({ ...defaults, useLibass: true, subtitleBold: true, preferredAudioLanguage: "en" });
  assert.deepEqual(data.use_libass, { type: "boolean", value: true });
  assert.deepEqual(data.subtitle_bold, { type: "boolean", value: true });
  assert.deepEqual(data.preferred_audio_language, { type: "string", value: "en" });
  assert.equal(data.auto_skip_segment_types, undefined);
});
test("each native playback launch carries the current RTX switch, including turning it off", () => {
  for (const enabled of [true, false]) {
    const data = nativePlayerPreferences({ ...defaults, rtxSuperResolution: enabled });
    assert.deepEqual(data.nvidia_rtx_super_resolution_enabled, { type: "boolean", value: enabled });
  }
});

test("Fusion imports preserve extra fields, normalize to one active source and enforce three URLs", () => {
  const source = (id) => parseBadgeImport(`https://example.test/${id}`, { filters: [{ name: "HD", pattern: "(?i)1080p", future: 42 }], groups: [{ id: "video", future: true }] });
  let rules = { imports: [], future: true };
  for (let i = 0; i < 3; i++) rules = upsertBadgeImport(rules, source(i));
  assert.equal(rules.imports.filter((entry) => entry.isActive).length, 1);
  assert.equal(rules.imports[2].isActive, true);
  assert.equal(readBadgeRules(JSON.stringify(rules)).future, true);
  assert.equal(rules.imports[0].filters[0].future, 42);
  assert.throws(() => upsertBadgeImport(rules, source(3)), /three/);
  assert.equal(upsertBadgeImport(rules, source(0)).imports.length, 3);
  assert.equal(normalizeBadgeRules({ ...rules, imports: rules.imports.filter((entry) => !entry.isActive) }).imports[0].isActive, true);
  assert.throws(() => parseBadgeImport("https://example.test", { filters: [{}] }), /usable/);
});
test("Fusion inline Kotlin flags and active-source selection work on the web", () => {
  const serialized = JSON.stringify({ imports: [{ sourceUrl: "https://example.test", isActive: false, filters: [{ name: "HD", pattern: "(?i)HD" }] }] });
  const badges = readWebSettings({ version: 3, features: { stream_badge_settings: { stream_badge_rules: { type: "string", value: serialized } } } }).streamBadges;
  assert.equal(streamBadgesFor(stream("A", "hd"), badges)[0].name, "HD");
});
