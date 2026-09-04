import { t } from "../lib/i18n.ts";
import { Check, Download, Play, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { platform } from "../platform/index.ts";
import type { DownloadItem, DownloadsApi } from "../platform/types.ts";
import type { Meta, Stream, Video } from "../types";

/**
 * Titles saved to watch without a network.
 *
 * Only built where `platform.downloads` is, which is why the capability is
 * passed in rather than read from the platform here: a caller that has checked
 * for it hands it over, and this file never has to ask which shell it is in.
 *
 * A browser is not one of them, and not for want of trying — it cannot write a
 * file it can later play back under its own path, cannot resume a transfer
 * across a restart, and cannot attach the request headers many sources need.
 */
export function Downloads({
  downloads,
  onPlay,
}: {
  downloads: DownloadsApi;
  onPlay(stream: Stream, meta: Meta, video?: Video): void;
}) {
  const [snapshot, setSnapshot] = useState<Awaited<
    ReturnType<DownloadsApi["list"]>
  > | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [artwork, setArtwork] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [speeds, setSpeeds] = useState<Record<string, number>>({});
  // Rates are measured here rather than reported: the queue knows how many
  // bytes have landed, not how fast they are landing.
  const samples = useRef(
    new Map<string, { bytes: number; at: number; speed: number }>(),
  );

  const refresh = useCallback(() => {
    downloads
      .list()
      .then((value) => {
        const at = performance.now();
        const next: Record<string, number> = {};
        const active = new Set<string>();
        for (const item of value.items) {
          if (item.status !== "downloading") continue;
          active.add(item.id);
          const previous = samples.current.get(item.id);
          let speed = previous?.speed ?? 0;
          if (previous && at > previous.at && item.bytesDownloaded >= previous.bytes) {
            const measured =
              ((item.bytesDownloaded - previous.bytes) * 1000) / (at - previous.at);
            // Smoothed, because a raw sample swings wildly enough to be
            // unreadable — the number is for a person, not a graph.
            speed = previous.speed > 0 ? previous.speed * 0.65 + measured * 0.35 : measured;
          }
          samples.current.set(item.id, { bytes: item.bytesDownloaded, at, speed });
          next[item.id] = speed;
        }
        for (const id of samples.current.keys())
          if (!active.has(id)) samples.current.delete(id);
        setSpeeds(next);
        setSnapshot(value);
        setError(null);
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : "Downloads could not be loaded",
        ),
      );
  }, [downloads]);

  const busy = snapshot?.items.some(
    (item) => item.status === "downloading" || item.status === "queued",
  );

  useEffect(() => {
    refresh();
    // Often while something is moving, rarely while nothing is.
    const timer = window.setInterval(refresh, busy ? 750 : 3000);
    return () => window.clearInterval(timer);
  }, [refresh, busy]);

  useEffect(() => {
    for (const item of snapshot?.items ?? []) {
      if (!item.artworkCached || artwork[item.id]) continue;
      downloads
        .artwork(item.id)
        .then((image) => {
          if (image) setArtwork((current) => ({ ...current, [item.id]: image }));
        })
        .catch(() => undefined);
    }
  }, [snapshot?.items, artwork, downloads]);

  const visible = useMemo(
    () =>
      (snapshot?.items ?? []).filter((item) =>
        filter === "all"
          ? true
          : filter === "active"
            ? item.status === "queued" || item.status === "downloading"
            : item.status === "completed",
      ),
    [snapshot?.items, filter],
  );

  async function act(run: Promise<void>) {
    try {
      await run;
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Download action failed");
    }
  }

  /**
   * A saved file, dressed as the source it came from.
   *
   * The player takes a stream and a title; offline playback is the same act
   * with a local address, so nothing below the player has to know the
   * difference.
   */
  function play(item: DownloadItem) {
    if (!item.playUrl) return;
    const stream: Stream = {
      name: "Offline download",
      title: item.title,
      description: item.sourceName,
      url: item.playUrl,
      addonName: "Downloads",
      behaviorHints: { notWebReady: false, filename: item.filePath },
    };
    const meta = {
      id: item.contentId,
      type: item.contentType,
      name: item.showName || item.title,
    } as Meta;
    const video =
      item.season != null && item.episode != null
        ? ({
            id: item.videoId,
            title: item.title,
            season: item.season,
            episode: item.episode,
          } as Video)
        : undefined;
    // The shared Player performs the capability handoff. Going through it in
    // both clients keeps the controls, progress identity and Back behaviour;
    // the desktop then gives this local URL to libmpv rather than <video>.
    onPlay(stream, meta, video);
  }

  return (
    <div className="downloads-page">
      <header className="downloads-head">
        <div>
          <h1>Downloads</h1>
          <span>{snapshot?.root || "Loading download storage…"}</span>
        </div>
        <button type="button" onClick={() => void downloads.openFolder()}>
          Open folder
        </button>
      </header>
      <div className="downloads-tabs">
        {(["all", "active", "completed"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={filter === key ? "active" : undefined}
            onClick={() => setFilter(key)}
          >
            {key === "all" ? "All" : key === "active" ? "Downloading" : "Downloaded"}
          </button>
        ))}
      </div>
      {error && <div className="inline-error">{error}</div>}
      {!snapshot ? (
        <div className="downloads-empty">
          <strong>Loading downloads</strong>
        </div>
      ) : visible.length === 0 ? (
        <div className="downloads-empty">
          <Download aria-hidden="true" />
          <strong>No {filter === "all" ? "downloads" : filter} yet</strong>
          <span>Save a source from its details page to watch it offline.</span>
        </div>
      ) : (
        <div className="download-list">
          {visible.map((item) => (
            <Row
              key={item.id}
              item={item}
              image={artwork[item.id]}
              speed={speeds[item.id]}
              onPlay={() => play(item)}
              onCancel={() => void act(downloads.cancel(item.id))}
              onRetry={() => void act(downloads.retry(item.id))}
              onRemove={() => void act(downloads.remove(item.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  item,
  image,
  speed,
  onPlay,
  onCancel,
  onRetry,
  onRemove,
}: {
  item: DownloadItem;
  image?: string;
  speed?: number;
  onPlay(): void;
  onCancel(): void;
  onRetry(): void;
  onRemove(): void;
}) {
  const percent = item.totalBytes
    ? Math.min(100, (item.bytesDownloaded / item.totalBytes) * 100)
    : 0;
  const waiting = item.status === "queued" || item.status === "downloading";
  const label =
    item.season != null && item.episode != null
      ? `S${item.season} E${item.episode}`
      : item.contentType;

  return (
    <article className="download-row">
      <div className="download-art">{image && <img src={image} alt="" />}</div>
      <div className="download-copy">
        <small>
          {label} · {item.status}
        </small>
        <h2>{item.showName || item.title}</h2>
        {item.showName && <strong>{item.title}</strong>}
        <span>{item.sourceName || item.filePath || "Nuvio download"}</span>
        {waiting && (
          <div className="download-progress">
            <i>
              <b style={{ width: `${percent}%` }} />
            </i>
            <span>
              {item.status === "queued"
                ? "Queued"
                : `${bytes(item.bytesDownloaded)}${
                    item.totalBytes ? ` of ${bytes(item.totalBytes)}` : ""
                  } · ${speed && speed > 0 ? `${bytes(speed)}/s` : "Measuring…"}`}
            </span>
          </div>
        )}
        {item.error && <em>{item.error}</em>}
        {item.skipSegments.length > 0 && (
          <label>
            <Check aria-hidden="true" />
            Skip markers saved for offline
          </label>
        )}
      </div>
      <div className="download-actions">
        {item.status === "completed" && (
          <button type="button" onClick={onPlay}>
            <Play aria-hidden="true" />
            Play
          </button>
        )}
        {waiting && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        {(item.status === "failed" || item.status === "cancelled") && (
          <button type="button" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            Retry
          </button>
        )}
        {!waiting && (
          <button
            type="button"
            aria-label={t("downloads.remove")}
            title="Remove download"
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  );
}

/** One formatter for sizes and rates: a rate is a size with "/s" after it. */
function bytes(value: number) {
  if (value >= 1_073_741_824) return `${(value / 1_073_741_824).toFixed(1)} GB`;
  if (value >= 1_048_576) return `${(value / 1_048_576).toFixed(0)} MB`;
  return `${Math.max(0, Math.round(value / 1024))} KB`;
}

/** Absent on the web, so the nav entry and the route are absent with it. */
export const downloadsCapability = platform.downloads;
