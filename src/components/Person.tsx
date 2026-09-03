import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSwipeBack } from "../lib/useSwipeBack";
import {
  lifespan,
  loadPersonDetail,
  personSections,
  type PersonDetail,
} from "../lib/person";
import type { MetadataEnrichmentConfig } from "../lib/metadataEnrichment";
import { MediaRow } from "./Media";
import type { Meta, Person as PersonSeed } from "../types";
import type { WatchIndex } from "../lib/progress";

/**
 * An actor or director, and everything they have been in.
 *
 * Opened from a cast card, which already carries the TMDB id, the name and the
 * photo — so the header is filled in from the seed on the first frame and the
 * page never starts as an empty box. What arrives later is the biography and
 * the filmography, and only those parts show a loading state.
 */
export function PersonPage({
  seed,
  index,
  config,
  onBack,
  onOpen,
}: {
  seed: PersonSeed & { tmdbId: number };
  index: WatchIndex;
  config: MetadataEnrichmentConfig["tmdb"];
  onBack(): void;
  onOpen(item: Meta): void;
}) {
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The same gesture the details page uses, on the same kind of scroller, so
  // going back from an actor feels like going back from anything else.
  const swipeRef = useSwipeBack<HTMLDivElement>(onBack);

  useEffect(() => {
    let live = true;
    setPerson(null);
    setError(null);
    loadPersonDetail(seed.tmdbId, config, seed.role)
      .then((result) => live && setPerson(result))
      .catch((reason) => {
        if (!live) return;
        setError(
          reason instanceof Error ? reason.message : "Could not load this person.",
        );
      });
    return () => {
      live = false;
    };
    // The config is rebuilt on every settings change; only the parts this page
    // reads should re-fetch it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed.tmdbId, seed.role, config.apiKey, config.language, config.enabled]);

  const sections = useMemo(
    () => (person ? personSections(person) : []),
    [person],
  );
  const life = person ? lifespan(person) : "";
  const photo = person?.profilePhoto || seed.photo;

  return (
    // The overlay is this component's own root rather than a wrapper in App,
    // because the swipe listeners have to sit on the scrolling node — exactly
    // where `.detail-view` puts them.
    <div className="person-view" ref={swipeRef}>
      <button className="circle-button back" onClick={onBack} aria-label="Back">
        <ArrowLeft />
      </button>
      <section className="person-page">
      <header className="person-identity">
        {photo ? (
          <img src={photo} alt="" />
        ) : (
          <span className="person-photo-fallback">{seed.name.slice(0, 1)}</span>
        )}
        <div>
          <span className="eyebrow">PERSON</span>
          <h1>{person?.name || seed.name}</h1>
          {(person?.knownFor || seed.role) && (
            <p className="person-role">{person?.knownFor || seed.role}</p>
          )}
          {(life || person?.placeOfBirth) && (
            <div className="person-facts">
              {life && <span>{life}</span>}
              {person?.placeOfBirth && <span>{person.placeOfBirth}</span>}
            </div>
          )}
          {person?.biography && (
            <p className="person-biography">{person.biography}</p>
          )}
        </div>
      </header>

      {error && <div className="person-note is-error">{error}</div>}
      {!person && !error && (
        <div className="person-note">Loading filmography…</div>
      )}
      {person && sections.length === 0 && !error && (
        <div className="person-note">
          No film or television credits were found.
        </div>
      )}
        {sections.map((section) => (
          <MediaRow
            key={section.key}
            section={section}
            index={index}
            onOpen={onOpen}
          />
        ))}
      </section>
    </div>
  );
}
