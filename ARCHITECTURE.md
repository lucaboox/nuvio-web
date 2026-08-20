# Nuvio Web architecture

## Goal

Nuvio Web is a separate, installable browser client. It reuses Nuvio's account
and Stremio-addon contracts without requiring a media server for ordinary
browsing. The Kotlin and Tauri applications remain independent.

## Recommended shape

```text
React PWA
  |-- Nuvio account API (authentication and synchronized account data)
  |-- Installed Stremio addons (manifest, catalog, meta, stream, subtitle)
  |-- Browser Cache/IndexedDB (session, manifests, lightweight response cache)
  `-- HTMLMediaElement + HLS.js
        `-- external-player handoff when the browser cannot play a source

Optional edge gateway (later)
  `-- authenticated, allow-listed CORS/header relay; never an open proxy
```

No Rust or Python application server is needed for the first version. Static
hosting or an edge platform is enough. Keeping catalog/meta calls in the PWA
means the host serves only the application bundle and does not pay for every
addon request.

## What runs in the browser

- Supabase-compatible email authentication, refresh, profile selection, and
  account reads.
- Addon manifest discovery and Stremio resource URL construction.
- Catalog ordering, metadata resolution, search, source presentation, and
  browser-compatible playback.
- Responsive UI, PWA installation, caching, and device-local preferences.

## The capability layer

`src/platform/` is what the UI asks for abilities through, so that the same
components can run over the Rust desktop shell without either build testing
which one it is inside. `types.ts` holds the contracts; `web.ts` answers them
with the modules that already did the work; `index.ts` names the shell and is
the only file another shell replaces.

`downloads` and `debrid` are optional and absent here. A browser cannot write a
resumable file it can later play back, and Torbox sends no cross-origin
headers, so neither is a matter of trying harder. The UI treats their absence
as "do not build this", not as a feature to disable — see
`../rust-webview-poc/SHARED-UI-PLAN.md`.

Web-only workarounds — the return relay, the Shortcut route, address-bar
compensation, the ratings Worker — stay outside the layer and are imported by
name, because a desktop shell would have no use for them.

## What remains server-side

- The existing Nuvio account backend and its row-level authorization rules.
- Addon servers themselves.
- A future optional gateway only for resources that do not allow browser CORS
  or require request headers browsers cannot attach to a video element.
- Optional future torrent/transmux service. It should be a user-run companion,
  not a shared Nuvio server, to avoid bandwidth and legal exposure.

## Playback policy

1. Native browser playback for MP4, WebM, and Safari HLS.
2. HLS.js for HLS where Media Source Extensions are available.
3. Try the browser for other direct HTTP media URLs and expose the error.
4. Offer open/copy handoff for unsupported codecs, torrents, `externalUrl`
   sources, and streams requiring custom headers.

Browsers cannot reliably play MKV, many HEVC/audio combinations, torrents, or
arbitrary authenticated streams. A JavaScript player does not add codecs the
browser lacks. Stremio solves the full-format case with a separate streaming
service; Nuvio Web should use the same optional-companion pattern later rather
than putting transcoding load on the public web host.

## Security boundary

- Publishable/anonymous backend keys are client identifiers, not secrets.
  Service-role keys must never be shipped to the PWA.
- Refresh sessions are stored in IndexedDB and access tokens remain in memory.
- Content is rendered as React text; addon HTML is never injected.
- Addon URLs must be HTTPS, except localhost during development.
- Network requests have timeouts and response-size limits.
- The production host should send the CSP in `index.html` as an HTTP header too.
- The optional relay must require a valid Nuvio session, resolve DNS on every
  request, block private/link-local destinations, cap response size/time, and
  allow only Stremio resource paths. It must never accept arbitrary proxy URLs.

## Migration stages

1. **Browser proof of concept (this folder):** account login, profiles, addons,
   catalogs, metadata, episodes, sources, internal HLS/native playback, and
   external fallback.
2. **Account parity:** *(largely done)* watched writes, theme settings,
   collections and the synced home layout. Still open: library mutations and
   profile management, both still read-only here.
3. **Playback hardening:** subtitles, audio selection where exposed, skip
   segments, AirPlay/Chromecast. Codec diagnostics are in place; desktop has no
   way to launch a local player, so it copies the stream URL instead — VLC
   registers no URL scheme on Windows.
4. **Optional companion/gateway:** local torrent/transmux service and tightly
   scoped edge CORS relay.
5. **Production:** CSP/security headers, telemetry opt-in, deployment, update
   UX, and iOS PWA testing.

