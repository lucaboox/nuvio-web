import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import type { DownloadsApi, DownloadsSnapshot } from "../platform/types.ts";

/**
 * Where downloads are kept, and moving them somewhere else.
 *
 * Only built where `platform.downloads` is — a browser has no folder to name —
 * so the capability arrives as a prop and this file never asks which shell it
 * is in.
 */
export function DownloadSettings({ downloads }: { downloads: DownloadsApi }) {
  const [snapshot, setSnapshot] = useState<DownloadsSnapshot | null>(null);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(() => {
    downloads
      .list()
      .then((value) => {
        setSnapshot(value);
        setChosen((current) => current || value.root);
      })
      .catch((reason: unknown) =>
        setMessage(
          reason instanceof Error
            ? reason.message
            : "Download settings could not be loaded",
        ),
      );
  }, [downloads]);
  useEffect(refresh, [refresh]);

  const active =
    snapshot?.items.filter(
      (item) => item.status === "queued" || item.status === "downloading",
    ).length ?? 0;
  const complete =
    snapshot?.items.filter((item) => item.status === "completed").length ?? 0;
  const moved = !!chosen && chosen !== snapshot?.root;

  async function move() {
    // Files are copied and the old ones removed; interrupting that halfway
    // would leave a download the queue can no longer find.
    if (!moved || active > 0) return;
    setBusy(true);
    setMessage("");
    try {
      await downloads.moveStorage(chosen);
      setMessage("Downloads moved.");
      refresh();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Downloads could not be moved",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setting-card">
      <header>
        <h2>Download location</h2>
        <span>On this computer</span>
      </header>
      <p className="setting-lede">
        Video files, artwork and offline skip markers are kept here. Moving the
        folder carries everything already downloaded with it.
      </p>
      <label className="download-location">
        <span>Folder</span>
        <div>
          <input readOnly value={chosen || snapshot?.root || "Loading…"} />
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              void downloads
                .chooseFolder(chosen || snapshot?.root)
                .then((path) => {
                  if (path) setChosen(path);
                })
                .catch(() => undefined);
            }}
          >
            <FolderOpen /> Choose
          </button>
        </div>
      </label>
      <div className="download-storage-summary">
        <span>{complete} downloaded</span>
        <span>{active} active</span>
      </div>
      <button
        type="button"
        className="primary"
        disabled={busy || !moved || active > 0}
        onClick={() => void move()}
      >
        {busy ? <Loader2 className="crate-spinner" /> : <FolderOpen />}
        Move downloads
      </button>
      {active > 0 && moved && (
        <p className="setting-warning">
          Finish or cancel the active downloads before moving the folder.
        </p>
      )}
      {message && <div className="inline-note">{message}</div>}
    </div>
  );
}
