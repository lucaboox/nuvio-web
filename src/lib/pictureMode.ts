import type { ResizeMode } from "../platform/types.ts";

/**
 * Fill is a legacy synonym for Zoom in Nuvio's player. Keep accepting it from
 * synced settings without adding a duplicate, visually identical cycle step.
 */
export function visibleResizeMode(mode: ResizeMode): Exclude<ResizeMode, "Fill"> {
  return mode === "Fill" ? "Zoom" : mode;
}

/** Browser geometry corresponding to the native player's picture modes. */
export function objectFitForResizeMode(mode: ResizeMode): "contain" | "cover" | "fill" {
  const visible = visibleResizeMode(mode);
  if (visible === "Stretch") return "fill";
  if (visible === "Fit") return "contain";
  return "cover";
}
