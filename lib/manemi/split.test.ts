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

// ---------- one shared split ----------
import {
  bpsToWeight,
  centsToWeight,
  equalWeights,
  weightsToBps,
  weightsToCents,
} from "./split.ts";

test("shared split: equal shares view the same in every mode", () => {
  const w = equalWeights(three);
  assert.deepEqual(weightsToCents(50000, three, w), { a: 16667, b: 16667, c: 16666 });
  const bps = weightsToBps(three, w);
  assert.equal(bps.a + bps.b + bps.c, 10000);
});

test("shared split: exact amounts round-trip and match their percent", () => {
  const total = 50000;
  const w = { a: centsToWeight(40000, total), b: centsToWeight(10000, total) };
  assert.deepEqual(weightsToCents(total, two, w), { a: 40000, b: 10000 });
  assert.deepEqual(weightsToBps(two, w), { a: 8000, b: 2000 });
});

test("shared split: odd totals round-trip to the centavo", () => {
  const total = 33333; // ₱333.33
  const w = { a: centsToWeight(11111, total), b: centsToWeight(11111, total), c: centsToWeight(11111, total) };
  assert.deepEqual(weightsToCents(total, three, w), { a: 11111, b: 11111, c: 11111 });
  const big = 9_999_999_999; // ₱99,999,999.99, the largest amount allowed
  const wb = { a: centsToWeight(1, big), b: centsToWeight(big - 1, big) };
  assert.deepEqual(weightsToCents(big, two, wb), { a: 1, b: big - 1 });
});

test("shared split: changing the amount rescales proportionally", () => {
  const w = { a: centsToWeight(20000, 50000), b: centsToWeight(30000, 50000) };
  assert.deepEqual(weightsToCents(60000, two, w), { a: 24000, b: 36000 });
});

test("shared split: percent entries are exact and incomplete splits show literal shares", () => {
  const w = { a: bpsToWeight(3333), b: bpsToWeight(3333), c: bpsToWeight(3333) };
  assert.deepEqual(weightsToBps(three, w), { a: 3333, b: 3333, c: 3333 });
  assert.deepEqual(weightsToCents(10000, three, w), { a: 3333, b: 3333, c: 3333 });
});

test("shared split: switching modes back and forth never drifts", () => {
  let w = equalWeights(three);
  for (let i = 0; i < 5; i++) {
    const cents = weightsToCents(50000, three, w);
    w = Object.fromEntries(three.map((id) => [id, centsToWeight(cents[id], 50000)]));
    const bps = weightsToBps(three, w);
    assert.equal(bps.a + bps.b + bps.c, 10000);
  }
  assert.deepEqual(weightsToCents(50000, three, w), { a: 16667, b: 16667, c: 16666 });
});

import { cleanDecimalInput } from "./split.ts";

test("amount fields keep only numbers", () => {
  assert.equal(cleanDecimalInput("1,250.505"), "1250.50");
  assert.equal(cleanDecimalInput("abc"), "");
  assert.equal(cleanDecimalInput("-5e3"), "53");
  assert.equal(cleanDecimalInput("."), "0.");
  assert.equal(cleanDecimalInput("12.3.4"), "12.34");
  assert.equal(cleanDecimalInput("007"), "7");
  assert.equal(cleanDecimalInput("0.05"), "0.05");
  assert.equal(cleanDecimalInput("123456789"), "12345678");
  assert.equal(cleanDecimalInput("100.5", 3), "100.5");
  assert.equal(cleanDecimalInput("₱ 99"), "99");
});
