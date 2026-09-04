// Runs before the app bundle/body can paint. Only appearance is cached here;
// account settings still come from the normal profile sync once it completes.
(() => {
  let amoled = false;
  let accent = "white";
  try {
    amoled = localStorage.getItem("nuvio-web-amoled") === "true";
    const cached = localStorage.getItem("nuvio-web-accent");
    if (["white", "crimson", "ocean", "violet", "emerald", "amber", "rose"].includes(cached)) accent = cached;
  } catch { /* Storage can be unavailable; loading must still work. */ }
  const root = document.documentElement;
  root.dataset.theme = amoled ? "amoled" : "default";
  root.dataset.nuvioAccent = accent;
  // Covers the document before the main stylesheet has arrived, too.
  root.style.backgroundColor = amoled ? "#000000" : "#080a0d";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", root.style.backgroundColor);
})();
