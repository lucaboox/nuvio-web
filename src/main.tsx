import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { setRegistration, setUpdateHandler } from "./lib/appUpdate";
import { lockZoom } from "./lib/lockZoom";
import "./styles.css";

const updateSW = import.meta.env.PROD
  ? registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        // Kept so Settings can trigger an update check on demand.
        setRegistration(registration ?? null);
      },
      onNeedRefresh() {
        // Held until the user asks for it, so a deploy never interrupts playback.
        setUpdateHandler(async () => {
          await updateSW(true);
        });
      },
    })
  : async () => undefined;

// A previously installed production PWA can otherwise keep intercepting the
// same LAN dev URL and make an iPhone look as though it is still running an old
// remuxer. Development must always be network-first source code.
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(registrations.map((registration) => registration.unregister())),
    )
    .then(() => {
      if (
        navigator.serviceWorker.controller &&
        sessionStorage.getItem("nuvio-dev-sw-cleared") !== "true"
      ) {
        sessionStorage.setItem("nuvio-dev-sw-cleared", "true");
        window.location.reload();
      }
    })
    .catch(() => undefined);
}
lockZoom();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

