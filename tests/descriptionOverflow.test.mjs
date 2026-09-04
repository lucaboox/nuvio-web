import assert from "node:assert/strict";
import test from "node:test";
import { descriptionOverflows } from "../src/lib/descriptionOverflow.ts";

test("short and exactly-fitting descriptions have no Show More", () => {
  assert.equal(descriptionOverflows(62, 20.8, 4), false);
  assert.equal(descriptionOverflows(84, 20.8, 4), false);
  assert.equal(descriptionOverflows(84, 27.9, 3), false);
});
test("overflow is measured for both three-line movies and four-line series/mobile", () => {
  assert.equal(descriptionOverflows(112, 27.9, 3), true);
  assert.equal(descriptionOverflows(104, 20.8, 4), true);
  assert.equal(descriptionOverflows(122, 24.32, 4), true);
});
test("a description stops overflowing when a wider layout uses fewer lines", () => {
  assert.equal(descriptionOverflows(125, 25, 4), true);
  assert.equal(descriptionOverflows(75, 25, 4), false);
});
test("unmeasurable or hidden text does not enable Show More", () => {
  assert.equal(descriptionOverflows(0, 24, 4), false);
  assert.equal(descriptionOverflows(100, NaN, 4), false);
  assert.equal(descriptionOverflows(100, 24, 0), false);
});
