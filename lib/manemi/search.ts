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
  /** HIST-02 */
  category?: string | "all";
  memberId?: string | "all";
  /** "YYYY-MM-DD", inclusive */
  from?: string;
  to?: string;
};

const dayStart = (iso: string) => new Date(`${iso}T00:00:00`).toISOString();
const dayAfter = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
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
  currency?: string | null;
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
    p_category: filters.category && filters.category !== "all" ? filters.category : null,
    p_member_id: filters.memberId && filters.memberId !== "all" ? filters.memberId : null,
    p_from: filters.from ? dayStart(filters.from) : null,
    p_to: filters.to ? dayAfter(filters.to) : null,
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
      currency: row.currency ?? "PHP",
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

export type ReportRow = {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  amount: number;
  currency: string;
  category: string;
  date: string;
  payerId: string;
  payerName: string;
  yourShare: number;
};

/** DASH-02..05: every expense in the range (your groups, or one group). */
export async function reportExpenses(
  supabase: Supabase,
  me: string,
  options: { groupId: string | "all"; from?: string; to?: string },
): Promise<ReportRow[]> {
  const { data, error } = await supabase.rpc("report_expenses", {
    p_group_id: options.groupId === "all" ? null : options.groupId,
    p_from: options.from ? dayStart(options.from) : null,
    p_to: options.to ? dayAfter(options.to) : null,
  });
  if (error) throw new Error(`Couldn't load the report: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    groupId: String(row.group_id),
    groupName: String(row.group_name ?? ""),
    title: String(row.title ?? "Expense"),
    amount: Number(row.amount) || 0,
    currency: String(row.currency ?? "PHP"),
    category: String(row.category ?? "other"),
    date: String(row.happened_at),
    payerId: String(row.payer_id),
    payerName: row.payer_id === me ? "You" : String(row.payer_name ?? "A former member"),
    yourShare: Number(row.your_share) || 0,
  }));
}
