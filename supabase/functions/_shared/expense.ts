// Shared by create-expense and update-expense: validation and split maths.
import { z } from "npm:zod@3.23.8";

// Must match the database's expense_category enum.
export const CATEGORIES = [
  "food", "transport", "lodging", "utilities", "entertainment", "shopping", "other",
] as const;
export const CURRENCIES = ["PHP", "USD", "EUR", "JPY", "KRW"] as const;

const isMoney = (n: number) =>
  Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const toCents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;

export type Split = { userId: string; amount: number; percentage?: number };

// 100.00 split 3 ways -> 33.34, 33.33, 33.33 (no lost cents)
function splitEqually(totalCents: number, userIds: string[]): Split[] {
  const base = Math.floor(totalCents / userIds.length);
  let remainder = totalCents - base * userIds.length;
  return userIds.map((userId) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { userId, amount: fromCents(base + extra) };
  });
}

// Percentages in hundredths of a percent; leftover cents go to the largest remainders.
function splitByPercentage(totalCents: number, items: { userId: string; bp: number }[]): Split[] {
  const prod = items.map((i) => totalCents * i.bp);
  const base = prod.map((p) => (p - (p % 10000)) / 10000);
  const rem = prod.map((p) => p % 10000);
  let left = totalCents - base.reduce((a, b) => a + b, 0);
  const order = rem.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r);
  for (let k = 0; left > 0; k++, left--) base[order[k % order.length].i] += 1;
  return items.map((it, i) => ({ userId: it.userId, amount: fromCents(base[i]), percentage: it.bp / 100 }));
}

const money = (label: string) =>
  z.number({ invalid_type_error: `${label} must be a number` })
    .refine(isMoney, `${label} can have at most 2 decimal places`);

export const baseSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(100),
  totalAmount: money("Amount").pipe(
    z.number().positive("Amount must be greater than zero").max(99999999.99, "Amount is too large"),
  ),
  category: z.string().trim().toLowerCase().pipe(z.enum(CATEGORIES, {
    errorMap: () => ({ message: `Category must be one of: ${CATEGORIES.join(", ")}` }),
  })).optional(),
  currency: z.string().trim().toUpperCase().pipe(z.enum(CURRENCIES, {
    errorMap: () => ({ message: `Currency must be one of: ${CURRENCIES.join(", ")}` }),
  })).optional(),
  splitType: z.enum(["equal", "exact", "percentage"]).default("equal"),
  expenseDate: z.string().datetime({ offset: true }).optional(),
  receiptUrl: z.string().url().nullable().optional(),
  paidBy: z.string().uuid().optional(),
  participants: z.array(z.object({
    userId: z.string().uuid(),
    amount: money("Split amount").pipe(z.number().min(0)).optional(),
    percentage: money("Percentage").pipe(
      z.number().gt(0, "Percentage must be greater than 0").max(100, "Percentage cannot be more than 100"),
    ).optional(),
  })).min(1, "Select at least one participant"),
});

export function buildSplits(b: z.infer<typeof baseSchema>): { splits: Split[] } | { error: string } {
  const built = splitsFor(b);
  // Whoever paid must have a share of the expense.
  if ("splits" in built && b.paidBy && !built.splits.some((s) => s.userId === b.paidBy && s.amount > 0)) {
    return { error: "The person who paid needs a share of the expense. Include them in the split or change who paid" };
  }
  return built;
}

function splitsFor(b: z.infer<typeof baseSchema>): { splits: Split[] } | { error: string } {
  const ids = b.participants.map((p) => p.userId);
  if (new Set(ids).size !== ids.length) return { error: "Duplicate participants" };
  const total = toCents(b.totalAmount);

  if (b.splitType === "equal") return { splits: splitEqually(total, ids) };

  if (b.splitType === "percentage") {
    if (b.participants.some((p) => p.percentage === undefined)) {
      return { error: "Every participant needs a percentage for a percentage split" };
    }
    const items = b.participants.map((p) => ({ userId: p.userId, bp: Math.round(p.percentage! * 100) }));
    const sum = items.reduce((s, i) => s + i.bp, 0);
    if (sum !== 10000) {
      return { error: `Percentages add up to ${sum / 100}%, but they must add up to exactly 100%` };
    }
    // The app sends the amounts it showed alongside the percentages. Keep them when
    // they add up to the total and each one matches its percentage to within the
    // 0.01% the percentage was rounded to, so what was on screen is what's saved.
    if (b.participants.every((p) => p.amount !== undefined)) {
      const cents = b.participants.map((p) => toCents(p.amount!));
      const matches =
        cents.reduce((s, c) => s + c, 0) === total &&
        cents.every((c, i) => Math.abs(c * 10000 - total * items[i].bp) <= total / 2 + 10000);
      if (matches) {
        return {
          splits: items.map((it, i) => ({ userId: it.userId, amount: fromCents(cents[i]), percentage: it.bp / 100 })),
        };
      }
    }
    return { splits: splitByPercentage(total, items) };
  }

  if (b.participants.some((p) => p.amount === undefined)) {
    return { error: "Every participant needs an amount for an exact split" };
  }
  const sum = b.participants.reduce((s, p) => s + toCents(p.amount!), 0);
  if (sum !== total) {
    return { error: `Split amounts (${fromCents(sum)}) must equal the total (${b.totalAmount})` };
  }
  return { splits: b.participants.map((p) => ({ userId: p.userId, amount: p.amount! })) };
}
