import { useId, type CSSProperties } from "react";
import { Check } from "lucide-react";

export const ACCENT_OPTIONS = [
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
        style={{ "--swatch-color": option.color, "--swatch-ink": option.ink } as CSSProperties}>
        <input type="radio" name={name} value={option.value} checked={value === option.value}
          onChange={() => onChange(option.value)} />
        <span className="accent-swatch" aria-hidden="true"><Check /></span>
        <span className="accent-name">{option.label}</span>
      </label>)}
    </div>
  </fieldset>;
}
