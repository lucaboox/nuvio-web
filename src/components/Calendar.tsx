import { t } from "../lib/i18n.ts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { InstalledAddon, LibraryItem, Meta } from "../types";
import { resolveMeta } from "../lib/addons";
import {
  enrichMetadata,
  type MetadataEnrichmentConfig,
} from "../lib/metadataEnrichment";
import {
  readCalendarMetas,
  writeCalendarMetas,
} from "../lib/calendarCache";
import {
  buildReleaseCalendar,
  localReleaseDate,
  monthCells,
  monthPrefix,
  type ReleaseCalendarItem,
} from "../lib/releaseCalendar";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthTitle = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const monthOnly = new Intl.DateTimeFormat(undefined, { month: "long" });
const monthShort = new Intl.DateTimeFormat(undefined, { month: "short" });
const sheetDayTitle = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const dayTitle = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function todayIso() {
  return localReleaseDate(new Date().toISOString())!;
}

function releaseLabel(item: ReleaseCalendarItem) {
  if (!item.video) return "Movie release";
  const episode = [
    item.video.season == null ? "" : `S${item.video.season}`,
    item.video.episode == null ? "" : `E${item.video.episode}`,
  ].join("");
  return `${episode || "Episode"}${item.video.title ? ` · ${item.video.title}` : ""}`;
}

/** Titles resolved at once. Each one is a request, so this bounds the fan-out. */
const RESOLVE_CONCURRENCY = 8;
/** How often partial results are published, so a big library still renders. */
const PROGRESS_INTERVAL_MS = 250;

/**
 * Resolves library metadata, reporting what it has as it goes.
 *
 * A month cannot be fetched on its own: knowing whether a series has an
 * episode in March means having its video list, which means resolving it. So
 * the cost is the library, not the month — and the answer is to show the month
 * filling in rather than to wait for the whole library first.
 *
 * Workers pull from a shared cursor instead of running fixed batches. Batching
 * made every four titles wait for the slowest of the four, so one slow addon
 * response stalled everything behind it.
 */
async function resolveLibrary(
  seeds: LibraryItem[],
  addons: InstalledAddon[],
  enrichment: MetadataEnrichmentConfig,
  cache: Map<string, Meta>,
  isCurrent: () => boolean,
  onProgress?: (metas: Meta[]) => void,
  /** Re-resolves titles already cached, for refreshing a stored set. */
  refresh = false,
): Promise<Meta[]> {
  const collect = () =>
    seeds
      .map((seed) => cache.get(`${seed.type}:${seed.id}`))
      .filter((meta): meta is Meta => !!meta);

  const unresolved = refresh
    ? seeds
    : seeds.filter((seed) => !cache.has(`${seed.type}:${seed.id}`));
  if (!unresolved.length) return collect();

  let cursor = 0;
  let lastPublished = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(RESOLVE_CONCURRENCY, unresolved.length) },
      async () => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= unresolved.length) return;
          if (!isCurrent()) return;
          const seed = unresolved[index]!;
          const resolved = await resolveMeta(seed, addons).catch(() => seed);
          const enriched = await enrichMetadata(resolved, enrichment).catch(
            () => resolved,
          );
          // Cached before the staleness check, not after: this metadata is
          // valid for every month, so swiping away while it was in flight must
          // not throw the request away and make the next month pay for it again.
          cache.set(`${seed.type}:${seed.id}`, enriched);
          if (!isCurrent()) return;
          // Rate limited: publishing per title would re-render the grid once
          // per request for no visible gain.
          const now = Date.now();
          if (onProgress && now - lastPublished >= PROGRESS_INTERVAL_MS) {
            lastPublished = now;
            onProgress(collect());
          }
        }
      },
    ),
  );
  return isCurrent() ? collect() : [];
}

export function CalendarView({
  items,
  addons,
  enrichment,
  scope,
  onOpen,
}: {
  items: LibraryItem[];
  addons: InstalledAddon[];
  enrichment: MetadataEnrichmentConfig;
  scope: string;
  onOpen(meta: Meta): void;
}) {
  const now = new Date();
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const [monthReleases, setMonthReleases] = useState<ReleaseCalendarItem[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [loading, setLoading] = useState(false);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [datasetRevision, setDatasetRevision] = useState(0);
  const [monthDirection, setMonthDirection] = useState<"next" | "previous">(
    "next",
  );
  const [monthDragX, setMonthDragX] = useState(0);
  const [monthDragging, setMonthDragging] = useState(false);
  const [sheetDragY, setSheetDragY] = useState(0);
  const [sheetDragging, setSheetDragging] = useState(false);
  /** Null until storage has been consulted, so nothing resolves before then. */
  const [hydration, setHydration] = useState<"pending" | "done">("pending");
  const needsRefresh = useRef(true);
  const metadataCache = useRef(new Map<string, Meta>());
  const monthCache = useRef(new Map<string, ReleaseCalendarItem[]>());
  const loadGeneration = useRef(0);
  const suppressDayClick = useRef(false);
  const monthGesture = useRef({
    active: false,
    pointerId: -1,
    x: 0,
    y: 0,
  });
  const sheetGesture = useRef({
    active: false,
    pointerId: -1,
    x: 0,
    y: 0,
    at: 0,
  });
  const identity = items.map((item) => `${item.type}:${item.id}`).join("|");
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const prefix = monthPrefix(year, month);

  useEffect(() => {
    let active = true;
    metadataCache.current.clear();
    monthCache.current.clear();
    loadGeneration.current += 1;
    setMonthReleases([]);
    setHydration("pending");
    // Seeded from storage before anything is fetched, so a return visit draws
    // the month immediately instead of after the library resolves again.
    void readCalendarMetas(scope).then((cached) => {
      if (!active) return;
      if (cached) {
        for (const meta of cached.metas)
          metadataCache.current.set(`${meta.type}:${meta.id}`, meta);
      }
      needsRefresh.current = !cached || cached.stale;
      setHydration("done");
      setDatasetRevision((current) => current + 1);
    });
    return () => {
      active = false;
    };
  }, [identity, scope, addons, enrichment]);

  useEffect(() => {
    // Storage is consulted first; resolving before that would race the seed and
    // refetch a library that was already on disk.
    if (hydration !== "done") return;
    const generation = ++loadGeneration.current;
    const cached = monthCache.current.get(prefix);
    setDaySheetOpen(false);
    setMonthDragX(0);
    const forThisMonth = (metas: Meta[]) =>
      buildReleaseCalendar(metas).filter((item) =>
        item.date.startsWith(`${prefix}-`),
      );

    if (cached) {
      setMonthReleases(cached);
      setLoading(false);
      return;
    }
    if (!items.length) {
      setMonthReleases([]);
      setLoading(false);
      return;
    }

    // Whatever the seed already covers is drawn now, before any request. On a
    // return visit that is the whole month, and the page is simply there.
    const seeded = forThisMonth(
      items
        .map((item) => metadataCache.current.get(`${item.type}:${item.id}`))
        .filter((meta): meta is Meta => !!meta),
    );
    setMonthReleases(seeded);

    const complete = metadataCache.current.size >= items.length;
    if (complete && !needsRefresh.current) {
      monthCache.current.set(prefix, seeded);
      setLoading(false);
      return;
    }
    // A refresh runs behind what is already drawn, so a stale set never shows
    // a spinner over a perfectly usable month.
    setLoading(!seeded.length);
    void resolveLibrary(
      items,
      addons,
      enrichment,
      metadataCache.current,
      () => generation === loadGeneration.current,
      // Partial results are shown as they arrive. They are deliberately not
      // cached: a half-resolved month must never be mistaken for a finished one.
      (metas) => {
        if (generation !== loadGeneration.current) return;
        setMonthReleases(forThisMonth(metas));
      },
      complete && needsRefresh.current,
    )
      .then((metas) => {
        if (generation !== loadGeneration.current) return;
        const releases = forThisMonth(metas);
        monthCache.current.set(prefix, releases);
        setMonthReleases(releases);
        needsRefresh.current = false;
        // Stored only once the library is fully resolved, so a partial set can
        // never be served as a complete one on the next visit.
        if (metas.length >= items.length) void writeCalendarMetas(scope, metas);
      })
      .finally(() => {
        if (generation === loadGeneration.current) setLoading(false);
      });
    return () => {
      if (generation === loadGeneration.current) loadGeneration.current += 1;
    };
  }, [prefix, datasetRevision, hydration]);

  const releasesByDate = useMemo(() => {
    const grouped = new Map<string, ReleaseCalendarItem[]>();
    for (const item of monthReleases) {
      const current = grouped.get(item.date) ?? [];
      current.push(item);
      grouped.set(item.date, current);
    }
    return grouped;
  }, [monthReleases]);
  const cells = useMemo(() => monthCells(year, month, true), [year, month]);
  const today = todayIso();

  useEffect(() => {
    if (!daySheetOpen || !window.matchMedia("(max-width: 760px)").matches)
      return;
    const previous = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDaySheetOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [daySheetOpen]);

  useEffect(() => {
    const currentMonth = today.startsWith(`${prefix}-`);
    const firstRelease = monthReleases[0]?.date;
    setSelectedDate((current) =>
      current.startsWith(`${prefix}-`)
        ? current
        : currentMonth
          ? today
          : firstRelease ?? `${prefix}-01`,
    );
  }, [prefix, today, monthReleases]);

  const selected = releasesByDate.get(selectedDate) ?? [];
  const changeMonth = (offset: number) => {
    setMonthDirection(offset > 0 ? "next" : "previous");
    setDaySheetOpen(false);
    setVisibleMonth((current) =>
      new Date(current.getFullYear(), current.getMonth() + offset, 1),
    );
  };
  const goToday = () => {
    const current = new Date();
    setVisibleMonth(new Date(current.getFullYear(), current.getMonth(), 1));
    setSelectedDate(todayIso());
    setDaySheetOpen(false);
  };
  const openRelease = (item: ReleaseCalendarItem) => {
    setDaySheetOpen(false);
    onOpen({
      ...item.meta,
      selectedVideoId: item.video?.id,
    });
  };
  const previousMonth = new Date(year, month - 1, 1);
  const nextMonth = new Date(year, month + 1, 1);

  const finishMonthGesture = (
    pointerId: number,
    clientX: number,
    clientY: number,
  ) => {
    const gesture = monthGesture.current;
    if (!gesture.active || gesture.pointerId !== pointerId) return;
    gesture.active = false;
    const deltaX = clientX - gesture.x;
    const deltaY = clientY - gesture.y;
    setMonthDragging(false);
    setMonthDragX(0);
    if (Math.abs(deltaX) >= 52 && Math.abs(deltaX) > Math.abs(deltaY) * 1.12) {
      suppressDayClick.current = true;
      changeMonth(deltaX < 0 ? 1 : -1);
      window.setTimeout(() => {
        suppressDayClick.current = false;
      }, 80);
    }
  };

  const finishSheetGesture = (pointerId: number, clientY: number) => {
    const gesture = sheetGesture.current;
    if (!gesture.active || gesture.pointerId !== pointerId) return;
    gesture.active = false;
    const distance = Math.max(0, clientY - gesture.y);
    const velocity = distance / Math.max(1, performance.now() - gesture.at);
    setSheetDragging(false);
    if (distance >= 82 || velocity > 0.62) {
      setDaySheetOpen(false);
      setSheetDragY(0);
    } else {
      setSheetDragY(0);
    }
  };

  return (
    <div className="calendar-page">
      <header className="calendar-page-title">
        <div>
          <span>MY LIBRARY</span>
          <h1>Release calendar</h1>
          <p>Movies and new episodes from titles saved to this profile.</p>
        </div>
      </header>
      <div className="calendar-toolbar">
        <div className="calendar-month-nav">
        <button className="calendar-month-step previous" aria-label="Previous month" onClick={() => changeMonth(-1)}>
          <ChevronLeft />
          <span>{monthShort.format(previousMonth)}</span>
        </button>
        <h2>
          <small>{year}</small>
          <span>{monthOnly.format(visibleMonth)}</span>
        </h2>
        <button className="calendar-today" onClick={goToday}>Today</button>
        <button className="calendar-month-step next" aria-label="Next month" onClick={() => changeMonth(1)}>
          <span>{monthShort.format(nextMonth)}</span>
          <ChevronRight />
        </button>
        </div>
      </div>
      <div className="calendar-layout">
        <section
          key={prefix}
          className={`calendar-board calendar-month-${monthDirection}${monthDragging ? " is-dragging" : ""}`}
          aria-label={monthTitle.format(visibleMonth)}
          style={{
            "--calendar-drag-x": `${monthDragX}px`,
          } as CSSProperties}
          onPointerDown={(event) => {
            // Touch only. The board captures the pointer to track a swipe, and
            // a captured pointer delivers its click to the capturing element —
            // so on a mouse this ate every click meant for a day cell. There
            // are month arrows for pointer devices anyway.
            if (event.pointerType === "mouse") return;
            monthGesture.current = {
              active: true,
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const gesture = monthGesture.current;
            if (!gesture.active || gesture.pointerId !== event.pointerId) return;
            const x = event.clientX - gesture.x;
            const y = event.clientY - gesture.y;
            if (!monthDragging && Math.abs(x) < 7) return;
            if (!monthDragging && Math.abs(x) <= Math.abs(y)) return;
            setMonthDragging(true);
            setMonthDragX(Math.max(-140, Math.min(140, x)));
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            finishMonthGesture(event.pointerId, event.clientX, event.clientY);
          }}
          onPointerCancel={(event) => {
            monthGesture.current.active = false;
            setMonthDragging(false);
            setMonthDragX(0);
          }}
        >
          {loading && !monthReleases.length ? (
            <div className="calendar-month-loading" role="status" aria-live="polite">
              <i />
              <span>Loading {monthOnly.format(visibleMonth)}</span>
            </div>
          ) : <>
            <div className="calendar-weekdays">
              {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="calendar-grid">
              {cells.map((day, index) => {
              if (day == null)
                return <span className="calendar-cell empty" key={`empty-${index}`} />;
              const date = `${prefix}-${String(day).padStart(2, "0")}`;
              const dayItems = releasesByDate.get(date) ?? [];
              return (
                <button
                  key={date}
                  className={[
                    "calendar-cell",
                    date === today ? "today" : "",
                    date === selectedDate ? "selected" : "",
                    dayItems.length ? "has-releases" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    if (suppressDayClick.current) return;
                    setSelectedDate(date);
                    setDaySheetOpen(true);
                  }}
                >
                  <span className="calendar-day-number">{day}</span>
                  <span
                    className={`calendar-cell-thumbnails${dayItems.length > 1 ? " has-multiple" : ""}`}
                    aria-hidden="true"
                  >
                    {dayItems.slice(0, 2).map((item) => {
                      const artwork = item.meta.poster ?? item.meta.background;
                      return artwork ? <img key={item.key} src={artwork} alt="" loading="lazy" /> : null;
                    })}
                    {dayItems.length > 2 ? <small>+{dayItems.length - 2}</small> : null}
                  </span>
                  {dayItems.length > 0 && <i className="calendar-dot" />}
                </button>
              );
              })}
            </div>
          </>}
        </section>
        <aside className="calendar-agenda">
          <header>
            <span>{selectedDate === today ? "TODAY" : "RELEASES"}</span>
            <h2>{dayTitle.format(new Date(`${selectedDate}T12:00:00`))}</h2>
            <small>{selected.length} {selected.length === 1 ? "release" : "releases"}</small>
          </header>
          <div className="calendar-agenda-list">
            {selected.map((item) => (
              <button
                key={item.key}
                onClick={() => openRelease(item)}
              >
                <span className="calendar-release-art">
                  {(item.video?.thumbnail ?? item.meta.poster ?? item.meta.background) && (
                    <img
                      src={item.video?.thumbnail ?? item.meta.poster ?? item.meta.background}
                      alt=""
                      loading="lazy"
                    />
                  )}
                </span>
                <span className="calendar-release-copy">
                  <small>{item.kind === "movie" ? "MOVIE" : "NEW EPISODE"}</small>
                  <strong>{item.meta.name}</strong>
                  <span>{releaseLabel(item)}</span>
                </span>
                <ChevronRight className="calendar-open" />
              </button>
            ))}
            {!selected.length && (
              <div className="calendar-empty-day">
                <strong>{t("calendar.noReleases")}</strong>
                <span>{loading ? "Still checking your library…" : "Pick a highlighted day or change the month."}</span>
              </div>
            )}
          </div>
        </aside>
      </div>
      {!loading && !items.length && (
        <div className="calendar-empty-library">
          <strong>Your calendar is empty</strong>
          <span>Add movies or series to your library to track their releases.</span>
        </div>
      )}
      {daySheetOpen && (
        <div
          className="calendar-day-sheet-backdrop"
          role="presentation"
          onClick={() => setDaySheetOpen(false)}
          style={{
            "--calendar-sheet-shade": Math.max(
              0.12,
              0.66 *
                (1 - sheetDragY / Math.max(window.innerHeight * 0.72, 1)),
            ),
          } as CSSProperties}
        >
          <section
            className={`calendar-day-sheet${sheetDragging ? " is-dragging" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={`Releases for ${sheetDayTitle.format(new Date(`${selectedDate}T12:00:00`))}`}
            onClick={(event) => event.stopPropagation()}
            style={{
              "--calendar-sheet-drag-y": `${sheetDragY}px`,
            } as CSSProperties}
          >
            <div
              className="calendar-sheet-grab-zone"
              onPointerDown={(event) => {
                sheetGesture.current = {
                  active: true,
                  pointerId: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  at: performance.now(),
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const gesture = sheetGesture.current;
                if (!gesture.active || gesture.pointerId !== event.pointerId) return;
                const y = Math.max(0, event.clientY - gesture.y);
                if (y > 3) setSheetDragging(true);
                setSheetDragY(y);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
                finishSheetGesture(event.pointerId, event.clientY);
              }}
              onPointerCancel={() => {
                sheetGesture.current.active = false;
                setSheetDragging(false);
                setSheetDragY(0);
              }}
            >
              <span className="calendar-sheet-handle" />
              <header>
                <div>
                  <span>{selectedDate === today ? "TODAY" : "RELEASES"}</span>
                  <h2>{sheetDayTitle.format(new Date(`${selectedDate}T12:00:00`))}</h2>
                </div>
              </header>
            </div>
            <div className="calendar-sheet-list">
              {selected.map((item) => {
                const artwork = item.video?.thumbnail ?? item.meta.poster ?? item.meta.background;
                return (
                  <button key={item.key} onClick={() => openRelease(item)}>
                    <span className="calendar-sheet-art">
                      {artwork && <img src={artwork} alt="" />}
                    </span>
                    <span className="calendar-sheet-copy">
                      <strong>{item.meta.name}</strong>
                      <small>{releaseLabel(item)}</small>
                    </span>
                    <ChevronRight />
                  </button>
                );
              })}
              {!selected.length && (
                <div className="calendar-sheet-empty">
                  <strong>{t("calendar.noReleases")}</strong>
                  <span>Choose a day with artwork to see its releases.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
