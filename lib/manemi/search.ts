// Database-backed search and pagination (search_history / search_activity
// RPCs, plus plain table queries). Row-level security decides what each user
// can see; nothing here filters in the browser.

import type { createClient } from "@/lib/supabase/client";
import { categoryKey } from "./format.ts";
import type { HistoryExpense } from "./groups.ts";
import { describeActivity, type ActivityAction, type ActivityItem } from "./activity.ts";

type Supabase = ReturnType<typeof createClient>;

export const PAGE_SIZE = 10;

export type HistoryFilters = {
  kind: "all" | "expenses" | "payments";
  groupId: string | "all";
  query: string;
  onlyMine: boolean;
  sort: "newest" | "oldest" | "largest";
};

export type Page<T> = { items: T[]; total: number };

/** `%`, `_` and `\` typed by the user are matched literally. */
export const escapeLike = (text: string) => text.trim().replace(/[\\%_]/g, (c) => `\\${c}`);

type HistoryRow = {
  kind: "expense" | "payment";
  id: string;
  group_id: string;
  group_name: string;
  title: string | null;
  amount: number | string;
  category: string | null;
  happened_at: string;
  payer_id: string;
  payer_name: string | null;
  receiver_id: string | null;
  receiver_name: string | null;
  payment_method: string | null;
  your_share: number | string;
  involves_you: boolean;
  total_count: number | string;
};

export async function searchHistory(
  supabase: Supabase,
  me: string,
  filters: HistoryFilters,
  page: number,
  pageSize = PAGE_SIZE,
): Promise<Page<HistoryExpense>> {
  const { data, error } = await supabase.rpc("search_history", {
    p_kind: filters.kind,
    p_group_id: filters.groupId === "all" ? null : filters.groupId,
    p_query: filters.query.trim() || null,
    p_only_mine: filters.onlyMine,
    p_sort: filters.sort,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) throw new Error(`Couldn't load history: ${error.message}`);
  const rows = (data ?? []) as HistoryRow[];
  const who = (id: string | null, name: string | null) =>
    id === me ? "You" : (name ?? "").trim() || "A former member";

  const items = rows.map((row): HistoryExpense => {
    const payerName = who(row.payer_id, row.payer_name);
    if (row.kind === "payment") {
      const receiverName = who(row.receiver_id, row.receiver_name);
      return {
        kind: "payment",
        id: row.id,
        groupId: row.group_id,
        groupName: row.group_name,
        title:
          row.payer_id === me
            ? `You paid ${receiverName}`
            : row.receiver_id === me
              ? `${payerName} paid you`
              : `${payerName} paid ${receiverName}`,
        amount: Number(row.amount) || 0,
        category: "other",
        date: row.happened_at,
        payerId: row.payer_id,
        payerName,
        receiverId: row.receiver_id ?? undefined,
        receiverName,
        paymentMethod: row.payment_method,
        yourShare: 0,
        involvesYou: row.involves_you,
      };
    }
    return {
      kind: "expense",
      id: row.id,
      groupId: row.group_id,
      groupName: row.group_name,
      title: row.title ?? "Expense",
      amount: Number(row.amount) || 0,
      category: categoryKey(row.category),
      date: row.happened_at,
      payerId: row.payer_id,
      payerName,
      yourShare: Number(row.your_share) || 0,
      involvesYou: row.involves_you,
    };
  });
  return { items, total: Number(rows[0]?.total_count ?? 0) };
}

type ActivityRow = {
  activity_id: string;
  group_id: string;
  group_name: string;
  actor_id: string | null;
  actor_name: string | null;
  action: ActivityAction;
  entity_type: "expense" | "settlement";
  entity_id: string;
  details: Record<string, unknown> | null;
  created_at: string;
  amount: number | string;
  payer_name: string | null;
  receiver_name: string | null;
  paid_by_name: string | null;
  involves_you: boolean;
  total_count: number | string;
};

export async function searchActivity(
  supabase: Supabase,
  me: string,
  filters: Omit<HistoryFilters, "kind">,
  page: number,
  pageSize = PAGE_SIZE,
): Promise<Page<ActivityItem>> {
  const { data, error } = await supabase.rpc("search_activity", {
    p_group_id: filters.groupId === "all" ? null : filters.groupId,
    p_query: filters.query.trim() || null,
    p_only_mine: filters.onlyMine,
    p_sort: filters.sort,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) throw new Error(`Couldn't load the audit log: ${error.message}`);
  const rows = (data ?? []) as ActivityRow[];

  const items = rows.map((row): ActivityItem => {
    const d = row.details ?? {};
    // Names come with the row; anyone no longer visible is "A former member".
    const names = new Map<string, string>();
    const put = (id: unknown, name: string | null) => {
      if (typeof id === "string" && name) names.set(id, name);
    };
    put(row.actor_id, row.actor_name);
    put(d.payerId, row.payer_name);
    put(d.receiverId, row.receiver_name);
    put(d.paidBy, row.paid_by_name);
    const name = (id: string | null) =>
      !id ? "Someone" : id === me ? "You" : names.get(id) ?? "A former member";
    const text = describeActivity(
      {
        activityId: row.activity_id,
        groupId: row.group_id,
        actorId: row.actor_id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        details: row.details,
        createdAt: row.created_at,
      },
      name,
    );
    return {
      id: row.activity_id,
      groupId: row.group_id,
      groupName: row.group_name,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actorId: row.actor_id,
      actorName: name(row.actor_id),
      title: text.title,
      detail: text.detail,
      amount: Number(row.amount) || text.amount,
      date: row.created_at,
      involvesYou: row.involves_you,
    };
  });
  return { items, total: Number(rows[0]?.total_count ?? 0) };
}

/**
 * Groups whose name, or one of whose expenses, matches the query.
 * Returns group ids (both queries are limited to your groups by RLS).
 */
export async function searchGroupIds(supabase: Supabase, query: string): Promise<Set<string>> {
  const pattern = `%${escapeLike(query)}%`;
  const [byName, byExpense] = await Promise.all([
    supabase.from("Group").select("groupId").ilike("name", pattern).limit(200),
    supabase.from("Expense").select("groupId").ilike("title", pattern).limit(500),
  ]);
  if (byName.error) throw new Error(`Couldn't search groups: ${byName.error.message}`);
  if (byExpense.error) throw new Error(`Couldn't search expenses: ${byExpense.error.message}`);
  return new Set(
    [...(byName.data ?? []), ...(byExpense.data ?? [])].map((row: { groupId: string }) => row.groupId),
  );
}
