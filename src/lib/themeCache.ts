/** Paint/cache only resolved settings. null means sync has not answered yet. */
export function applyResolvedTheme(
  theme: { amoled: boolean; selectedTheme: string } | null,
  root: HTMLElement = document.documentElement,
  page: Document = document,
  storage: Pick<Storage, "setItem"> | undefined = undefined,
) {
  if (!theme) return;
  const accent = theme.selectedTheme.toLowerCase();
  const background = theme.amoled ? "#000000" : "#080a0d";
  root.dataset.theme = theme.amoled ? "amoled" : "default";
  root.dataset.nuvioAccent = accent;
  root.style.backgroundColor = background;
  page.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
  try {
    const cache = storage ?? localStorage;
    cache.setItem("nuvio-web-amoled", String(theme.amoled));
    cache.setItem("nuvio-web-accent", accent);
  } catch { /* A blocked cache must not prevent theme changes or sign-in. */ }
}
