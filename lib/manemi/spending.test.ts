// Run with: node --test --experimental-strip-types lib/manemi/spending.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyComparison, earliestNeeded, niceScale, periodStart } from "./spending.ts";

// Thursday, Nov 19 2026, 11 PM local time
const now = new Date(2026, 10, 19, 23, 0);
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

test("weeks start on Monday", () => {
  assert.equal(periodStart("week", now).toDateString(), new Date(2026, 10, 16).toDateString());
  assert.equal(periodStart("week", now, 1).toDateString(), new Date(2026, 10, 9).toDateString());
  assert.equal(periodStart("month", now, 2).toDateString(), new Date(2026, 8, 1).toDateString());
});

test("weekly: Mon–Sun this week next to last week, pesos only, stops at today", () => {
  const rows = [
    { date: at(2026, 11, 16, 0), yourShare: 100, currency: "PHP" }, // Mon this week, midnight
    { date: at(2026, 11, 19), yourShare: 50.5, currency: "PHP" }, // Thu (today)
    { date: at(2026, 11, 19, 8), yourShare: 20, currency: "PHP" }, // Thu again
    { date: at(2026, 11, 15, 23), yourShare: 200, currency: "PHP" }, // Sun last week
    { date: at(2026, 11, 11), yourShare: 30, currency: "PHP" }, // Wed last week
    { date: at(2026, 11, 18), yourShare: 999, currency: "USD" }, // not pesos
    { date: at(2026, 11, 2), yourShare: 70, currency: "PHP" }, // two weeks ago
  ];
  const week = dailyComparison(rows, "week", now);
  assert.deepEqual(week.slots.map((slot) => slot.label), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  assert.equal(week.today, 3);
  assert.deepEqual(week.slots.map((slot) => slot.current), [10000, 0, 0, 7050, null, null, null]);
  assert.deepEqual(week.slots.map((slot) => slot.previous), [0, 0, 3000, 0, 0, 0, 20000]);
  assert.equal(week.currentTotal, 17050);
  assert.equal(week.previousTotal, 23000);
  assert.equal(week.previousToDate, 3000); // Mon–Thu last week
  assert.equal(week.daysSoFar, 4);
  assert.equal(week.slots[3].currentLabel, "Thu, Nov 19");
  assert.equal(week.slots[3].previousLabel, "Thu, Nov 12");
});

test("monthly: days 1–31, shorter month has no extra days", () => {
  const rows = [
    { date: at(2026, 11, 2), yourShare: 300, currency: "PHP" },
    { date: at(2026, 10, 31), yourShare: 120, currency: "PHP" },
    { date: at(2026, 10, 2), yourShare: 5, currency: "PHP" },
  ];
  const month = dailyComparison(rows, "month", now);
  assert.equal(month.slots.length, 31); // October has 31, November 30
  assert.equal(month.today, 18); // Nov 19
  assert.equal(month.slots[1].current, 30000);
  assert.equal(month.slots[1].previous, 500);
  assert.equal(month.slots[30].previous, 12000); // Oct 31
  assert.equal(month.slots[30].current, null); // no Nov 31
  assert.equal(month.slots[30].currentLabel, null);
  assert.equal(month.previousToDate, 500);
  assert.equal(month.currentTotal, 30000);
});

test("loads from the start of last week or last month, whichever is earlier", () => {
  assert.equal(earliestNeeded(now).toDateString(), new Date(2026, 9, 1).toDateString());
  // Early in a month, last week can start before last month does not: Mar 2 2026 (Mon)
  assert.equal(earliestNeeded(new Date(2026, 2, 2, 9)).toDateString(), new Date(2026, 1, 1).toDateString());
});

test("axis uses round steps", () => {
  assert.deepEqual(niceScale(70000), { max: 80000, step: 20000 }); // ₱700 -> 0..₱800
  assert.deepEqual(niceScale(15050), { max: 20000, step: 5000 }); // ₱150.50 -> 0..₱200
  assert.deepEqual(niceScale(0), { max: 100, step: 25 }); // nothing yet: ₱0..₱1
});

import { smoothPath } from "./spending.ts";

test("smooth line passes through every point and never overshoots", () => {
  const pts = [
    { x: 0, y: 100 }, { x: 10, y: 60 }, { x: 20, y: 65 }, { x: 30, y: 100 }, { x: 40, y: 10 }, { x: 50, y: 12 }, { x: 60, y: 30 },
  ];
  const d = smoothPath(pts);
  for (const p of pts.slice(1)) assert.ok(d.includes(` ${p.x},${p.y}`), `passes through ${p.x},${p.y}`);
  // Every control point stays within the y-range of its segment (no bulges).
  const segments = d.split(" C").slice(1).map((s) => s.trim().split(" ").map((xy) => xy.split(",").map(Number)));
  segments.forEach(([c1, c2, end], i) => {
    const lo = Math.min(pts[i].y, end[1]);
    const hi = Math.max(pts[i].y, end[1]);
    for (const c of [c1, c2]) assert.ok(c[1] >= lo - 0.05 && c[1] <= hi + 0.05, `segment ${i} control ${c[1]} within ${lo}..${hi}`);
  });
  assert.equal(smoothPath([{ x: 5, y: 5 }]), "M5,5");
});
