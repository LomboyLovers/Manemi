import { test } from "node:test";
import assert from "node:assert/strict";
import { describeActivity } from "./activity.ts";

const names: Record<string, string> = { me: "You", m: "Maria", k: "Kurt" };
const name = (id: string | null) => (id ? names[id] ?? "Someone" : "Someone");
const row = (action: string, entityType: "expense" | "settlement", actorId: string, details: object) => ({
  activityId: "a",
  groupId: "g",
  actorId,
  action: action as never,
  entityType,
  entityId: "e",
  details: details as Record<string, unknown>,
  createdAt: "2026-11-17T00:00:00Z",
});

test("expense added by someone else for another payer", () => {
  const out = describeActivity(row("expense_created", "expense", "m", { title: "Dinner", totalAmount: 1250, paidBy: "k" }), name);
  assert.equal(out.title, 'Maria added "Dinner"');
  assert.equal(out.detail, "Paid by Kurt");
  assert.equal(out.amount, 1250);
});

test("expense edit lists what changed", () => {
  const out = describeActivity(
    row("expense_updated", "expense", "me", {
      title: "Dinner (edited)",
      changes: { totalAmount: { from: 100, to: 120 }, title: { from: "Dinner", to: "Dinner (edited)" } },
    }),
    name,
  );
  assert.equal(out.title, 'You edited "Dinner (edited)"');
  assert.match(out.detail, /Amount ₱100\.00 → ₱120\.00/);
  assert.match(out.detail, /Title "Dinner" → "Dinner \(edited\)"/);
});

test("payment recorded shows who paid whom and how", () => {
  const out = describeActivity(
    row("settlement_recorded", "settlement", "me", { amount: 800, payerId: "me", receiverId: "m", paymentMethod: "gcash" }),
    name,
  );
  assert.equal(out.title, "You recorded a payment");
  assert.equal(out.detail, "You → Maria · GCash");
  assert.equal(out.amount, 800);
});

test("payment cancelled", () => {
  const out = describeActivity(row("settlement_cancelled", "settlement", "k", { amount: 30, payerId: "k", receiverId: "me" }), name);
  assert.equal(out.title, "Kurt cancelled a payment");
  assert.equal(out.detail, "Kurt → You");
});
