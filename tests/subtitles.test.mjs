import assert from "node:assert/strict";
import test from "node:test";
import {
  activeBrowserSubtitleText,
  chooseBrowserSubtitle,
  idForPrefixes,
  isForcedSubtitle,
  parseBrowserSubtitles,
  subtitleRequestIds,
} from "../src/lib/subtitles.ts";

test("browser subtitles parse both SRT and WebVTT timestamps", () => {
  assert.deepEqual(
    parseBrowserSubtitles("1\r\n00:00:01,250 --> 00:00:03,500\r\nHello <i>there</i>\r\n"),
    [{ start: 1.25, end: 3.5, text: "Hello there" }],
  );
  assert.deepEqual(
    parseBrowserSubtitles("WEBVTT\n\ncue-one\n01:02.100 --> 01:04.900 align:center\nFirst<br>Second"),
    [{ start: 62.1, end: 64.9, text: "First\nSecond" }],
  );
});

test("metadata and malformed blocks are ignored safely", () => {
  assert.deepEqual(
    parseBrowserSubtitles("WEBVTT\n\nNOTE hello\nnot a cue\n\n00:02.000 --> nope\nNo end"),
    [],
  );
});

test("active cue lookup does not scan from the beginning of a subtitle file", () => {
  const cues = Array.from({ length: 10_000 }, (_, index) => ({
    start: index * 2,
    end: index * 2 + 1.5,
    text: `Cue ${index}`,
  }));
  assert.equal(activeBrowserSubtitleText(cues, 19_998.5), "Cue 9999");
  assert.equal(activeBrowserSubtitleText(cues, 19_999.75), "");
});

test("forced subtitles are identified from language, id, or songs-and-signs labels", () => {
  assert.equal(isForcedSubtitle("regular", "forced"), true);
  assert.equal(isForcedSubtitle("english-forced", "eng"), true);
  assert.equal(isForcedSubtitle("songs-and-signs", "eng"), true);
  assert.equal(isForcedSubtitle("english-full", "eng"), false);
});

test("Off stays off even when a fallback language remains saved", () => {
  const tracks = [{ id: "english-full", lang: "eng" }];
  assert.equal(
    chooseBrowserSubtitle(tracks, "none", "eng", ["en-US"], "eng", true),
    -1,
  );
});

test("forced selection follows the audio-language rule from the official client", () => {
  const tracks = [
    { id: "english-full", lang: "eng" },
    { id: "english-forced", lang: "eng" },
    { id: "spanish-full", lang: "spa" },
  ];
  assert.equal(
    chooseBrowserSubtitle(tracks, "eng", "", ["en"], "eng", true),
    1,
    "matching English audio selects only the English forced track",
  );
  assert.equal(
    chooseBrowserSubtitle(tracks, "spa", "", ["en"], "eng", true),
    2,
    "different-language audio selects the normal preferred subtitle",
  );
});

test("ASS dialogue is read as text, following its Format line", () => {
  const script = [
    "[Script Info]",
    "Title: x",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname",
    "Style: Default,Arial",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Comment: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,ignored",
    "Dialogue: 0,0:00:02.00,0:00:04.50,Default,,0,0,0,,{\\i1}Wait,{\\i0} what?\\Nreally",
    // The same line again on another layer, as fansub outlines do.
    "Dialogue: 1,0:00:02.00,0:00:04.50,Default,,0,0,0,,{\\i1}Wait,{\\i0} what?\\Nreally",
    "Dialogue: 0,0:00:01.00,0:00:03.00,Sign,,0,0,0,,{\\an8\\pos(640,40)}Tokyo Station",
    // A sign drawn as a shape: coordinates, not text.
    "Dialogue: 0,0:00:01.00,0:00:03.00,Sign,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100",
  ].join("\r\n");
  assert.deepEqual(parseBrowserSubtitles(script), [
    { start: 1, end: 3, text: "Tokyo Station" },
    { start: 2, end: 4.5, text: "Wait, what?\nreally" },
  ]);
  assert.deepEqual(
    parseBrowserSubtitles("[Events]\nFormat: Start, End, Text\nDialogue: 0:00:10.00,0:00:11.00,Hi"),
    [{ start: 10, end: 11, text: "Hi" }],
  );
});

test("overlapping cues are shown together rather than the newer hiding the older", () => {
  const cues = [
    { start: 1, end: 3, text: "Tokyo Station" },
    { start: 2, end: 4.5, text: "Wait, what?" },
  ];
  assert.equal(activeBrowserSubtitleText(cues, 2.5), "Tokyo Station\nWait, what?");
  assert.equal(activeBrowserSubtitleText(cues, 3.5), "Wait, what?");
  assert.equal(activeBrowserSubtitleText(cues, 0.5), "");
});

test("an anime episode is also offered by its IMDb mapping", () => {
  assert.deepEqual(
    subtitleRequestIds(
      { id: "kitsu:12" },
      { id: "kitsu:12:1", imdbId: "tt0388629", imdbSeason: 1, imdbEpisode: 1 },
    ),
    ["kitsu:12:1", "tt0388629:1:1"],
  );
  assert.deepEqual(subtitleRequestIds({ id: "kitsu:9", imdbId: "tt9" }), ["kitsu:9", "tt9"]);
  assert.deepEqual(subtitleRequestIds({ id: "tt5" }, { id: "tt5:1:1" }), ["tt5:1:1"]);
});

test("subtitle addons are asked with an id they declare, or not at all", () => {
  const ids = ["kitsu:12:1", "tt0388629:1:1"];
  assert.equal(idForPrefixes(ids, ["tt"]), "tt0388629:1:1");
  assert.equal(idForPrefixes(ids, ["kitsu"]), "kitsu:12:1");
  assert.equal(idForPrefixes(ids, undefined), "kitsu:12:1");
  assert.equal(idForPrefixes(["kitsu:12:1"], ["tt"]), undefined);
});
