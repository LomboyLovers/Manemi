// Run with: node --test --experimental-strip-types lib/manemi/spending.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { niceScale, periodChange, periodStart, spendingSeries } from "./spending.ts";

// Thursday, Nov 19 2026, 11 PM local time
const now = new Date(2026, 10, 19, 23, 0);
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

test("weeks start on Monday", () => {
  assert.equal(periodStart("week", now).toDateString(), new Date(2026, 10, 16).toDateString());
  assert.equal(periodStart("week", now, 1).toDateString(), new Date(2026, 10, 9).toDateString());
  assert.equal(periodStart("month", now, 2).toDateString(), new Date(2026, 8, 1).toDateString());
});

test("weekly series: 8 weeks, oldest first, your share in pesos only", () => {
  const rows = [
    { date: at(2026, 11, 16, 0), yourShare: 100, currency: "PHP" }, // Monday this week
    { date: at(2026, 11, 19), yourShare: 50.5, currency: "PHP" },
    { date: at(2026, 11, 15, 23), yourShare: 200, currency: "PHP" }, // Sunday last week
    { date: at(2026, 11, 18), yourShare: 999, currency: "USD" }, // not pesos
    { date: at(2026, 9, 1), yourShare: 70, currency: "PHP" }, // older than 8 weeks
  ];
  const series = spendingSeries(rows, "week", now);
  assert.equal(series.length, 8);
  assert.equal(series[7].label, "Nov 16");
  assert.equal(series[7].cents, 15050);
  assert.equal(series[6].cents, 20000);
  assert.equal(series.reduce((sum, point) => sum + point.cents, 0), 35050);
});

test("monthly series: 6 months ending this month", () => {
  const rows = [
    { date: at(2026, 11, 2), yourShare: 300, currency: "PHP" },
    { date: at(2026, 10, 31), yourShare: 120, currency: "PHP" },
    { date: at(2026, 6, 15), yourShare: 80, currency: "PHP" },
    { date: at(2026, 5, 31), yourShare: 1, currency: "PHP" }, // before the window
  ];
  const series = spendingSeries(rows, "month", now);
  assert.deepEqual(series.map((point) => point.label), ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]);
  assert.deepEqual(series.map((point) => point.cents), [8000, 0, 0, 0, 12000, 30000]);
  assert.equal(series[5].longLabel, "November 2026");
});

test("change vs the previous period", () => {
  const points = (a: number, b: number) =>
    [a, b].map((cents) => ({ start: new Date(), label: "", longLabel: "", cents }));
  assert.deepEqual(periodChange(points(10000, 12500)), { cents: 2500, percent: 25 });
  assert.deepEqual(periodChange(points(10000, 5000)), { cents: -5000, percent: -50 });
  assert.deepEqual(periodChange(points(0, 5000)), { cents: 5000, percent: null });
});

test("axis uses round steps", () => {
  assert.deepEqual(niceScale(70000), { max: 80000, step: 20000 }); // ₱700 -> 0..₱800
  assert.deepEqual(niceScale(15050), { max: 20000, step: 5000 }); // ₱150.50 -> 0..₱200
  assert.deepEqual(niceScale(0), { max: 100, step: 25 }); // nothing yet: ₱0..₱1
});
