import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Package } from "lucide-react";
import { TitleRoulette } from "../App";
import {
  discoverCatalogs,
  loadDiscoverCatalog,
  type DiscoverCatalog,
} from "../lib/addons";
import type { WatchIndex } from "../lib/progress";
import type { InstalledAddon, LibraryItem, Meta } from "../types";

/**
 * The library and the catalogs, dressed as cases to open.
 *
 * Everything here is the ordinary picker with a different way in: a case is a
 * pool of titles with a name and a lid, and opening one rolls it. Nothing about
 * the roll, the ticking or the reveal is duplicated — this decides *what* is
 * being rolled and hands it over.
 */

/** Genres offered as their own cases, where a catalog advertises them. */
const HEADLINE_GENRES = [
  "Horror",
  "Comedy",
  "Action",
  "Thriller",
  "Animation",
  "Documentary",
];

/** How many cases will fetch on arrival. Every one is a request to an addon. */
const PRELOAD_LIMIT = 10;

type Crate = {
  key: string;
  name: string;
  /** The shelf it came from, shown under the name. */
  origin: string;
  /**
   * A hue for the crate, derived from its name so it is stable between visits
   * and different between neighbours. Wearing a colour is most of what makes a
   * case look like a case.
   */
  hue: number;
  /** Present immediately for the library; fetched for a catalog. */
  items?: Meta[];
  catalog?: DiscoverCatalog;
  genre?: string;
};

/** Stable hue from a name — same case, same colour, every time. */
function hueOf(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1)
    hash = (hash * 31 + value.charCodeAt(index)) % 360;
  return hash;
}

export function MemeCases({
  library,
  addons,
  index,
  onOpen,
  onExit,
}: {
  library: LibraryItem[];
  addons: InstalledAddon[];
  index: WatchIndex;
  onOpen(item: Meta): void;
  onExit(): void;
}) {
  const [pools, setPools] = useState<Record<string, Meta[]>>({});
  const [failed, setFailed] = useState<Record<string, true>>({});
  const [opened, setOpened] = useState<string | null>(null);
  const requested = useRef(new Set<string>());

  const crates = useMemo<Crate[]>(() => {
    const movies = library.filter((item) => item.type === "movie");
    const series = library.filter((item) => item.type === "series");
    const result: Crate[] = [];
    if (movies.length)
      result.push({
        key: "lib:movie",
        name: "Your Movies",
        origin: `${movies.length} in your library`,
        hue: hueOf("Your Movies"),
        items: movies,
      });
    if (series.length)
      result.push({
        key: "lib:series",
        name: "Your Series",
        origin: `${series.length} in your library`,
        hue: hueOf("Your Series"),
        items: series,
      });

    const catalogs = discoverCatalogs(addons);
    for (const catalog of catalogs) {
      result.push({
        key: `cat:${catalog.key}`,
        name: catalog.catalogName,
        origin: catalog.addonName,
        hue: hueOf(catalog.catalogName + catalog.addonName),
        catalog,
      });
      // A genre case is the same catalog asked a narrower question, which is
      // where "Horror Popular" comes from rather than a list written by hand.
      for (const genre of catalog.genreOptions)
        if (HEADLINE_GENRES.includes(genre))
          result.push({
            key: `cat:${catalog.key}:${genre}`,
            name: `${genre} ${catalog.catalogName}`,
            origin: catalog.addonName,
            hue: hueOf(genre),
            catalog,
            genre,
          });
    }
    return result;
  }, [library, addons]);

  // Fetched on arrival so the shelf has faces on it, and capped because each
  // one is a request to somebody's addon.
  useEffect(() => {
    for (const crate of crates.slice(0, PRELOAD_LIMIT)) {
      if (!crate.catalog || requested.current.has(crate.key)) continue;
      requested.current.add(crate.key);
      loadDiscoverCatalog(crate.catalog, crate.genre)
        .then((items) => setPools((current) => ({ ...current, [crate.key]: items })))
        .catch(() => setFailed((current) => ({ ...current, [crate.key]: true })));
    }
  }, [crates]);

  const load = useCallback((crate: Crate) => {
    if (!crate.catalog || requested.current.has(crate.key)) return;
    requested.current.add(crate.key);
    loadDiscoverCatalog(crate.catalog, crate.genre)
      .then((items) => setPools((current) => ({ ...current, [crate.key]: items })))
      .catch(() => setFailed((current) => ({ ...current, [crate.key]: true })));
  }, []);

  const poolFor = (crate: Crate) => crate.items ?? pools[crate.key] ?? [];
  const open = crates.find((crate) => crate.key === opened);

  if (open) {
    const items = poolFor(open);
    return (
      <TitleRoulette
        fullPage
        items={items}
        index={index}
        addons={addons}
        showScope={false}
        heading={open.name}
        onClose={() => setOpened(null)}
        onOpen={(item) => {
          setOpened(null);
          onOpen(item);
        }}
      />
    );
  }

  return (
    <div className="crates-page">
      <header className="crates-head">
        <button type="button" className="circle-button" onClick={onExit} aria-label="Back">
          <ArrowLeft />
        </button>
        <div>
          <small>UNBOXING</small>
          <h1>Pick a case</h1>
          <p>Every catalog you have installed, and your library, as something to open.</p>
        </div>
      </header>

      <div className="crate-grid">
        {crates.map((crate) => {
          const pool = poolFor(crate);
          const pending = !crate.items && !pools[crate.key] && !failed[crate.key];
          const thin = !pending && pool.length < 8;
          return (
            <button
              key={crate.key}
              type="button"
              className={`crate${thin ? " thin" : ""}`}
              style={{ ["--crate-hue" as string]: crate.hue }}
              disabled={thin}
              onMouseEnter={() => load(crate)}
              onFocus={() => load(crate)}
              onClick={() => setOpened(crate.key)}
            >
              <span className="crate-lid" aria-hidden="true" />
              <span className="crate-art" aria-hidden="true">
                {/* The case wears the titles inside it. A horror case is made
                    of horror posters, which is a truer picture than any stock
                    image would be — and it costs nothing to fetch. */}
                {pool.slice(0, 4).map((item, position) =>
                  item.poster ? (
                    <img key={`${item.id}:${position}`} src={item.poster} alt="" />
                  ) : (
                    <i key={`${item.id}:${position}`} />
                  ),
                )}
                {pending && <Loader2 className="crate-spinner" />}
                {!pending && pool.length === 0 && <Package />}
              </span>
              <span className="crate-name">
                <strong>{crate.name}</strong>
                <small>
                  {pending
                    ? "Opening the shelf…"
                    : pool.length
                      ? `${pool.length} inside`
                      : failed[crate.key]
                        ? "Would not open"
                        : "Empty"}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
