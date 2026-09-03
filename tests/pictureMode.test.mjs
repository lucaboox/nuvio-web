import assert from "node:assert/strict";
import test from "node:test";

import {
  mediaRectForResizeMode,
  objectFitForResizeMode,
  visibleResizeMode,
} from "../src/lib/pictureMode.ts";

test("picture modes map to stable browser geometry", () => {
  assert.equal(objectFitForResizeMode("Fit"), "contain");
  assert.equal(objectFitForResizeMode("Zoom"), "cover");
  assert.equal(objectFitForResizeMode("Fill"), "cover");
  assert.equal(objectFitForResizeMode("Stretch"), "fill");
});

test("Fit contains and Zoom covers a differently shaped fullscreen", () => {
  assert.deepEqual(mediaRectForResizeMode("Fit", 2000, 1000, 1000, 1000), {
    width: 1000,
    height: 500,
  });
  assert.deepEqual(mediaRectForResizeMode("Zoom", 2000, 1000, 1000, 1000), {
    width: 2000,
    height: 1000,
  });
  assert.deepEqual(mediaRectForResizeMode("Stretch", 2000, 1000, 1000, 1000), {
    width: 1000,
    height: 1000,
  });
});

test("invalid media dimensions do not produce broken inline geometry", () => {
  assert.equal(mediaRectForResizeMode("Fit", 0, 0, 1200, 800), null);
});

test("legacy Fill enters the visible cycle as Zoom", () => {
  assert.equal(visibleResizeMode("Fill"), "Zoom");
  assert.equal(visibleResizeMode("Fit"), "Fit");
});
