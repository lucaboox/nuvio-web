import type { WebPlayerSettings } from "./webSettings.ts";
import type { SyncPreferenceValue } from "./settingsBlob.ts";

/** Playback-only snapshot. Never replaces the profile blob or writes to sync. */
export function nativePlayerPreferences(settings: WebPlayerSettings): Record<string, SyncPreferenceValue> {
  const preferences: Record<string, SyncPreferenceValue> = {};
  const strings: Record<string, string> = {
    resize_mode: settings.resizeMode,
    preferred_audio_language: settings.preferredAudioLanguage,
    secondary_preferred_audio_language: settings.secondaryPreferredAudioLanguage,
    preferred_subtitle_language: settings.preferredSubtitleLanguage,
    secondary_preferred_subtitle_language: settings.secondaryPreferredSubtitleLanguage,
    subtitle_text_color: settings.subtitleTextColor,
    subtitle_background_color: settings.subtitleBackgroundColor,
    subtitle_outline_color: settings.subtitleOutlineColor,
  };
  for (const [key, value] of Object.entries(strings)) preferences[key] = { type: "string", value };
  for (const [key, value] of Object.entries({
    subtitle_font_size_sp: settings.subtitleFontSizeSp,
    subtitle_bottom_offset: settings.subtitleBottomOffset,
    subtitle_outline_width: settings.subtitleOutlineWidth,
  })) preferences[key] = { type: "int", value };
  for (const [key, value] of Object.entries({
    subtitle_bold: settings.subtitleBold,
    subtitle_outline_enabled: settings.subtitleOutlineEnabled,
    subtitle_use_forced_subtitles: settings.subtitleUseForcedSubtitles,
    subtitle_show_only_preferred_languages: settings.subtitleShowOnlyPreferredLanguages,
    use_libass: settings.useLibass,
  })) preferences[key] = { type: "boolean", value };
  return preferences;
}
