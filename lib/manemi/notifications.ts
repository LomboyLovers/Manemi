// In-app activity notifications (bell): new, edited and deleted expenses that
// include you, payments you made or received, entered by someone else, and
// payment reminders sent to you.
// Read from the database (list_activity_notifications); "read" is stored per
// user (mark_notifications_seen), so it follows you across devices.

import type { createClient } from "@/lib/supabase/client";
import { money, peso } from "./format.ts";

type Supabase = ReturnType<typeof createClient>;

export type ActivityNotification = {
  id: string;
  groupId: string;
  groupName: string;
  action: string;
  actorName: string;
  /** Where tapping it goes: the group, or its settle-up screen for reminders. */
  href: string;
  /** Who did it, as a short sentence: "Ben added Dinner". */
  text: { actor: string; verb: string; object: string };
  /** Secondary line: "Your share ₱250.00" or the amount. */
  detail: string;
  date: string;
  unread: boolean;
};

type Row = {
  activity_id: string;
  group_id: string;
  group_name: string | null;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_id: string;
  title: string | null;
  amount: number | string;
  currency: string | null;
  your_share: number | string;
  receiver_id: string | null;
  receiver_name: string | null;
  created_at: string;
  unread: boolean;
  unread_count: number | string;
};

/** Pure: one database row → what the bell shows. `me` is the signed-in user id. */
export function describeNotification(row: Row, me: string): ActivityNotification {
  const actor = (row.actor_name ?? "").trim() || "Someone";
  const title = (row.title ?? "").trim() || "an expense";
  const amount = Number(row.amount) || 0;
  const share = Number(row.your_share) || 0;
  const currency = row.currency ?? "PHP";
  const toMe = row.receiver_id === me;
  const receiver = toMe ? "you" : (row.receiver_name ?? "").trim() || "someone";

  let verb = "";
  let object = "";
  let detail = "";
  switch (row.action) {
    case "expense_created":
      verb = "added";
      object = title;
      break;
    case "expense_updated":
      verb = "edited";
      object = title;
      break;
    case "expense_deleted":
      verb = "deleted";
      object = title;
      break;
    case "settlement_recorded":
      verb = toMe ? "paid you" : `recorded a payment to ${receiver}`;
      object = peso(amount);
      break;
    case "settlement_updated":
      verb = "edited a payment to";
      object = receiver;
      detail = peso(amount);
      break;
    case "settlement_cancelled":
      verb = "cancelled a payment to";
      object = receiver;
      detail = peso(amount);
      break;
    case "payment_reminder":
      verb = "reminded you to pay";
      object = peso(amount);
      detail = "Tap to settle up";
      break;
    default:
      verb = "updated";
      object = title;
  }
  if (row.action.startsWith("expense_")) {
    detail =
      row.action === "expense_deleted"
        ? amount > 0
          ? `Was ${money(amount, currency)}`
          : ""
        : share > 0
          ? `Your share ${money(share, currency)} of ${money(amount, currency)}`
          : amount > 0
            ? `${money(amount, currency)} total`
            : "";
  }
  return {
    id: row.activity_id,
    groupId: row.group_id,
    groupName: row.group_name ?? "",
    action: row.action,
    actorName: actor,
    href: row.action === "payment_reminder" ? `/groups/${row.group_id}?settle=1` : `/groups/${row.group_id}`,
    text: { actor, verb, object },
    detail,
    date: row.created_at,
    unread: Boolean(row.unread),
  };
}

export async function listActivityNotifications(
  supabase: Supabase,
  me: string,
  limit = 20,
): Promise<{ items: ActivityNotification[]; unread: number }> {
  const { data, error } = await supabase.rpc("list_activity_notifications", { p_limit: limit });
  if (error) throw new Error(`Couldn't load activity: ${error.message}`);
  const rows = (data ?? []) as Row[];
  return {
    items: rows.map((row) => describeNotification(row, me)),
    unread: Number(rows[0]?.unread_count ?? 0),
  };
}

export async function markNotificationsSeen(supabase: Supabase): Promise<void> {
  const { error } = await supabase.rpc("mark_notifications_seen");
  if (error) throw new Error(error.message);
}

/** "now", "5m", "3h", "2d", then a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
