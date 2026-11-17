// Run with: node --test --experimental-strip-types lib/manemi/split.test.ts
// (Node 22.6+; no extra packages needed.)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apportion,
  computeShares,
  convertSplit,
  equalShares,
  hundredthsToInput,
} from "./split.ts";

const two = ["a", "b"];
const three = ["a", "b", "c"];

test("₱500 total: ₱250 exact converts to 50% and back", () => {
  const exact = { selected: two, entries: { a: "250", b: "250" } };
  const percent = convertSplit("exact", "percent", 50000, exact);
  assert.deepEqual(percent.entries, { a: "50", b: "50" });
  const back = convertSplit("percent", "exact", 50000, percent);
  assert.deepEqual(back.entries, { a: "250", b: "250" });
});

test("uneven exact amounts keep their proportion", () => {
  const exact = { selected: two, entries: { a: "400", b: "100" } };
  assert.deepEqual(convertSplit("exact", "percent", 50000, exact).entries, {
    a: "80",
    b: "20",
  });
});

test("equally -> percent / exact for three people sums exactly", () => {
  const state = { selected: three, entries: {} };
  const percent = convertSplit("equally", "percent", 10000, state).entries;
  assert.deepEqual(percent, { a: "33.34", b: "33.33", c: "33.33" });
  const exact = convertSplit("equally", "exact", 10000, state).entries;
  assert.deepEqual(exact, { a: "33.34", b: "33.33", c: "33.33" });
});

test("percent shares always add to the exact total", () => {
  const shares = computeShares("percent", 1001, {
    selected: three,
    entries: { a: "33.33", b: "33.33", c: "33.34" },
  });
  assert.equal(shares.a + shares.b + shares.c, 1001);
});

test("switching to equally keeps only people with a share", () => {
  const exact = { selected: three, entries: { a: "300", b: "200", c: "" } };
  assert.deepEqual(convertSplit("exact", "equally", 50000, exact).selected, [
    "a",
    "b",
  ]);
});

test("percent without an amount still splits 100% evenly", () => {
  const state = { selected: two, entries: {} };
  assert.deepEqual(convertSplit("equally", "percent", 0, state).entries, {
    a: "50",
    b: "50",
  });
});

test("helpers", () => {
  assert.deepEqual(equalShares(100, three), { a: 34, b: 33, c: 33 });
  assert.deepEqual(apportion(0, two, { a: 1, b: 1 }), { a: 0, b: 0 });
  assert.equal(hundredthsToInput(1250), "12.5");
  assert.equal(hundredthsToInput(0), "");
});
