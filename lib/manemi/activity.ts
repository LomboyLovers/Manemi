// Audit log: reads Group_Activity (written by the server whenever an expense
// or payment is created, edited, deleted or cancelled) and turns each row into
// a sentence for the History page.

import { peso } from "./format.ts";

export type ActivityAction =
  | "expense_created"
  | "expense_updated"
  | "expense_deleted"
  | "settlement_recorded"
  | "settlement_updated"
  | "settlement_cancelled";

export type ActivityItem = {
  id: string;
  groupId: string;
  groupName: string;
  action: ActivityAction;
  entityType: "expense" | "settlement";
  entityId: string;
  actorId: string | null;
  actorName: string;
  /** One-line description, e.g. `Maria added "Dinner"`. */
  title: string;
  /** What changed, e.g. "Amount ₱90.00 → ₱30.00". */
  detail: string;
  /** Pesos involved (0 when unknown). */
  amount: number;
  date: string;
  involvesYou: boolean;
};

export type ActivityRow = {
  activityId: string;
  groupId: string;
  actorId: string | null;
  action: ActivityAction;
  entityType: "expense" | "settlement";
  entityId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
};

const METHOD: Record<string, string> = { cash: "Cash", gcash: "GCash", bank_transfer: "Bank transfer" };

export const ACTIVITY_META: Record<ActivityAction, { label: string; color: string }> = {
  expense_created: { label: "Added", color: "#C4A1FF" },
  expense_updated: { label: "Edited", color: "#FFB547" },
  expense_deleted: { label: "Deleted", color: "#FF6B6B" },
  settlement_recorded: { label: "Payment", color: "#3DDC84" },
  settlement_updated: { label: "Payment edited", color: "#FFB547" },
  settlement_cancelled: { label: "Payment cancelled", color: "#FF6B6B" },
};

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const str = (value: unknown) => (typeof value === "string" ? value : "");

/** Turns one log row into readable text. `name(id)` resolves user names. */
export function describeActivity(row: ActivityRow, name: (id: string | null) => string) {
  const d = row.details ?? {};
  const actor = name(row.actorId);
  const changes = (d.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>;
  const changeText = Object.entries(changes)
    .map(([field, change]) => {
      if (field === "amount" || field === "totalAmount")
        return `Amount ${peso(num(change.from))} → ${peso(num(change.to))}`;
      if (field === "title") return `Title "${str(change.from)}" → "${str(change.to)}"`;
      if (field === "splits") return "Split changed";
      if (field === "paymentMethod")
        return `Method ${METHOD[str(change.from)] ?? str(change.from)} → ${METHOD[str(change.to)] ?? str(change.to)}`;
      if (field === "category") return `Category ${str(change.from)} → ${str(change.to)}`;
      return `${field} changed`;
    })
    .join(" · ");

  if (row.entityType === "expense") {
    const title = str(d.title) || "an expense";
    const amount = num(d.totalAmount ?? (changes.totalAmount?.to as number));
    const verb =
      row.action === "expense_created" ? "added" : row.action === "expense_updated" ? "edited" : "deleted";
    const payer = str(d.paidBy);
    return {
      title: `${actor} ${verb} "${title}"`,
      detail:
        row.action === "expense_updated"
          ? changeText || "Details changed"
          : payer && payer !== row.actorId
            ? `Paid by ${name(payer)}`
            : "",
      amount,
    };
  }

  const amount = num(d.amount ?? (changes.amount?.to as number));
  const payer = name(str(d.payerId) || null);
  const receiver = name(str(d.receiverId) || null);
  const method = METHOD[str(d.paymentMethod)] ?? "";
  const who = `${payer} → ${receiver}`;
  if (row.action === "settlement_recorded")
    return {
      title: `${actor} recorded a payment`,
      detail: [who, method].filter(Boolean).join(" · "),
      amount,
    };
  if (row.action === "settlement_updated")
    return { title: `${actor} edited a payment`, detail: changeText || who, amount };
  return { title: `${actor} cancelled a payment`, detail: who, amount };
}
