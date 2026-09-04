/**
 * The accent palette, as data.
 *
 * Its own module because two very different things need it: the picker that
 * draws the swatches, and the settings parser that decides whether a synced
 * value is one it recognises. The parser had its own copy of the list, so
 * adding an accent to the picker left it rejecting that accent and falling
 * back to White — with nothing on screen to say why.
 *
 * A lib must not import a component, hence not living in AccentPicker.
 */
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
  { value: "GOLD", label: "Gold", color: "#ffd45c", ink: "#111111",
    swatch: "linear-gradient(145deg, #8a5700, #e8a91c, #fff1a8, #ffd45c, #9a6200)" },
  { value: "JADE", label: "Jade", color: "#7bf08d", ink: "#111111",
    swatch: "linear-gradient(145deg, #7bf08d, #22d37c, #0bbf9a)" },
  { value: "ROSE_GOLD", label: "Rose gold", color: "#ffb37a", ink: "#111111",
    swatch: "linear-gradient(145deg, #b75aff, #ec70a9, #ffb37a)" },
  { value: "ARCTIC_BLUE", label: "Arctic blue", color: "#4de3ff", ink: "#ffffff",
    swatch: "linear-gradient(145deg, #4de3ff, #3185f5, #4d55e8)" },
  { value: "GRAPHITE", label: "Graphite", color: "#f3f5f7", ink: "#111111",
    swatch: "linear-gradient(145deg, #f3f5f7, #aab2be, #687381)" },
  { value: "CRIMSON", label: "Crimson", color: "#e53935", ink: "#ffffff" },
  { value: "OCEAN", label: "Ocean", color: "#1e88e5", ink: "#ffffff" },
  { value: "VIOLET", label: "Violet", color: "#8e24aa", ink: "#ffffff" },
  { value: "EMERALD", label: "Emerald", color: "#43a047", ink: "#ffffff" },
  { value: "AMBER", label: "Amber", color: "#fb8c00", ink: "#ffffff" },
  { value: "ROSE", label: "Rose", color: "#d81b60", ink: "#ffffff" },
  { value: "WHITE", label: "White", color: "#f5f5f5", ink: "#111111" },
] as const;

/** Every value the picker offers, as the settings blob stores them. */
export const ACCENT_VALUES = ACCENT_OPTIONS.map((option) => option.value);
