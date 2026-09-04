import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/** Short commit, or "unknown" where git is not available (a CI tarball). */
function commit() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const { version } = createRequire(import.meta.url)("./package.json") as {
  version: string;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  // A GitHub project site is served from /<repo>/, not the domain root. The
  // workflow sets this; everything else (custom domain, local preview) stays
  // at "/" and is unaffected.
  const base = env.VITE_BASE_PATH || "/";
  const devHosts = (env.DEV_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  // The one file that differs per shell, swapped at build time rather than
  // branched on at runtime.
  //
  // A shell embedding this UI — the Rust desktop client — points this at its
  // own implementation of the capability contract, and nothing else in the
  // source changes or needs to know. Unset, which is every ordinary web build,
  // the browser's own `platform/index.ts` is used and this does nothing.
  //
  // The pattern has to consume the whole specifier, not just its tail: a
  // regexp alias is a string replace, so matching only "/platform/index.ts"
  // leaves the leading "." of "./platform/index.ts" glued to the front of the
  // replacement. The importers reach it as both "./" and "../", hence the
  // leading wildcard rather than an exact pair of alternatives.
  // Read through loadEnv rather than `process.env`: it already merges the
  // environment with the .env files, and this config is typechecked without
  // Node's types.
  const platformModule = env.NUVIO_PLATFORM_MODULE || "";
  return {
    base,
    resolve: {
      alias: platformModule
        ? [{ find: /^.*\/platform\/index\.ts$/, replacement: platformModule }]
        : [],
    },
    define: {
      // Changes every build, so Settings can show which one is running — the
      // quickest way to confirm an update actually applied. The commit is in
      // there too, so a report from a phone names the code it came from.
      __APP_BUILD__: JSON.stringify(
        `${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${commit()}`,
      ),
      // Reported to the account's device list, so a device can be told from
      // the build it is running.
      __APP_VERSION__: JSON.stringify(version),
      "import.meta.env.VITE_NUVIO_SUPABASE_URL": JSON.stringify(env.VITE_NUVIO_SUPABASE_URL || env.NUVIO_SUPABASE_URL || ""),
      "import.meta.env.VITE_NUVIO_SUPABASE_FALLBACK_URL": JSON.stringify(env.VITE_NUVIO_SUPABASE_FALLBACK_URL || env.NUVIO_SUPABASE_FALLBACK_URL || ""),
      "import.meta.env.VITE_NUVIO_SUPABASE_ANON_KEY": JSON.stringify(env.VITE_NUVIO_SUPABASE_ANON_KEY || env.NUVIO_SUPABASE_ANON_KEY || ""),
      // The episode-ratings service, for a client that can call it directly.
      // Unset — which is every ordinary web build — the Worker is used instead,
      // because a browser cannot reach the service at all.
      "import.meta.env.VITE_NUVIO_IMDB_RATINGS_BASE_URL": JSON.stringify(env.VITE_NUVIO_IMDB_RATINGS_BASE_URL || env.NUVIO_IMDB_RATINGS_BASE_URL || ""),
    },
    plugins: [
      react(),
      VitePWA({
        // A shell is not a web page and has no business precaching itself.
        // Worse, this one waits to be prompted before taking an update, so a
        // worker registered once went on serving its own copy of the app and
        // every later change appeared not to apply. The plan says not to port
        // the service worker; this is where that is enforced.
        disable: !!platformModule,
        // "prompt", not "autoUpdate": autoUpdate reloads the page as soon as a
        // new worker takes control, which restarted the app mid-boot.
        registerType: "prompt",
        includeAssets: [
          "app-icon-1024.png",
          "Nuvio-icon.png",
          "theme-bootstrap.js",
          "nuvio-wordmark.png",
        ],
        manifest: {
          name: "Nuvio Web",
          short_name: "Nuvio",
          description: "Browse Nuvio catalogs and play browser-compatible streams.",
          theme_color: "#080a0d",
          background_color: "#080a0d",
          display: "standalone",
          orientation: "any",
          start_url: base,
          scope: base,
          icons: [
            { src: `${base}app-icon-1024.png`, sizes: "1024x1024", type: "image/png", purpose: "any" },
            // Kept separate from "any": a maskable icon is cropped to the
            // platform's safe zone, so declaring one entry as both lets
            // Android crop artwork that was never padded for it.
            { src: `${base}app-icon-1024.png`, sizes: "1024x1024", type: "image/png", purpose: "maskable" }
          ]
        },
        workbox: {
          navigateFallback: `${base}index.html`,
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.destination === "image",
              handler: "CacheFirst",
              options: { cacheName: "nuvio-images", expiration: { maxEntries: 300, maxAgeSeconds: 604800 } }
            }
          ]
        }
      })
    ],
    // A tunnel forwards its public Host header through to Vite, which rejects
    // hosts it does not know with "Blocked request". Whose tunnel that is
    // belongs to whoever is testing, so it is named in .env.local rather than
    // here: DEV_ALLOWED_HOSTS=host.one,host.two
    server: { port: 4174, host: "0.0.0.0", allowedHosts: devHosts },
    // The tunnel targets preview, not dev: vite-plugin-pwa only emits a
    // service worker on build, so a PWA install needs the built output.
    // strictPort keeps it from drifting onto another port and silently
    // leaving the tunnel pointed at nothing.
    preview: { port: 4180, strictPort: true, host: "0.0.0.0", allowedHosts: devHosts }
  };
});
