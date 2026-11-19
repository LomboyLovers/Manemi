// Your spending per week or month, for the home stats card.
// "Spending" is your share of each expense (what you used), in pesos.

export type SpendingPeriod = "week" | "month";

export type SpendingPoint = {
  /** Local midnight that starts the period. */
  start: Date;
  /** Short axis label: "Nov 10" (week of) or "Nov" (month). */
  label: string;
  /** Longer label for tooltips and the table: "Week of Nov 10" / "November 2026". */
  longLabel: string;
  cents: number;
};

/** Weeks shown on the chart; months shown on the chart. */
export const PERIODS_SHOWN: Record<SpendingPeriod, number> = { week: 8, month: 6 };

/** Monday 00:00 of the week containing `date` (same rule as the rest of the app). */
export function startOfWeek(date: Date): Date {
  const day = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - day);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Start of the period `offset` periods before the one containing `now` (0 = current). */
export function periodStart(period: SpendingPeriod, now: Date, offset = 0): Date {
  if (period === "month") return new Date(now.getFullYear(), now.getMonth() - offset, 1);
  const monday = startOfWeek(now);
  return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - offset * 7);
}

/** Earliest date the card needs, covering both views. */
export function earliestNeeded(now: Date): Date {
  const weeks = periodStart("week", now, PERIODS_SHOWN.week - 1);
  const months = periodStart("month", now, PERIODS_SHOWN.month - 1);
  return weeks < months ? weeks : months;
}

const SHORT = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" });
const MONTH = new Intl.DateTimeFormat("en-PH", { month: "short" });
const MONTH_LONG = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" });

/**
 * Totals your share per period, oldest first, ending with the current period.
 * Only peso expenses count; other currencies aren't converted.
 */
export function spendingSeries(
  rows: Array<{ date: string; yourShare: number; currency: string }>,
  period: SpendingPeriod,
  now: Date,
  count = PERIODS_SHOWN[period],
): SpendingPoint[] {
  const points: SpendingPoint[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const start = periodStart(period, now, offset);
    points.push({
      start,
      label: period === "week" ? SHORT.format(start) : MONTH.format(start),
      longLabel: period === "week" ? `Week of ${SHORT.format(start)}` : MONTH_LONG.format(start),
      cents: 0,
    });
  }
  const end = periodStart(period, now, -1).getTime();
  for (const row of rows) {
    if (row.currency !== "PHP") continue;
    const time = new Date(row.date).getTime();
    if (!(time < end) || time < points[0].start.getTime()) continue;
    // Latest period whose start is on or before this expense.
    for (let index = points.length - 1; index >= 0; index--) {
      if (time >= points[index].start.getTime()) {
        points[index].cents += Math.round(row.yourShare * 100);
        break;
      }
    }
  }
  return points;
}

/** Change from the previous period: cents and percent (null when last period was 0). */
export function periodChange(points: SpendingPoint[]): { cents: number; percent: number | null } {
  const current = points[points.length - 1]?.cents ?? 0;
  const previous = points[points.length - 2]?.cents ?? 0;
  return {
    cents: current - previous,
    percent: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
  };
}

/** Round axis maximum and step: 0, 250, 500, 750, 1000 ... (always 4 steps). */
export function niceScale(maxCents: number): { max: number; step: number } {
  const pesos = Math.max(maxCents / 100, 1);
  const raw = pesos / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((value) => value >= raw) ?? 10 * magnitude;
  return { max: step * 4 * 100, step: step * 100 };
}

/**
 * SVG path for a smooth line through the points (monotone cubic, Fritsch–Carlson).
 * Unlike a plain spline it never bulges above or below the data, so the curve
 * can't suggest spending that didn't happen or dip under ₱0.
 */
export function smoothPath(points: Array<{ x: number; y: number }>): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${points[0].x},${points[0].y}`;
  const dx = points.slice(1).map((p, i) => p.x - points[i].x);
  const slope = points.slice(1).map((p, i) => (p.y - points[i].y) / dx[i]);
  const tangent = points.map((_, i) => {
    if (i === 0) return slope[0];
    if (i === n - 1) return slope[n - 2];
    return slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  });
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      tangent[i] = t * a * slope[i];
      tangent[i + 1] = t * b * slope[i];
    }
  }
  const f = (v: number) => Number(v.toFixed(1));
  let d = `M${f(points[0].x)},${f(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const third = dx[i] / 3;
    d += ` C${f(points[i].x + third)},${f(points[i].y + tangent[i] * third)} ${f(points[i + 1].x - third)},${f(
      points[i + 1].y - tangent[i + 1] * third,
    )} ${f(points[i + 1].x)},${f(points[i + 1].y)}`;
  }
  return d;
}
