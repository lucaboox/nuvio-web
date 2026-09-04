import { t } from "../lib/i18n.ts";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  describeCollectionSources,
  loadCollectionSources,
} from "../lib/addons";
import type { WatchIndex } from "../lib/progress";
import { useDragScroll } from "../lib/useDragScroll";
import { useProgressiveList } from "../lib/useProgressiveList";
import type {
  Collection,
  CollectionFolder,
  InstalledAddon,
  Meta,
} from "../types";
import { PosterCard, type MediaMenuHandler } from "./Media";

/**
 * Nuvio's tile shapes. The default is `poster`, not landscape — a folder with
 * no explicit shape is a 2:3 tile like every other card on the page.
 */
function normalizedShape(shape?: string): "poster" | "landscape" | "square" {
  const value = (shape ?? "").toLowerCase();
  if (value === "landscape" || value === "wide") return "landscape";
  if (value === "square") return "square";
  return "poster";
}

/** A collection as a row of folder tiles, the way Nuvio shows them on home. */
export function CollectionRow({
  collection,
  onOpenFolder,
}: {
  collection: Collection;
  onOpenFolder(folder: CollectionFolder): void;
}) {
  const rowRef = useDragScroll<HTMLDivElement>();
  if (collection.folders.length === 0) return null;
  return (
    <section className="media-section">
      <header>
        <div>
          <h2>{collection.title}</h2>
          <span>Collection</span>
        </div>
      </header>
      <div className="media-row folder-row" ref={rowRef}>
        {collection.folders.map((folder) => (
          <button
            key={folder.id}
            className={`folder-tile shape-${normalizedShape(folder.tileShape)}`}
            onClick={() => onOpenFolder(folder)}
          >
            <span className="folder-art">
              {folder.coverImageUrl ? (
                <img src={folder.coverImageUrl} alt="" loading="lazy" />
              ) : (
                <span className="folder-emoji">{folder.coverEmoji || "★"}</span>
              )}
            </span>
            {!folder.hideTitle && <strong>{folder.title}</strong>}
            <small>
              {folder.catalogSources.length} catalog
              {folder.catalogSources.length === 1 ? "" : "s"}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

const ALL_SOURCES = "__all__";
const PAGE_SIZE_GUESS = 20;

/**
 * One folder, with a picker for the catalogs inside it.
 *
 * Nuvio's own default view mode for a collection is TABBED_GRID — one tab per
 * source over a shared grid — so a picker is the native shape here, not
 * stacked rows. A dropdown rather than tabs keeps it usable on a phone and
 * matches the Discover filters.
 */
export function CollectionFolderView({
  folder,
  addons,
  index,
  tmdbApiKey = "",
  onBack,
  onOpen,
  onMenu,
}: {
  folder: CollectionFolder;
  addons: InstalledAddon[];
  index: WatchIndex;
  /** Needed for TMDB-backed sources; addon sources ignore it. */
  tmdbApiKey?: string;
  onBack(): void;
  onOpen(item: Meta): void;
  onMenu?: MediaMenuHandler;
}) {
  const sources = useMemo(
    () => describeCollectionSources(folder, addons),
    [folder, addons],
  );
  const [selected, setSelected] = useState(ALL_SOURCES);
  const [items, setItems] = useState<Meta[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState("");
  const sentinel = useRef<HTMLDivElement | null>(null);
  /** How far through the source list "All" has read, and TMDB's page offset. */
  const sourceCursor = useRef(0);
  const skipCursor = useRef(0);

  const active = useMemo(
    () =>
      selected === ALL_SOURCES
        ? sources.map((entry) => entry.source)
        : sources
            .filter((entry) => entry.key === selected)
            .map((entry) => entry.source),
    [selected, sources],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setExhausted(false);
    setItems([]);
    sourceCursor.current = 0;
    skipCursor.current = 0;
    loadCollectionSources(active, addons, 0, tmdbApiKey, 0)
      .then((result) => {
        if (!live) return;
        sourceCursor.current = result.nextSourceOffset ?? active.length;
        skipCursor.current = result.nextSkip ?? 0;
        setItems(result.items);
        if (result.items.length === 0) {
          setExhausted(true);
          if (result.errors.length) setError(result.errors[0]);
        }
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // The key is a dependency: provider credentials are pulled after the first
    // render, so a folder opened before they land would otherwise sit on "add a
    // TMDB API key" forever, with a key that had since arrived.
  }, [active, addons, tmdbApiKey]);

  const more = useCallback(async () => {
    if (loading || loadingMore || exhausted || items.length === 0) return;
    setLoadingMore(true);
    try {
      // Two ways to advance, and which applies depends on where there is more
      // to read. Sources still unread come first — that is "All" working
      // through a long list — and only once they run out does it ask the
      // sources it already has for their next page.
      const moreSources = sourceCursor.current < active.length;
      const skip = moreSources
        ? 0
        : skipCursor.current ||
          (selected === ALL_SOURCES
            ? Math.ceil(
                items.length / Math.max(active.length, 1) / PAGE_SIZE_GUESS,
              ) * PAGE_SIZE_GUESS
            : items.length);
      const next = await loadCollectionSources(
        active,
        addons,
        skip,
        tmdbApiKey,
        moreSources ? sourceCursor.current : 0,
      );
      sourceCursor.current = next.nextSourceOffset ?? active.length;
      if (next.nextSkip) skipCursor.current = next.nextSkip;
      const known = new Set(items.map((item) => `${item.type}:${item.id}`));
      const additions = next.items.filter(
        (item) => !known.has(`${item.type}:${item.id}`),
      );
      // Nothing new and nowhere left to read means the end. A page that merely
      // repeats itself while sources remain must not stop the run.
      if (additions.length === 0 && sourceCursor.current >= active.length)
        setExhausted(true);
      else if (additions.length) setItems((current) => [...current, ...additions]);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not load more",
      );
      setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  }, [active, addons, exhausted, items, loading, loadingMore, selected]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || exhausted) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) more();
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, exhausted]);

  const { visible } = useProgressiveList(items, {
    resetKey: `${folder.id}:${selected}`,
  });

  return (
    <section className="grid-page">
      <div className="page-head">
        <button
          className="circle-button"
          aria-label="Back"
          title="Back"
          onClick={onBack}
        >
          <ArrowLeft />
        </button>
        <div>
          <span className="eyebrow">COLLECTION</span>
          <h1>{folder.title}</h1>
          <p>
            {loading
              ? "Loading catalogs…"
              : `${items.length} titles · ${sources.length} catalog${
                  sources.length === 1 ? "" : "s"
                }`}
          </p>
        </div>
      </div>

      {sources.length > 1 && (
        <div className="discover-filters">
          <label>
            <span>Catalog</span>
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value={ALL_SOURCES}>All catalogs</option>
              {sources.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {error && <div className="notice error">{error}</div>}

      {!loading && items.length === 0 ? (
        <div className="empty-state">
          <strong>{t("common.nothingReturned")}</strong>
          <span>These catalogs produced no titles.</span>
        </div>
      ) : (
        <div className="poster-grid">
          {visible.map((item) => (
            <PosterCard
              key={`${item.type}:${item.id}`}
              item={item}
              index={index}
              onOpen={onOpen}
              onMenu={onMenu}
            />
          ))}
        </div>
      )}
      {!exhausted && <div ref={sentinel} className="grid-sentinel" />}
      {loadingMore && (
        <div className="grid-more" role="status">
          <i className="mini-spinner" />
          Loading more…
        </div>
      )}
    </section>
  );
}
