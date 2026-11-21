import { test } from "node:test";
import assert from "node:assert/strict";
import { csvField, csvTotals, expensesToCsv, exportFileName } from "./csv.ts";

test("fields: plain, quoted, numbers, formulas neutralised", () => {
  assert.equal(csvField("Dinner"), "Dinner");
  assert.equal(csvField('Jo "JJ" Cruz'), '"Jo ""JJ"" Cruz"');
  assert.equal(csvField("Taxi, airport"), '"Taxi, airport"');
  assert.equal(csvField("line\nbreak"), "line break");
  assert.equal(csvField(1234.5), "1234.50");
  assert.equal(csvField("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvField("-5"), "'-5");
  assert.equal(csvField("@me"), "'@me");
});

test("file: BOM, header, dates and amounts, CRLF", () => {
  const csv = expensesToCsv(
    [
      { date: new Date(2026, 10, 19, 23, 30).toISOString(), title: "Samgyup, Myeongdong", groupName: "Korea 2026", category: "food", payerName: "You", amount: 4200, currency: "PHP", yourShare: 840 },
      { date: new Date(2026, 10, 2, 9).toISOString(), title: "Hotel", groupName: "Korea 2026", category: "lodging", payerName: "Maria", amount: 300, currency: "USD", yourShare: 60 },
    ],
    (key) => ({ food: "Food & Drink", lodging: "Lodging" })[key] ?? key,
  );
  assert.ok(csv.startsWith("﻿Date,Expense,Group,Category,Paid by,Amount,Currency,Your share\r\n"));
  const lines = csv.slice(1).trimEnd().split("\r\n");
  assert.equal(lines.length, 5); // header + 2 expenses + a TOTAL per currency
  assert.equal(lines[1], '2026-11-19,"Samgyup, Myeongdong",Korea 2026,Food & Drink,You,4200.00,PHP,840.00');
  assert.equal(lines[2], "2026-11-02,Hotel,Korea 2026,Lodging,Maria,300.00,USD,60.00");
  assert.equal(lines[3], ",TOTAL (1 expense),,,,4200.00,PHP,840.00");
  assert.equal(lines[4], ",TOTAL (1 expense),,,,300.00,USD,60.00");
  assert.ok(csv.endsWith("\r\n"));
});

test("totals: per currency, pesos first, no float drift", () => {
  const row = (amount: number, yourShare: number, currency = "PHP") => ({
    date: "2026-11-01T00:00:00Z", title: "x", groupName: "g", category: "food", payerName: "p", amount, currency, yourShare,
  });
  assert.deepEqual(csvTotals([row(0.1, 0.1), row(0.2, 0.2), row(5, 1, "USD"), row(1, 1, "KRW")]), [
    { currency: "PHP", amount: 0.3, yourShare: 0.3, count: 2 },
    { currency: "KRW", amount: 1, yourShare: 1, count: 1 },
    { currency: "USD", amount: 5, yourShare: 1, count: 1 },
  ]);
  assert.deepEqual(csvTotals([]), []);
});

test("empty export still has the header", () => {
  assert.equal(expensesToCsv([]), "﻿Date,Expense,Group,Category,Paid by,Amount,Currency,Your share\r\n");
});

test("file names", () => {
  assert.equal(exportFileName("Korea 2026", "2026-11-01", "2026-11-20", "csv"), "manemi-korea-2026-2026-11-01-to-2026-11-20.csv");
  assert.equal(exportFileName("All groups + personal", "2026-01-01", "2026-11-20", "pdf"), "manemi-all-groups-personal-2026-01-01-to-2026-11-20.pdf");
  assert.equal(exportFileName("Café ñ", "a", "b", "csv"), "manemi-cafe-n-a-to-b.csv");
  assert.equal(exportFileName("!!!", "a", "b", "csv"), "manemi-report-a-to-b.csv");
});
