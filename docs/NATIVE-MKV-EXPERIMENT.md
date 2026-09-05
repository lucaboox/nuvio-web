# Native MKV playback prototype

Opt in using `?nativeMkv=1` on the page URL before selecting a Matroska source.
Without that parameter, existing playback is unchanged. Native Rust/mpv is not
affected: its player effect exits before the browser branch.

This is **not hardware-verified**. It copies encoded packets into separate audio
and video fragmented MP4 streams using Mediabunny, and appends them to
MediaSource/ManagedMediaSource attached to the actual HTML video element. There
is no video re-encoding or canvas rendering in this path.

- MIME support is checked per track using the selected browser media-source API.
- One supported audio track is selected. No audio transcoding or embedded subtitle
  extraction is implemented. Sources with no supported audio are rejected rather
  than silently losing their audio. DTS is not made playable by changing containers.
- Finite metadata duration is required. The timeline is not based on bytes read.
- Seeking outside buffered ranges restarts from a source keyframe. Old generations
  are canceled and do not append to the new buffers.
- Source caching is capped at 16 MiB; read-ahead is throttled, old buffered media
  is evicted, and oversized/unflushed fragments fail rather than grow without bound.
- Hosts ignoring byte ranges are rejected. CORS and host availability still apply.
- ManagedMediaSource streaming state is respected once media is available.
- Remote playback is disabled for the MMS path; this does not add AirPlay support.
- Failed startup is visible. Automatic fallback is intentionally not attempted
  after a partial native load; remove the query parameter to test the canvas path.

Before promoting this to the default, test on a physical iPhone: H.264/AAC,
HEVC/AAC and supported Dolby tracks; repeated reopen; several minutes playback;
seek forward/back outside the buffer; resume at a later episode position; pause
and resume; background/foreground; fullscreen; unsupported audio; missing range
support. Unit tests and a production build do not substitute for these checks.

References:
- https://webkit.org/blog/14735/webkit-features-in-safari-17-1/
- https://mediabunny.dev/guide/media-sinks
- https://mediabunny.dev/guide/output-targets
