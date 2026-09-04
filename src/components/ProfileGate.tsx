import { t } from "../lib/i18n.ts";
import { Lock, Plus } from "lucide-react";
import { useState } from "react";
import { MAX_PROFILES } from "../lib/account";
import type { Profile } from "../types";

/** The palette the official clients offer for a new profile's avatar. */
const AVATAR_COLOURS = [
  "#397a63",
  "#3d6ea8",
  "#8a4fa8",
  "#b0533f",
  "#b58a2b",
  "#4a5a6b",
];

/**
 * Who is watching, asked before anything loads.
 *
 * Nothing is fetched until a profile is chosen: addons, library and watch
 * history all belong to a profile, and loading one profile's data only to
 * replace it a moment later is both slower and wrong for a locked profile.
 */
export function ProfileGate({
  profiles,
  remember,
  onRememberChange,
  onSelect,
  onSignOut,
  onCreate,
}: {
  profiles: Profile[];
  remember: boolean;
  onRememberChange(value: boolean): void;
  onSelect(profile: Profile): void;
  onSignOut(): void;
  /** Absent where creating is not offered; the tile goes with it. */
  onCreate?(name: string, avatarColorHex: string): Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [colour, setColour] = useState(AVATAR_COLOURS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="profile-gate">
      <div className="profile-gate-inner">
        <h1>Who's watching?</h1>
        <div className="profile-gate-grid">
          {profiles.map((profile) => (
            <button
              type="button"
              className="profile-gate-card"
              key={profile.profileIndex}
              onClick={() => onSelect(profile)}
            >
              <span
                className="profile-gate-avatar"
                style={{ background: profile.avatarColorHex }}
              >
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="" />
                ) : (
                  profile.name.slice(0, 1).toUpperCase()
                )}
                {/* A lock here saves a tap discovering the profile is locked. */}
                {profile.pinEnabled && (
                  <i className="profile-gate-lock" aria-hidden="true">
                    <Lock />
                  </i>
                )}
              </span>
              <strong>{profile.name}</strong>
              {profile.pinEnabled && <small>{t("common.locked")}</small>}
            </button>
          ))}
          {/* Six is the official clients' ceiling, so the tile goes when it is
              reached rather than offering something the backend refuses. */}
          {onCreate && profiles.length < MAX_PROFILES && (
            <button
              type="button"
              className="profile-gate-card profile-gate-add"
              onClick={() => setCreating(true)}
            >
              <span className="profile-gate-avatar">
                <Plus />
              </span>
              <strong>Add profile</strong>
            </button>
          )}
        </div>

        {creating && onCreate && (
          <form
            className="profile-create"
            onSubmit={async (event) => {
              event.preventDefault();
              const trimmed = name.trim();
              if (!trimmed || busy) return;
              setBusy(true);
              setError("");
              try {
                await onCreate(trimmed, colour);
                setCreating(false);
                setName("");
              } catch (problem) {
                setError(
                  problem instanceof Error
                    ? problem.message
                    : "Could not create the profile.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Profile name
              <input
                autoFocus
                value={name}
                maxLength={24}
                placeholder="Name"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="profile-create-colours">
              {AVATAR_COLOURS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className={swatch === colour ? "is-chosen" : undefined}
                  style={{ background: swatch }}
                  aria-label={`Colour ${swatch}`}
                  onClick={() => setColour(swatch)}
                />
              ))}
            </div>
            {error && <p className="profile-create-error">{error}</p>}
            <div className="profile-create-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setCreating(false);
                  setError("");
                }}
              >
                Cancel
              </button>
              <button className="primary" disabled={!name.trim() || busy}>
                {busy ? "Creating…" : "Create profile"}
              </button>
            </div>
          </form>
        )}

        {/* The app's switch, not a checkbox: a 40px target beats a 13px one
            on a phone, and it matches every other toggle in Settings. */}
        <label className="profile-gate-remember">
          <span>Use this profile next time</span>
          <span className="switch">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => onRememberChange(event.target.checked)}
            />
            <i />
          </span>
        </label>

        <button type="button" className="secondary" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
