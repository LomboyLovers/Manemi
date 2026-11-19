// Your spending this week / month, day by day, against the one before, for
// the home stats card. "Spending" is your share of each expense (what you
// used), in pesos.

export type SpendingPeriod = "week" | "month";

/** One x position on the chart: a weekday (Mon–Sun) or a day of the month (1–31). */
export type DaySlot = {
  /** Axis label: "Mon" or "1". */
  label: string;
  /** This period's day ("Wed, Nov 19"), or null if this month is shorter. */
  currentLabel: string | null;
  /** Your share that day, in cents. null = hasn't happened yet (or no such day). */
  current: number | null;
  /** The previous period's matching day ("Wed, Nov 12"), or null if it had no such day. */
  previousLabel: string | null;
  previous: number | null;
};

export type DailyComparison = {
  slots: DaySlot[];
  /** Index of today; the colored line ends here. */
  today: number;
  /** This period so far. */
  currentTotal: number;
  /** The whole previous period. */
  previousTotal: number;
  /** The previous period up to the same day (fair "so far" comparison). */
  previousToDate: number;
  /** Days of this period so far, including today. */
  daysSoFar: number;
};

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

/** Earliest date the card needs, covering both views (start of last week or last month). */
export function earliestNeeded(now: Date): Date {
  const week = periodStart("week", now, 1);
  const month = periodStart("month", now, 1);
  return week < month ? week : month;
}

const DAY_LABEL = new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const daysIn = (monthStart: Date) => new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/**
 * This week (Mon–Sun) or month (1–31) day by day, next to the previous one.
 * Only peso expenses count; other currencies aren't converted.
 */
export function dailyComparison(
  rows: Array<{ date: string; yourShare: number; currency: string }>,
  period: SpendingPeriod,
  now: Date,
): DailyComparison {
  const currentStart = periodStart(period, now, 0);
  const previousStart = periodStart(period, now, 1);
  const currentDays = period === "week" ? 7 : daysIn(currentStart);
  const previousDays = period === "week" ? 7 : daysIn(previousStart);
  const count = Math.max(currentDays, previousDays);
  const today = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - currentStart.getTime()) / 86_400_000,
  );

  // Your share per calendar day (local time).
  const byDay = new Map<string, number>();
  for (const row of rows) {
    if (row.currency !== "PHP") continue;
    const key = dayKey(new Date(row.date));
    byDay.set(key, (byDay.get(key) ?? 0) + Math.round(row.yourShare * 100));
  }
  const dayAt = (start: Date, index: number) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);

  const slots: DaySlot[] = [];
  for (let index = 0; index < count; index++) {
    const currentDay = index < currentDays ? dayAt(currentStart, index) : null;
    const previousDay = index < previousDays ? dayAt(previousStart, index) : null;
    slots.push({
      label: period === "week" ? WEEKDAYS[index] : String(index + 1),
      currentLabel: currentDay ? DAY_LABEL.format(currentDay) : null,
      current: currentDay && index <= today ? (byDay.get(dayKey(currentDay)) ?? 0) : null,
      previousLabel: previousDay ? DAY_LABEL.format(previousDay) : null,
      previous: previousDay ? (byDay.get(dayKey(previousDay)) ?? 0) : null,
    });
  }
  const sum = (values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
  return {
    slots,
    today,
    currentTotal: sum(slots.map((slot) => slot.current)),
    previousTotal: sum(slots.map((slot) => slot.previous)),
    previousToDate: sum(slots.slice(0, today + 1).map((slot) => slot.previous)),
    daysSoFar: today + 1,
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
