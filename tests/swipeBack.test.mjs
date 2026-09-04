import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/lib/useSwipeBack.ts", import.meta.url),
  "utf8",
);

test("the gesture attaches whenever its node appears", () => {
  // The failure this exists for is silent. With the listener effect keyed to
  // [], it ran once on the mount of whatever owns the hook — fine for an
  // overlay that is always in the document and merely hidden, useless for one
  // rendered when it opens, because the ref is still empty at that moment.
  // The effect returned early and the overlay simply had no gesture, with
  // nothing else about it looking wrong. It took two overlays doing this
  // before it was noticed.
  assert.match(
    src,
    /useLayoutEffect\(\(\) => \{\s*setNode\(/,
    "the node must be read back after every render",
  );
  assert.match(
    src,
    /node\.addEventListener\("touchstart"/,
    "expected the listeners this guards",
  );
  assert.match(
    src,
    /\}, \[node\]\);/,
    "the listener effect must key on the node, not on mount alone",
  );
  assert.doesNotMatch(
    src,
    /\}, \[\]\);/,
    "an effect keyed to mount alone cannot see a node that arrives later",
  );
});

test("a conditionally rendered overlay is the case that broke", () => {
  // Both of these render their overlay only while it is open, so neither had
  // a node at the owner's mount.
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(
    app,
    /integrationPage === page\.key && \([\s\S]{0,200}ref=\{integrationSwipeRef\}/,
    "the integration page is rendered only while open",
  );
  const details = readFileSync(
    new URL("../src/components/Details.tsx", import.meta.url),
    "utf8",
  );
  assert.match(details, /ref=\{sourceSwipeRef\}/, "the source sheet uses one too");
});
