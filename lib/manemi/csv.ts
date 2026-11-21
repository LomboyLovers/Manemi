// DASH-05: export the Reports page's expenses as a CSV that opens cleanly in
// Excel, Google Sheets and Numbers.

export type CsvExpense = {
  date: string;
  title: string;
  groupName: string;
  category: string;
  payerName: string;
  amount: number;
  currency: string;
  yourShare: number;
};

export const CSV_HEADER = ["Date", "Expense", "Group", "Category", "Paid by", "Amount", "Currency", "Your share"];

/** Local calendar date as YYYY-MM-DD (spreadsheets read it as a date). */
export function csvDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * One CSV field. Quotes when needed, and neutralises text that a spreadsheet
 * would run as a formula (=, +, -, @ at the start: "CSV injection").
 */
export function csvField(value: string | number): string {
  if (typeof value === "number") return Number.isFinite(value) ? value.toFixed(2) : "";
  let text = value.replace(/\r\n|\r|\n/g, " ");
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return /[",]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One total per currency (never adds pesos to dollars), in cents so it never drifts. PHP first. */
export function csvTotals(rows: CsvExpense[]): Array<{ currency: string; amount: number; yourShare: number; count: number }> {
  const byCurrency = new Map<string, { amount: number; yourShare: number; count: number }>();
  for (const row of rows) {
    const entry = byCurrency.get(row.currency) ?? { amount: 0, yourShare: 0, count: 0 };
    entry.amount += Math.round(row.amount * 100);
    entry.yourShare += Math.round(row.yourShare * 100);
    entry.count += 1;
    byCurrency.set(row.currency, entry);
  }
  return [...byCurrency]
    .map(([currency, entry]) => ({ currency, amount: entry.amount / 100, yourShare: entry.yourShare / 100, count: entry.count }))
    .sort((a, b) => (a.currency === "PHP" ? -1 : b.currency === "PHP" ? 1 : a.currency.localeCompare(b.currency)));
}

/** The whole file: UTF-8 BOM (so Excel shows ñ, é, emoji), header, one row per expense, a TOTAL row per currency, CRLF lines. */
export function expensesToCsv(rows: CsvExpense[], categoryLabel: (key: string) => string = (key) => key): string {
  const lines = [CSV_HEADER.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvDate(row.date),
        row.title,
        row.groupName,
        categoryLabel(row.category),
        row.payerName,
        row.amount,
        row.currency,
        row.yourShare,
      ]
        .map(csvField)
        .join(","),
    );
  }
  for (const total of csvTotals(rows)) {
    lines.push(
      ["", `TOTAL (${total.count} ${total.count === 1 ? "expense" : "expenses"})`, "", "", "", total.amount, total.currency, total.yourShare]
        .map(csvField)
        .join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** "manemi-korea-2026-2026-11-01-to-2026-11-20.csv" */
export function exportFileName(scope: string, from: string, to: string, ext: "csv" | "pdf"): string {
  const slug =
    scope
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "report";
  return `manemi-${slug}-${from}-to-${to}.${ext}`;
}
