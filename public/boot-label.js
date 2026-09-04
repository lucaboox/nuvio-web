/*
 * Translates the boot label before the first paint.
 *
 * The loading screen is plain HTML so it can appear before the bundle loads,
 * which means it cannot call t(). Waiting for React to translate it would show
 * English and then change it — the visible text swap this exists to avoid.
 *
 * The strings are duplicated from src/locales/*.json on purpose: nothing here
 * can import them. tests/bootLabel.test.mjs fails if the two drift, so the
 * locale files stay the one place a translation is corrected.
 */
(function () {
  var LABELS = {
    en: "Loading Nuvio…",
    de: "Nuvio wird geladen…",
    es: "Cargando Nuvio…",
    fr: "Chargement de Nuvio…",
    it: "Caricamento di Nuvio…",
    ja: "Nuvio を読み込んでいます…",
  };

  function chosen() {
    var stored = null;
    try {
      stored = localStorage.getItem("nuvio-web-language");
    } catch (error) {
      // Storage can be blocked outright; the device language still applies.
      stored = null;
    }
    if (stored && stored !== "system" && LABELS[stored]) return stored;
    // "system", or nothing stored: follow the browser, same as i18n resolve().
    var preferred = navigator.languages || [navigator.language || "en"];
    for (var i = 0; i < preferred.length; i += 1) {
      var base = String(preferred[i]).split("-")[0].toLowerCase();
      if (LABELS[base]) return base;
    }
    return "en";
  }

  try {
    var tag = chosen();
    if (tag !== "en") {
      var node = document.getElementById("boot-splash-label");
      if (node) node.textContent = LABELS[tag];
    }
  } catch (error) {
    // The English already in the markup is a fine outcome.
  }
})();
