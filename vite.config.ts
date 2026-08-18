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
  return {
    base,
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
    },
    plugins: [
      react(),
      VitePWA({
        // "prompt", not "autoUpdate": autoUpdate reloads the page as soon as a
        // new worker takes control, which restarted the app mid-boot.
        registerType: "prompt",
        includeAssets: [
          "app-icon-1024.png",
          "Nuvio-icon.png",
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
