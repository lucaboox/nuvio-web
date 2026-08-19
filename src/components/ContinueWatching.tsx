import type { ContinueCard } from "../lib/progress";
import { progressPercent, remainingLabel } from "../lib/progress";
import type { ContinueWatchingSettings } from "../lib/webSettings";
import { useDragScroll } from "../lib/useDragScroll";
import { useLongPress } from "../lib/useLongPress";

const futureNextUp = (card: ContinueCard) => {
  if (!card.nextUp || !card.video?.released) return false;
  const released = new Date(card.video.released).getTime();
  return Number.isFinite(released) && released > Date.now();
};

function artworkFor(card: ContinueCard, settings: ContinueWatchingSettings) {
  if (settings.style === "Poster")
    return (
      card.item.poster ||
      card.item.background ||
      card.item.banner ||
      (settings.useEpisodeThumbnails ? card.video?.thumbnail : undefined)
    );
  if (settings.useEpisodeThumbnails)
    return (
      card.video?.thumbnail ||
      card.item.background ||
      card.item.banner ||
      card.item.poster
    );
  return (
    card.item.background ||
    card.item.banner ||
    card.item.poster ||
    card.video?.thumbnail
  );
}

function ContinueCardView({
  card,
  settings,
  onOpen,
  onMenu,
}: {
  card: ContinueCard;
  settings: ContinueWatchingSettings;
  /**
   * The whole card, not just its title. Continuing needs to know which episode
   * and where in it — handed only the title, the caller can do no more than
   * open the page, which is what tapping one of these used to do.
   */
  onOpen(card: ContinueCard): void;
  onMenu?(card: ContinueCard, x: number, y: number): void;
}) {
  const artwork = artworkFor(card, settings);
  const progress = progressPercent(card);
  const blur =
    settings.blurNextUp && settings.useEpisodeThumbnails && card.nextUp;
  const hold = useLongPress((x, y) => onMenu?.(card, x, y));
  return (
    <button
      className={`continue-card style-${settings.style.toLowerCase()}`}
      onClick={() => {
        if (!hold.consumedTap()) onOpen(card);
      }}
      {...(onMenu ? hold : {})}
    >
      <span className="continue-art">
        <span
          className={`continue-image${blur ? " is-blurred" : ""}`}
          style={
            artwork
              ? { backgroundImage: `url("${artwork.replace(/"/g, "%22")}")` }
              : undefined
          }
        />
        <i className="continue-badge">
          {card.nextUp ? "Next up" : remainingLabel(card.progress)}
        </i>
        <span className="continue-copy">
          {card.video?.season != null && card.video?.episode != null && (
            <small>S{card.video.season} E{card.video.episode}</small>
          )}
          <strong>{card.item.name}</strong>
          {card.video?.title && <em>{card.video.title}</em>}
        </span>
        {progress > 0 && (
          <span className="continue-progress">
            <b style={{ width: `${progress}%` }} />
          </span>
        )}
      </span>
    </button>
  );
}

function ContinueRow({
  title,
  cards,
  settings,
  onOpen,
  onMenu,
}: {
  title: string;
  cards: ContinueCard[];
  settings: ContinueWatchingSettings;
  /**
   * The whole card, not just its title. Continuing needs to know which episode
   * and where in it — handed only the title, the caller can do no more than
   * open the page, which is what tapping one of these used to do.
   */
  onOpen(card: ContinueCard): void;
  onMenu?(card: ContinueCard, x: number, y: number): void;
}) {
  const rowRef = useDragScroll<HTMLDivElement>();
  if (!cards.length) return null;
  return (
    <section className="media-section continue-section">
      <header>
        <h2>{title}</h2>
      </header>
      <div className="continue-row" ref={rowRef}>
        {cards.map((card) => (
          <ContinueCardView
            key={`${card.item.id}:${card.video?.id || card.progress?.videoId || "next"}`}
            card={card}
            settings={settings}
            onOpen={onOpen}
            onMenu={onMenu}
          />
        ))}
      </div>
    </section>
  );
}

export function ContinueWatching({
  cards,
  settings,
  onOpen,
  onMenu,
}: {
  cards: ContinueCard[];
  settings: ContinueWatchingSettings;
  /**
   * The whole card, not just its title. Continuing needs to know which episode
   * and where in it — handed only the title, the caller can do no more than
   * open the page, which is what tapping one of these used to do.
   */
  onOpen(card: ContinueCard): void;
  onMenu?(card: ContinueCard, x: number, y: number): void;
}) {
  if (!settings.isVisible) return null;
  if (settings.sortMode !== "SPLIT_UPCOMING")
    return (
      <ContinueRow
        title="Continue watching"
        cards={cards}
        settings={settings}
        onOpen={onOpen}
        onMenu={onMenu}
      />
    );
  const upcoming = cards.filter(futureNextUp).sort((left, right) => {
    const leftDate = new Date(left.video?.released || "").getTime();
    const rightDate = new Date(right.video?.released || "").getTime();
    return leftDate - rightDate;
  });
  const current = cards.filter((card) => !futureNextUp(card));
  return (
    <>
      <ContinueRow
        title="Continue watching"
        cards={current}
        settings={settings}
        onOpen={onOpen}
        onMenu={onMenu}
      />
      <ContinueRow
        title="Upcoming"
        cards={upcoming}
        settings={settings}
        onOpen={onOpen}
        onMenu={onMenu}
      />
    </>
  );
}
