/** Cover the native video hole before mpv destroys/resizes its child window. */
export function coverNativePlayerSurface(): Promise<void> {
  document.documentElement.classList.add("native-player-covered");
  return new Promise((resolve) => {
    let frame = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
      resolve();
    };
    // rAF callbacks run before paint. Two frames give the compositor a chance
    // to submit the opaque layer before the native stop request can run.
    // Hidden windows may suspend rAF, so closing must not wait indefinitely.
    const fallback = window.setTimeout(finish, 250);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(finish);
    });
  });
}

/** Only reveal the hole again after the new native stream has its first frame. */
export function revealNativePlayerSurface(): void {
  document.documentElement.classList.remove("native-player-covered");
}
