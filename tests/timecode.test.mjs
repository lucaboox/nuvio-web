import assert from "node:assert/strict";
import test from "node:test";
import {
  appendDigit,
  digitsToSeconds,
  dropDigit,
  formatDigits,
  formatSeconds,
} from "../src/lib/timecode.ts";

/** Typing a whole value one key at a time, as the keypad does. */
const type = (keys) => [...keys].reduce(appendDigit, "");

test("digits fill from the seconds end", () => {
  assert.equal(formatDigits(type("4")), "0:04");
  assert.equal(formatDigits(type("45")), "0:45");
  assert.equal(formatDigits(type("241")), "2:41");
  assert.equal(formatDigits(type("2410")), "24:10");
  assert.equal(formatDigits(type("12345")), "1:23:45");
  assert.equal(formatDigits(type("123456")), "12:34:56");
});

test("an empty field reads as zero rather than blank", () => {
  assert.equal(formatDigits(""), "0:00");
});

test("the seventh digit is ignored rather than shifting the hours off", () => {
  const six = type("123456");
  assert.equal(appendDigit(six, "7"), six);
  assert.equal(formatDigits(appendDigit(six, "7")), "12:34:56");
});

test("leading zeros do not consume the six places", () => {
  assert.equal(type("0"), "0");
  assert.equal(type("00"), "0");
  assert.equal(formatDigits(type("0002410")), "24:10");
});

test("delete removes one digit from the seconds end", () => {
  assert.equal(formatDigits(dropDigit(type("2410"))), "2:41");
  assert.equal(dropDigit(""), "");
});

test("digits convert to seconds", () => {
  assert.equal(digitsToSeconds(type("4")), 4);
  assert.equal(digitsToSeconds(type("241")), 2 * 60 + 41);
  assert.equal(digitsToSeconds(type("2410")), 24 * 60 + 10);
  assert.equal(digitsToSeconds(type("12345")), 3600 + 23 * 60 + 45);
});

test("nothing entered is not a time", () => {
  assert.equal(digitsToSeconds(""), null);
});

// The whole point of refusing: 24:70 almost certainly meant 24:07 or 24:10,
// and accepting it silently writes a resume point a minute from where you were.
test("an impossible seconds place is refused, not reinterpreted", () => {
  assert.equal(digitsToSeconds("2470"), null);
  assert.equal(digitsToSeconds("60"), null);
});

test("minutes may exceed an hour only while there is no hours place", () => {
  assert.equal(digitsToSeconds("9000"), 90 * 60);
  assert.equal(digitsToSeconds("19000"), null);
});

test("formatSeconds and formatDigits agree", () => {
  for (const digits of ["4", "45", "241", "2410", "12345", "123456"]) {
    assert.equal(
      formatSeconds(digitsToSeconds(digits)),
      formatDigits(digits),
      digits,
    );
  }
});
