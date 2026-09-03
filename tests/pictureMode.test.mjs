import assert from "node:assert/strict";
import test from "node:test";

import {
  objectFitForResizeMode,
  visibleResizeMode,
} from "../src/lib/pictureMode.ts";

test("picture modes map to stable browser geometry", () => {
  assert.equal(objectFitForResizeMode("Fit"), "contain");
  assert.equal(objectFitForResizeMode("Zoom"), "cover");
  assert.equal(objectFitForResizeMode("Fill"), "cover");
  assert.equal(objectFitForResizeMode("Stretch"), "fill");
});

test("legacy Fill enters the visible cycle as Zoom", () => {
  assert.equal(visibleResizeMode("Fill"), "Zoom");
  assert.equal(visibleResizeMode("Fit"), "Fit");
});
