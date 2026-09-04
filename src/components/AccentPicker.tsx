import { useId, type CSSProperties } from "react";
import { ACCENT_OPTIONS } from "../lib/accents.ts";

export { ACCENT_OPTIONS };



export function AccentPicker({ value, disabled, onChange }: {
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}) {
  const name = useId();
  return <fieldset className="accent-picker" disabled={disabled}>
    <legend>Accent theme</legend>
    <p>Choose a color. Uses the same synced theme setting as Nuvio.</p>
    <div className="accent-options">
      {ACCENT_OPTIONS.map(option => <label className="accent-choice" key={option.value}
        style={{
          "--swatch-color": option.color,
          "--swatch-ink": option.ink,
          // Gradient swatches fall back to their own flat colour.
          "--swatch-fill": "swatch" in option ? option.swatch : option.color,
        } as CSSProperties}>
        <input type="radio" name={name} value={option.value} checked={value === option.value}
          onChange={() => onChange(option.value)} />
        <span className="accent-swatch" aria-hidden="true" />
        <span className="accent-name">{option.label}</span>
      </label>)}
    </div>
  </fieldset>;
}
