// Who owes whom, computed from each expense's actual participants.
//
// For every expense, each participant other than the payer owes the payer
// their own share. Nobody outside the expense's split is touched: in a
// 5-person group, an expense between 2 people only creates a debt between
// those 2. Debts between the same pair net out.
//
// Debt simplification (SRS BAL-04): from everyone's net balance we compute
// the settle-up plan with the fewest payments, and "who you owe / who owes
// you" comes from that plan. Example: Ann owes Ben 100 and Ben owes Cy 100
// becomes one payment, Ann pays Cy 100. Only people with a non-zero net are
// in the plan, so people outside an expense are never involved.
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

/** One payment in the settle-up plan. */
export type Transfer = { from: string; to: string; cents: number };

/**
 * Fewest-payments plan for a set of net balances (positive = is owed).
 * Greedy: the largest debtor pays the largest creditor, repeat. Produces at
 * most n-1 payments; ties break by user id so the plan is stable.
 */
export function simplifyDebts(nets: Map<string, number>): Transfer[] {
  const byAmount = (a: [string, number], b: [string, number]) =>
    b[1] - a[1] || (a[0] < b[0] ? -1 : 1);
  const creditors = [...nets].filter(([, v]) => v > 0).map(([id, v]) => [id, v] as [string, number]).sort(byAmount);
  const debtors = [...nets].filter(([, v]) => v < 0).map(([id, v]) => [id, -v] as [string, number]).sort(byAmount);
  const plan: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const cents = Math.min(debtors[i][1], creditors[j][1]);
    if (cents > 0) plan.push({ from: debtors[i][0], to: creditors[j][0], cents });
    debtors[i][1] -= cents;
    creditors[j][1] -= cents;
    if (debtors[i][1] === 0) i++;
    if (creditors[j][1] === 0) j++;
  }
  return plan;
}

export type UserBalance = {
  net: number;
  owedToYou: number;
  youOwe: number;
  /** Largest amounts first. */
  counterparties: Counterparty[];
};

/**
 * A recorded payment ("payer paid receiver back"). In ledger terms it's like
 * an expense the payer covered for the receiver, which cancels the payer's
 * debt to the receiver.
 */
export function paymentEntry(
  id: string,
  payerId: string,
  receiverId: string,
  cents: number,
  groupId = "",
): LedgerExpense {
  return { id, groupId, payerId, totalCents: cents, shares: [{ userId: receiverId, cents }] };
}

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

  /** Direct (unsimplified) balance with each person, from shared expenses only. */
  function pairwise(userId: string): Counterparty[] {
    const counterparties: Counterparty[] = [];
    for (const other of people()) {
      if (other === userId) continue;
      const cents = owed(other, userId) - owed(userId, other);
      if (cents) counterparties.push({ userId: other, cents });
    }
    return counterparties.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  }

  /** Net per person (positive = is owed). Always sums to zero. */
  let nets: Map<string, number> | null = null;
  function memberNets() {
    if (nets) return nets;
    nets = new Map<string, number>();
    for (const person of people()) {
      const net = pairwise(person).reduce((sum, item) => sum + item.cents, 0);
      if (net) nets.set(person, net);
    }
    return nets;
  }

  let simplified: Transfer[] | null = null;
  /** The group's fewest-payments settle-up plan. */
  function plan() {
    return (simplified ??= simplifyDebts(memberNets()));
  }

  /** Your balance, with counterparties taken from the simplified plan. */
  function forUser(userId: string): UserBalance {
    const counterparties: Counterparty[] = [];
    for (const transfer of plan()) {
      if (transfer.from === userId) counterparties.push({ userId: transfer.to, cents: -transfer.cents });
      else if (transfer.to === userId) counterparties.push({ userId: transfer.from, cents: transfer.cents });
    }
    counterparties.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
    const owedToYou = counterparties.filter((c) => c.cents > 0).reduce((sum, c) => sum + c.cents, 0);
    const youOwe = counterparties.filter((c) => c.cents < 0).reduce((sum, c) => sum - c.cents, 0);
    return { net: owedToYou - youOwe, owedToYou, youOwe, counterparties };
  }

  return { forUser, memberNets, plan, pairwise };
}

/** An Expense_Split row: amountOwed and percentage are numeric (may be null). */
export type SplitRow = {
  expenseId?: string;
  userId: string;
  amountOwed?: number | string | null;
  percentage?: number | string | null;
};

const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * Each participant's share in cents, from an expense's Expense_Split rows.
 * Uses amountOwed when every row has it, else percentage, else an equal
 * split between the listed participants only.
 */
export function sharesFromSplitRows(totalCents: number, rows: SplitRow[]): Share[] {
  const ids = [...new Set(rows.map((row) => row.userId))];
  if (!ids.length) return [];

  const amounts = rows.map((row) => numberOrNull(row.amountOwed));
  if (amounts.every((value) => value !== null)) {
    const cents = new Map<string, number>();
    rows.forEach((row, index) =>
      cents.set(row.userId, (cents.get(row.userId) ?? 0) + Math.round(amounts[index]! * 100)),
    );
    return ids.map((userId) => ({ userId, cents: cents.get(userId) ?? 0 }));
  }

  const percents = rows.map((row) => numberOrNull(row.percentage));
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
