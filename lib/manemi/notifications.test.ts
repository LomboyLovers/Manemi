import { test } from "node:test";
import assert from "node:assert/strict";
import { describeNotification, timeAgo } from "./notifications.ts";

const base = {
  activity_id: "a1", group_id: "g1", group_name: "Korea 2026", actor_id: "u2", actor_name: "Ben",
  action: "expense_created", entity_id: "e1", title: "Dinner", amount: 500, currency: "PHP",
  your_share: 250, receiver_id: null, receiver_name: null, created_at: "2026-11-20T00:00:00Z",
  unread: true, unread_count: 1,
};

test("new expense shows your share", () => {
  const n = describeNotification(base, "u1");
  assert.deepEqual(n.text, { actor: "Ben", verb: "added", object: "Dinner" });
  assert.equal(n.detail, "Your share ₱250.00 of ₱500.00");
  assert.equal(n.unread, true);
});

test("expense you paid but don't share in shows the total", () => {
  assert.equal(describeNotification({ ...base, your_share: 0 }, "u1").detail, "₱500.00 total");
});

test("edited and deleted expenses", () => {
  assert.equal(describeNotification({ ...base, action: "expense_updated" }, "u1").text.verb, "edited");
  const del = describeNotification({ ...base, action: "expense_deleted", your_share: 0 }, "u1");
  assert.equal(del.text.verb, "deleted");
  assert.equal(del.detail, "Was ₱500.00");
});

test("payments", () => {
  const paid = describeNotification({ ...base, action: "settlement_recorded", title: null, amount: 100, receiver_id: "u1", receiver_name: "Ana" }, "u1");
  assert.deepEqual(paid.text, { actor: "Ben", verb: "paid you", object: "₱100.00" });
  const other = describeNotification({ ...base, action: "settlement_recorded", title: null, amount: 100, receiver_id: "u3", receiver_name: "Cat" }, "u1");
  assert.equal(other.text.verb, "recorded a payment to Cat");
});

test("missing names fall back", () => {
  const n = describeNotification({ ...base, actor_name: null, title: null }, "u1");
  assert.equal(n.text.actor, "Someone");
  assert.equal(n.text.object, "an expense");
});

test("timeAgo", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  assert.equal(timeAgo("2026-11-20T11:59:30Z", now), "now");
  assert.equal(timeAgo("2026-11-20T11:55:00Z", now), "5m");
  assert.equal(timeAgo("2026-11-20T09:00:00Z", now), "3h");
  assert.equal(timeAgo("2026-11-18T12:00:00Z", now), "2d");
});

test("payment reminder links to settle up", () => {
  const n = describeNotification({ ...base, action: "payment_reminder", title: null, amount: 250, your_share: 250, receiver_id: "u1" }, "u1");
  assert.deepEqual(n.text, { actor: "Ben", verb: "reminded you to pay", object: "₱250.00" });
  assert.equal(n.detail, "Tap to settle up");
  assert.equal(n.href, "/groups/g1?settle=1");
  assert.equal(describeNotification(base, "u1").href, "/groups/g1");
});
