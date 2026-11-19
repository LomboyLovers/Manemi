// Run with: node --test --experimental-strip-types lib/manemi/ledger.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLedger, paymentEntry, sharesFromSplitRows } from "./ledger.ts";

const exp = (
  id: string,
  payerId: string,
  totalCents: number,
  shares: Record<string, number>,
) => ({
  id,
  groupId: "g",
  payerId,
  totalCents,
  shares: Object.entries(shares).map(([userId, cents]) => ({ userId, cents })),
});

test("5-person group, 2-person expense: only those 2 are involved", () => {
  // A paid ₱1,000 for A and B only. C, D, E were not part of it.
  const ledger = buildLedger([exp("e1", "A", 100000, { A: 50000, B: 50000 })]);
  assert.deepEqual(ledger.forUser("A").counterparties, [{ userId: "B", cents: 50000 }]);
  assert.deepEqual(ledger.plan(), [{ from: "B", to: "A", cents: 50000 }]);
  assert.deepEqual(ledger.forUser("B").counterparties, [{ userId: "A", cents: -50000 }]);
  for (const id of ["C", "D", "E"]) {
    assert.equal(ledger.forUser(id).net, 0);
    assert.deepEqual(ledger.forUser(id).counterparties, []);
  }
});

test("debts between the same two people net out", () => {
  const ledger = buildLedger([
    exp("e1", "A", 100000, { A: 50000, B: 50000 }), // B owes A 500
    exp("e2", "B", 30000, { A: 15000, B: 15000 }), //  A owes B 150
  ]);
  const a = ledger.forUser("A");
  assert.deepEqual(a.counterparties, [{ userId: "B", cents: 35000 }]);
  assert.equal(a.net, 35000);
  assert.equal(a.owedToYou, 35000);
  assert.equal(a.youOwe, 0);
});

test("simplified: a chain of debts becomes one payment (BAL-04)", () => {
  // J owes M 300 (M paid), K owes J 200 (J paid). Nets: M +300, J -100, K -200.
  const ledger = buildLedger([
    exp("e1", "M", 60000, { M: 30000, J: 30000 }),
    exp("e2", "J", 40000, { J: 20000, K: 20000 }),
  ]);
  assert.deepEqual(ledger.plan(), [
    { from: "K", to: "M", cents: 20000 },
    { from: "J", to: "M", cents: 10000 },
  ]);
  const j = ledger.forUser("J");
  assert.deepEqual(j.counterparties, [{ userId: "M", cents: -10000 }]);
  assert.equal(j.net, -10000);
  assert.equal(j.youOwe, 10000);
  assert.equal(j.owedToYou, 0);
  // Direct balances are still available.
  assert.deepEqual(ledger.pairwise("J"), [
    { userId: "M", cents: -30000 },
    { userId: "K", cents: 20000 },
  ]);
});

test("simplified plan settles everyone with at most n-1 payments", () => {
  const ledger = buildLedger([
    exp("e1", "A", 90000, { A: 30000, B: 30000, C: 30000 }),
    exp("e2", "B", 60000, { B: 20000, C: 20000, D: 20000 }),
    exp("e3", "D", 30000, { A: 15000, D: 15000 }),
  ]);
  const plan = ledger.plan();
  assert.ok(plan.length <= 3);
  const after = new Map(ledger.memberNets());
  for (const t of plan) {
    after.set(t.from, (after.get(t.from) ?? 0) + t.cents);
    after.set(t.to, (after.get(t.to) ?? 0) - t.cents);
  }
  for (const value of after.values()) assert.equal(value, 0);
});

test("member nets add to zero", () => {
  const ledger = buildLedger([
    exp("e1", "A", 90000, { A: 30000, B: 30000, C: 30000 }),
    exp("e2", "C", 10000, { B: 10000 }),
  ]);
  const nets = ledger.memberNets();
  assert.equal(
    [...nets.values()].reduce((sum, value) => sum + value, 0),
    0,
  );
  assert.equal(nets.get("A"), 60000);
});

test("split rows: amount column, percentage column, or equal fallback", () => {
  assert.deepEqual(
    sharesFromSplitRows(1000, [
      { expenseId: "e", userId: "A", amountOwed: 7 },
      { expenseId: "e", userId: "B", amountOwed: "3" },
    ]),
    [
      { userId: "A", cents: 700 },
      { userId: "B", cents: 300 },
    ],
  );
  assert.deepEqual(
    sharesFromSplitRows(1001, [
      { expenseId: "e", userId: "A", percentage: 50 },
      { expenseId: "e", userId: "B", percentage: 50 },
    ]),
    [
      { userId: "A", cents: 501 },
      { userId: "B", cents: 500 },
    ],
  );
  assert.deepEqual(
    sharesFromSplitRows(1000, [
      { expenseId: "e", userId: "A" },
      { expenseId: "e", userId: "B" },
      { expenseId: "e", userId: "C" },
    ]),
    [
      { userId: "A", cents: 334 },
      { userId: "B", cents: 333 },
      { userId: "C", cents: 333 },
    ],
  );
});

test("a recorded payment cancels the debt it pays", () => {
  // Kurt paid ₱600 for himself and you; you owe Kurt ₱300.
  const ledger = buildLedger([
    exp("e1", "K", 60000, { K: 30000, J: 30000 }),
    // You paid Kurt back ₱200 (a settlement: payer J, receiver K).
    paymentEntry("s1", "J", "K", 20000),
  ]);
  assert.deepEqual(ledger.forUser("J").counterparties, [{ userId: "K", cents: -10000 }]);
  // Paying the rest settles it completely.
  const settled = buildLedger([
    exp("e1", "K", 60000, { K: 30000, J: 30000 }),
    paymentEntry("s1", "J", "K", 20000),
    paymentEntry("s2", "J", "K", 10000),
  ]);
  assert.equal(settled.forUser("J").net, 0);
  assert.deepEqual(settled.forUser("J").counterparties, []);
});
