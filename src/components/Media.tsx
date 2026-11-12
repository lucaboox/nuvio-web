import {
  Eye, Check, Play } from "lucide-react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { posterCandidates } from "../lib/posterFallback";
import { watchKey, type WatchIndex } from "../lib/progress";
import { useDragScroll } from "../lib/useDragScroll";
import { useLongPress } from "../lib/useLongPress";
import type { CatalogSection, Meta } from "../types";

export type MediaMenuHandler = (item: Meta, x: number, y: number) => void;

/**
 * A poster that falls back rather than breaking: the addon's own image, then
 * the plain one it names, then Metahub's, then the title's initial. See
 * `posterCandidates` for why the addon's own image is the one that fails.
 */
function PosterImage({ poster, id, name }: { poster?: string; id: string; name: string }) {
  const candidates = useMemo(() => posterCandidates(poster, id), [poster, id]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [candidates]);
  const image = useRef<HTMLImageElement | null>(null);
  const src = candidates[attempt];
  // A host that is slow rather than failing never fires onError, so a poster
  // could sit blank for as long as the request hung. Once it is on screen it
  // gets a few seconds before the next address is tried. Only when there is
  // a next one: the last is left to finish however long it takes.
  useEffect(() => {
    const node = image.current;
    if (!node || attempt >= candidates.length - 1) return;
    return watchStall(node, () => setAttempt((current) => Math.max(current, attempt + 1)));
  }, [attempt, candidates.length, src]);
  if (!src) return <span className="poster-fallback">{name.slice(0, 1)}</span>;
  return (
    <img
      ref={image}
      key={src}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setAttempt((current) => current + 1)}
    />
  );
}

const STALL_MS = 8_000;
const stallTimers = new Map<Element, number>();
const stallHandlers = new Map<Element, () => void>();
let stallObserver: IntersectionObserver | null = null;

/**
 * Calls `onStall` if `node` has been on screen for STALL_MS without loading.
 * One observer for every poster rather than one each: a catalog grid holds
 * hundreds of them.
 */
function watchStall(node: HTMLImageElement, onStall: () => void): () => void {
  if (typeof IntersectionObserver === "undefined" || node.complete) return () => undefined;
  stallObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const target = entry.target as HTMLImageElement;
      if (!entry.isIntersecting || target.complete) {
        window.clearTimeout(stallTimers.get(target));
        stallTimers.delete(target);
        continue;
      }
      if (stallTimers.has(target)) continue;
      stallTimers.set(
        target,
        window.setTimeout(() => {
          stallTimers.delete(target);
          if (!target.complete) stallHandlers.get(target)?.();
        }, STALL_MS),
      );
    }
  });
  stallHandlers.set(node, onStall);
  stallObserver.observe(node);
  const stop = () => {
    stallObserver?.unobserve(node);
    window.clearTimeout(stallTimers.get(node));
    stallTimers.delete(node);
    stallHandlers.delete(node);
  };
  node.addEventListener("load", stop, { once: true });
  return stop;
}

/**
 * Memoised because the grids re-render whenever the watch index changes, and
 * a catalog page can hold several hundred of these.
 */
export const PosterCard = memo(function PosterCard({
  item,
  index,
  onOpen,
  onMenu,
}: {
  item: Meta;
  index: WatchIndex;
  // Takes the item rather than a closure: an inline `() => onOpen(item)` at
  // the call site is a new function on every render, which defeats `memo` and
  // made every already-rendered card re-render on each progressive chunk.
  onOpen(item: Meta): void;
  onMenu?: MediaMenuHandler;
}) {
  const hold = useLongPress((x, y) => onMenu?.(item, x, y));
  const onClick = () => {
    if (!hold.consumedTap()) onOpen(item);
  };
  const progress = index.byContent.get(item.id);
  const percentage = progress?.durationMs
    ? Math.min(100, (progress.positionMs / progress.durationMs) * 100)
    : 0;
  // A movie is watched outright; a series is only badged once nothing is
  // part-watched, which the row-level index cannot tell us, so keep it to the
  // explicit movie case rather than badging a show mid-season.
  // A series counts when the show itself is marked watched, which is what
  // finishing one records. Episode-level marks are deliberately not summed
  // here: a poster carries no episode list, so "some episodes" cannot be told
  // from "all of them", and badging mid-season would be worse than not.
  const watched = index.watched.has(watchKey(item.id));
  return (
    <button
      className="poster-card"
      onClick={onClick}
      {...(onMenu ? hold : {})}
      aria-label={`Open ${item.name}`}
    >
      <span className="poster-image-wrap">
        <PosterImage poster={item.poster} id={item.id} name={item.name} />
        {watched && (
          <span className="watched-dot">
            <Eye size={15} />
          </span>
        )}
        {percentage > 0 && percentage < 98 && (
          <span className="poster-progress">
            <i style={{ width: `${percentage}%` }} />
          </span>
        )}
      </span>
      <strong>{item.name}</strong>
      <small>{item.releaseInfo || item.type}</small>
    </button>
  );
});

export function MediaRow({
  section,
  index,
  onOpen,
  onSeeAll,
  onMenu,
  subtitle,
}: {
  section: CatalogSection;
  index: WatchIndex;
  onOpen(item: Meta): void;
  onSeeAll?: () => void;
  onMenu?: MediaMenuHandler;
  subtitle?: string;
}) {
  const rowRef = useDragScroll<HTMLDivElement>();
  return (
    <section className="media-section">
      <header>
        <div>
          <h2>{section.name}</h2>
          {subtitle && <span>{subtitle}</span>}
        </div>
        {onSeeAll && <button onClick={onSeeAll}>See all</button>}
      </header>
      <div className="media-row" ref={rowRef}>
        {section.items.map((item) => (
          <PosterCard
            key={`${item.type}:${item.id}`}
            item={item}
            index={index}
            onOpen={onOpen}
            onMenu={onMenu}
          />
        ))}
      </div>
    </section>
  );
}

const HERO_ROTATE_MS = 9000;

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Rotating hero carousel.
 *
 * Every slide is laid out side by side in one horizontal scroller, and moving
 * between them is the browser scrolling — the same mechanism the catalog rows
 * use. It was a single slide translated under the finger before, which meant
 * the artwork moved but nothing behind it did, the gesture could not be
 * reversed halfway, and a flick had no momentum. Scroll snapping gives all of
 * that for free, and it is the one implementation the platform tunes per
 * device.
 *
 * Nine seconds between slides, matching the desktop client. Rotation pauses
 * while the pointer is over it, so it cannot slide out from under a click,
 * pauses while a finger is down, and stops entirely for anyone who has asked
 * for reduced motion.
 */
export function Hero({
  items,
  onOpen,
  onMenu,
}: {
  items: Meta[];
  onOpen(item: Meta): void;
  onMenu?: MediaMenuHandler;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const active = items[Math.min(index, Math.max(items.length - 1, 0))];
  const hold = useLongPress((x, y) => {
    if (active) onMenu?.(active, x, y);
  });

  /** Which slide the scroller has settled on. */
  const readIndex = () => {
    const element = track.current;
    if (!element || !element.clientWidth) return;
    const next = Math.round(element.scrollLeft / element.clientWidth);
    setIndex((current) => (next === current ? current : next));
  };

  const scrollTo = (next: number, smooth = true) => {
    const element = track.current;
    if (!element) return;
    element.scrollTo({
      left: next * element.clientWidth,
      behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto",
    });
  };

  /**
   * Only rotates while it is actually on screen.
   *
   * A programmatic scroll cancels an in-progress touch fling on Android, so a
   * carousel rotating out of view would cut short a flick down the page — the
   * page simply stops, seconds after the finger left it, for no visible
   * reason. Off screen there is also nothing to rotate for.
   */
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const element = track.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { threshold: 0.35 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (items.length < 2 || paused || !onScreen) return;
    if (prefersReducedMotion()) return;
    const timer = window.setInterval(() => {
      if (!track.current) return;
      scrollTo((index + 1) % items.length);
    }, HERO_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [items.length, paused, onScreen, index]);

  if (!active) return null;
  return (
    <section
      className="hero-carousel"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      // A finger on the slides should stop the rotation until it lifts.
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
      onTouchCancel={() => setPaused(false)}
    >
      <div
        className="hero-track"
        ref={track}
        onScroll={readIndex}
        {...(onMenu ? hold : {})}
      >
        {items.map((item) => {
          const artwork = item.background || item.banner || item.poster;
          return (
            <article
              key={`${item.type}:${item.id}`}
              className="hero"
              style={
                artwork
                  ? {
                      backgroundImage: `linear-gradient(90deg, rgba(5,7,9,.98) 0%, rgba(5,7,9,.67) 46%, rgba(5,7,9,.12) 100%), linear-gradient(0deg, #080a0d 0%, transparent 55%), url("${artwork.replace(/"/g, "%22")}")`,
                    }
                  : undefined
              }
            >
              <div className="hero-copy">
                {item.logo ? (
                  <img src={item.logo} className="title-logo" alt={item.name} />
                ) : (
                  <h1>{item.name}</h1>
                )}
                <div className="hero-meta home-hero-meta">
                  <span>{item.type === "series" ? "Series" : "Movie"}</span>
                  {item.genres[0] && <span>{item.genres[0]}</span>}
                  {item.releaseInfo && <span>{item.releaseInfo}</span>}
                </div>
                <button className="primary" onClick={() => onOpen(item)}>
                  View details
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {/* Outside the scroller, so they stay put while it moves. */}
      {items.length > 1 && (
        <div className="hero-dots" role="tablist" aria-label="Featured titles">
          {items.map((item, dot) => (
            <button
              key={`${item.type}:${item.id}`}
              role="tab"
              aria-selected={dot === index}
              aria-label={item.name}
              className={dot === index ? "active" : undefined}
              onClick={() => scrollTo(dot)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
