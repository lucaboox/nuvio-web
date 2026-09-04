/** Compare the rendered text height with the CSS line budget, allowing rounding. */
export function descriptionOverflows(height: number, lineHeight: number, lines: number): boolean {
  return Number.isFinite(lineHeight) && lineHeight > 0 && Number.isFinite(lines) && lines > 0
    && height > Math.ceil(lineHeight * lines) + 1;
}
