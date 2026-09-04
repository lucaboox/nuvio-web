import { useId, type CSSProperties } from "react";

/**
 * The accents Nuvio offers, in its own order.
 *
 * `ink` is what sits on top of the colour — the tick in the chosen swatch and
 * any label drawn over the accent — so it is dark for every light accent and
 * white only where the colour is dark enough to carry it.
 *
 * The official client draws Gold, Rose gold and Arctic blue as gradients. A
 * single `--accent` token cannot hold two stops, so those are the colour a
 * gradient would average to; the swatch keeps the gradient so the picker still
 * looks like the one people know.
 */
export const ACCENT_OPTIONS = [
  { value: "GOLD", label: "Gold", color: "#e0ac3f", ink: "#171004",
    swatch: "linear-gradient(145deg, #f6d979, #c8901f)" },
  { value: "JADE", label: "Jade", color: "#2fcf9a", ink: "#04140e",
    swatch: "linear-gradient(145deg, #4ee0ac, #1aa877)" },
  { value: "ROSE_GOLD", label: "Rose gold", color: "#e39ba6", ink: "#1a0a0d",
    swatch: "linear-gradient(145deg, #d98ad1, #f0a98c)" },
  { value: "ARCTIC_BLUE", label: "Arctic blue", color: "#3f9df3", ink: "#04101c",
    swatch: "linear-gradient(145deg, #5fc0ff, #1f74e0)" },
  { value: "GRAPHITE", label: "Graphite", color: "#b7bfc8", ink: "#0b0e11",
    swatch: "linear-gradient(145deg, #d5dbe1, #9aa3ac)" },
  { value: "WHITE", label: "White", color: "#e9eef2", ink: "#090b0d" },
  { value: "CRIMSON", label: "Crimson", color: "#ef3340", ink: "#fff" },
  { value: "OCEAN", label: "Ocean", color: "#3da7e8", ink: "#061016" },
  { value: "VIOLET", label: "Violet", color: "#a886f7", ink: "#0e0919" },
  { value: "EMERALD", label: "Emerald", color: "#53bda6", ink: "#07120f" },
  { value: "AMBER", label: "Amber", color: "#edb84d", ink: "#171004" },
  { value: "ROSE", label: "Rose", color: "#ee7fa8", ink: "#190812" },
] as const;

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
