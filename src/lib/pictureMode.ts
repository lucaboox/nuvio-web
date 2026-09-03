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

export type MediaRect = { width: number; height: number };

/**
 * Explicit browser render size for a media surface.
 *
 * Relying on `object-fit` alone is unreliable for WebCodecs canvases and some
 * fullscreen implementations. Computing the actual rectangle makes video and
 * canvas use identical contain/cover/stretch geometry before and after the
 * fullscreen viewport is rebuilt.
 */
export function mediaRectForResizeMode(
  mode: ResizeMode,
  mediaWidth: number,
  mediaHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): MediaRect | null {
  if (
    ![mediaWidth, mediaHeight, viewportWidth, viewportHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return null;
  if (visibleResizeMode(mode) === "Stretch")
    return { width: viewportWidth, height: viewportHeight };
  const scale =
    visibleResizeMode(mode) === "Fit"
      ? Math.min(viewportWidth / mediaWidth, viewportHeight / mediaHeight)
      : Math.max(viewportWidth / mediaWidth, viewportHeight / mediaHeight);
  return { width: mediaWidth * scale, height: mediaHeight * scale };
}
