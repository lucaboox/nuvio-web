/**
 * Content types that are not titles.
 *
 * A collection catalog lists franchises — "every Bond film" — which Discover
 * has no way to show as a title and no player could open. Some metadata
 * addons publish them as their own type, so without this they arrive as a
 * "Collections" entry in the type filter. Matched on type, never on name:
 * a film catalog called "Criterion Collection" is still films.
 */
const NON_TITLE_TYPES = new Set(["collection", "collections"]);

export const isTitleType = (type: string) =>
  !NON_TITLE_TYPES.has(type.trim().toLowerCase());
