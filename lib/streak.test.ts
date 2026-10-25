import { test } from "node:test";
import assert from "node:assert/strict";
import {
  todayKey,
  shiftKey,
  yesterdayKey,
  streakDays,
  addActiveDay,
  daysSince,
  fnv1a,
  pinHash,
  isValidPin,
  pinMatches,
} from "./streak";

const T = "2026-10-25";

test("todayKey ist lokal formatiert", () => {
  assert.equal(todayKey(new Date(2026, 9, 25)), T);
});

test("shiftKey verschiebt Tage (vorwärts/rückwärts, Monatsgrenze)", () => {
  assert.equal(shiftKey(T, 1), "2026-10-26");
  assert.equal(shiftKey(T, -1), "2026-10-24");
  assert.equal(shiftKey("2026-11-01", -1), "2026-10-31");
  assert.equal(shiftKey("2026-03-01", -1), "2026-02-28");
  assert.equal(yesterdayKey(T), "2026-10-24");
});

test("streakDays zählt zusammenhängende Tage bis heute", () => {
  assert.equal(streakDays(["2026-10-25"], T), 1);
  assert.equal(streakDays(["2026-10-23", "2026-10-24", "2026-10-25"], T), 3);
  // Lücke → zählt nur ab gestern
  assert.equal(streakDays(["2026-10-20", "2026-10-23", "2026-10-24"], T), 2);
});

test("streakDays toleriert 'heute noch nicht aktiv' (zählt ab gestern)", () => {
  assert.equal(streakDays(["2026-10-24"], T), 1);
  assert.equal(streakDays([], T), 0);
});

test("addActiveDay dedupliziert und sortiert", () => {
  assert.deepEqual(addActiveDay(["2026-10-25", "2026-10-23"], "2026-10-24"), [
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
  ]);
  assert.deepEqual(addActiveDay(["2026-10-25"], "2026-10-25"), ["2026-10-25"]);
});

test("daysSince zählt inklusive Installationstag", () => {
  assert.equal(daysSince("2026-10-25", T), 1);
  assert.equal(daysSince("2026-10-01", T), 25);
  assert.equal(daysSince("2026-10-26", T), 0);
});

test("isValidPin akzeptiert nur 4 Ziffern", () => {
  assert.equal(isValidPin("1234"), true);
  assert.equal(isValidPin("0000"), true);
  assert.equal(isValidPin("123"), false);
  assert.equal(isValidPin("12345"), false);
  assert.equal(isValidPin("12a4"), false);
  assert.equal(isValidPin(""), false);
});

test("pinHash ist deterministisch, pinMatches prüft korrekt", () => {
  const salt = "abc123";
  const h = pinHash("1234", salt);
  assert.equal(pinHash("1234", salt), h);
  assert.notEqual(pinHash("1235", salt), h);
  assert.equal(pinMatches("1234", salt, h), true);
  assert.equal(pinMatches("1235", salt, h), false);
  assert.equal(pinMatches("12a4", salt, h), false);
  // gleicher PIN, anderer Salt → anderer Hash
  assert.notEqual(pinHash("1234", "other"), h);
});

test("fnv1a ist stabil und streut", () => {
  assert.equal(fnv1a(""), 0x811c9dc5);
  assert.equal(fnv1a("a"), fnv1a("a"));
  assert.notEqual(fnv1a("a"), fnv1a("b"));
});
