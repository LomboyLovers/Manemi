// Who owes whom, computed from each expense's actual participants.
//
// For every expense, each participant other than the payer owes the payer
// their own share. Nobody outside the expense's split is touched: in a
// 5-person group, an expense between 2 people only creates a debt between
// those 2. Debts between the same pair net out.
//
// All amounts are integer centavos.

import { apportion } from "./split.ts";

export type Share = { userId: string; cents: number };

export type LedgerExpense = {
  id: string;
  groupId: string;
  payerId: string;
  totalCents: number;
  shares: Share[];
};

/** Positive cents = they owe you; negative = you owe them. */
export type Counterparty = { userId: string; cents: number };

export type UserBalance = {
  net: number;
  owedToYou: number;
  youOwe: number;
  /** Largest amounts first. */
  counterparties: Counterparty[];
};

export function buildLedger(expenses: LedgerExpense[]) {
  // owes.get(debtor).get(creditor) = cents
  const owes = new Map<string, Map<string, number>>();
  const add = (debtor: string, creditor: string, cents: number) => {
    if (!cents || debtor === creditor) return;
    const row = owes.get(debtor) ?? new Map<string, number>();
    row.set(creditor, (row.get(creditor) ?? 0) + cents);
    owes.set(debtor, row);
  };

  for (const expense of expenses) {
    for (const share of expense.shares) {
      add(share.userId, expense.payerId, share.cents);
    }
  }

  const owed = (debtor: string, creditor: string) =>
    owes.get(debtor)?.get(creditor) ?? 0;

  const people = () => {
    const ids = new Set<string>();
    owes.forEach((row, debtor) => {
      ids.add(debtor);
      row.forEach((_, creditor) => ids.add(creditor));
    });
    return ids;
  };

  function forUser(userId: string): UserBalance {
    const counterparties: Counterparty[] = [];
    for (const other of people()) {
      if (other === userId) continue;
      const cents = owed(other, userId) - owed(userId, other);
      if (cents) counterparties.push({ userId: other, cents });
    }
    counterparties.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
    const owedToYou = counterparties
      .filter((item) => item.cents > 0)
      .reduce((sum, item) => sum + item.cents, 0);
    const youOwe = counterparties
      .filter((item) => item.cents < 0)
      .reduce((sum, item) => sum - item.cents, 0);
    return { net: owedToYou - youOwe, owedToYou, youOwe, counterparties };
  }

  /** Net per person (positive = is owed). Always sums to zero. */
  function memberNets() {
    const nets = new Map<string, number>();
    for (const person of people()) nets.set(person, forUser(person).net);
    return nets;
  }

  return { forUser, memberNets };
}

type SplitRow = Record<string, unknown> & { userId: string };

// Column names a split row might use for the person's share. The schema is
// not in the repo, so the loader reads whole rows and this picks the column.
const AMOUNT_KEYS = [
  "amountOwed",
  "owedAmount",
  "shareAmount",
  "splitAmount",
  "amountDue",
  "amount",
  "share",
];
const PERCENT_KEYS = ["percentage", "percent", "sharePercentage"];

const numberIn = (row: SplitRow, keys: string[]) => {
  for (const key of keys) {
    if (row[key] === null || row[key] === undefined || row[key] === "") continue;
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
};

/**
 * Each participant's share in cents, from an expense's Expense_Split rows.
 * Uses the stored amount if there is one, else the stored percentage, else
 * an equal split between the listed participants only.
 */
export function sharesFromSplitRows(totalCents: number, rows: SplitRow[]): Share[] {
  const ids = [...new Set(rows.map((row) => row.userId))];
  if (!ids.length) return [];

  const amounts = rows.map((row) => numberIn(row, AMOUNT_KEYS));
  if (amounts.every((value) => value !== null)) {
    const cents = new Map<string, number>();
    rows.forEach((row, index) =>
      cents.set(row.userId, (cents.get(row.userId) ?? 0) + Math.round(amounts[index]! * 100)),
    );
    return ids.map((userId) => ({ userId, cents: cents.get(userId) ?? 0 }));
  }

  const percents = rows.map((row) => numberIn(row, PERCENT_KEYS));
  const weights: Record<string, number> = {};
  if (percents.every((value) => value !== null)) {
    rows.forEach((row, index) => {
      weights[row.userId] = (weights[row.userId] ?? 0) + Math.round(percents[index]! * 100);
    });
  } else {
    ids.forEach((id) => (weights[id] = 1));
  }
  const cents = apportion(totalCents, ids, weights);
  return ids.map((userId) => ({ userId, cents: cents[userId] }));
}
