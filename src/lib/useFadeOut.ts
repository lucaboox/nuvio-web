import { useEffect, useRef, useState } from "react";

/**
 * Keeps something mounted long enough to animate away.
 *
 * React unmounts the moment a condition goes false, which is why overlays in
 * this app disappeared rather than closed. This holds the element for the
 * length of its transition and reports when it is leaving, so the CSS has
 * something to animate on.
 *
 * Returns `mounted` — render while true — and `leaving`, which is true only
 * during the exit.
 */
export function useFadeOut(active: boolean, ms: number) {
  const [mounted, setMounted] = useState(active);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    if (active) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    // Nothing to fade if it was never up: this also covers the first render,
    // where an exit animation would be a flash of something never shown.
    if (!mounted) return;
    setLeaving(true);
    timer.current = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, ms);
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
    // `mounted` is read but must not re-run this: it changes as a result of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ms]);

  return { mounted, leaving };
}
