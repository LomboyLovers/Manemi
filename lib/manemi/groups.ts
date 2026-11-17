// Loads everything the Home and Groups screens need in as few round trips as
// possible:
//   1. auth user
//   2. memberships + owned groups + profile name   (parallel)
//   3. groups + all their expenses + balances      (parallel, one expense query)
// Search and filtering then happen in memory, so typing never re-hits the API.

import type { createClient } from "@/lib/supabase/client";
import { categoryKey, isZero, type CategoryKey } from "./format";

type Supabase = ReturnType<typeof createClient>;

export type CategorySlice = { key: CategoryKey; amount: number };

export type GroupSummary = {
  id: string;
  name: string;
  createdAt: string;
  isCreator: boolean;
  isArchived: boolean;
  status: "active" | "settled" | "unsettled";
  members: number;
  /** What others owe you in this group. */
  owedToYou: number;
  /** What you owe others in this group. */
  youOwe: number;
  /** owedToYou - youOwe: positive = you're owed, negative = you owe. */
  net: number;
  /** Total of every expense in the group. */
  spent: number;
  expenseCount: number;
  /** Spending per category, largest first. */
  breakdown: CategorySlice[];
  spentThisMonth: number;
  spentThisWeek: number;
  lastActivityAt: string | null;
};

export type GroupsData = {
  user: { id: string; name: string };
  groups: GroupSummary[];
  /** Non-fatal problems (e.g. one group's balances failed to load). */
  warnings: string[];
};

type ExpenseRow = {
  groupId: string;
  totalAmount: number | string;
  category: string | null;
  expenseDate: string;
};

type BalanceResponse = {
  error?: string;
  members?: Array<{ net: number | string }>;
  summary?: { owedToYou?: number | string; youOwe?: number | string };
};

function startOfMonth(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function startOfWeek(now: Date) {
  // Weeks start on Monday.
  const day = (now.getDay() + 6) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).getTime();
}

/** Returns null when nobody is signed in. Throws on a fatal load error. */
export async function loadGroupsData(supabase: Supabase): Promise<GroupsData | null> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return null;

  const [membershipsResult, ownedResult, profileResult] = await Promise.all([
    supabase.from("Group_Member").select("groupId").eq("userId", user.id),
    // Include groups the user created in case the membership row is missing.
    supabase.from("Group").select("groupId").eq("createdBy", user.id),
    supabase.from("User").select("name").eq("userId", user.id).maybeSingle(),
  ]);

  if (membershipsResult.error)
    throw new Error(
      `Unable to load group memberships: ${membershipsResult.error.message}`,
    );
  if (ownedResult.error) throw new Error(ownedResult.error.message);

  const name =
    String(profileResult.data?.name ?? "").trim() ||
    String(user.user_metadata?.full_name ?? "").trim() ||
    user.email?.split("@")[0] ||
    "there";

  const groupIds = [
    ...new Set([
      ...(membershipsResult.data ?? []).map((row) => row.groupId as string),
      ...(ownedResult.data ?? []).map((row) => row.groupId as string),
    ]),
  ];

  if (!groupIds.length) return { user: { id: user.id, name }, groups: [], warnings: [] };

  const [groupsResult, expensesResult, balances] = await Promise.all([
    supabase
      .from("Group")
      .select("groupId, name, createdAt, createdBy, isArchived")
      .in("groupId", groupIds)
      .order("createdAt", { ascending: false }),
    supabase
      .from("Expense")
      .select("groupId, totalAmount, category, expenseDate")
      .in("groupId", groupIds),
    Promise.all(
      groupIds.map(async (groupId) => {
        const { data, error } = await supabase.functions.invoke<BalanceResponse>(
          "get-balances",
          { body: { groupId } },
        );
        return { groupId, data, error };
      }),
    ),
  ]);

  if (groupsResult.error) throw new Error(groupsResult.error.message);

  const warnings: string[] = [];
  if (expensesResult.error)
    warnings.push(`Expense breakdowns unavailable: ${expensesResult.error.message}`);

  const now = new Date();
  const monthStart = startOfMonth(now);
  const weekStart = startOfWeek(now);
  const expensesByGroup = new Map<string, ExpenseRow[]>();
  for (const row of (expensesResult.data ?? []) as ExpenseRow[]) {
    const list = expensesByGroup.get(row.groupId) ?? [];
    list.push(row);
    expensesByGroup.set(row.groupId, list);
  }
  const balancesByGroup = new Map(balances.map((item) => [item.groupId, item]));

  const groups: GroupSummary[] = [];
  for (const group of groupsResult.data ?? []) {
    const balance = balancesByGroup.get(group.groupId);
    const response = balance?.data;
    let members = 1;
    let owedToYou = 0;
    let youOwe = 0;
    let status: GroupSummary["status"] = "active";
    let balanceError: string | null = null;

    if (balance?.error || response?.error || !Array.isArray(response?.members)) {
      balanceError = balance?.error?.message ?? response?.error ?? "invalid balance response";
    } else {
      const nets = response.members.map((member) => Number(member.net));
      if (nets.some((net) => !Number.isFinite(net))) {
        balanceError = "invalid member balance";
      } else {
        members = nets.length;
        owedToYou = Number(response.summary?.owedToYou ?? 0) || 0;
        youOwe = Number(response.summary?.youOwe ?? 0) || 0;
        // An archived group is Settled only when every member's net is zero.
        if (group.isArchived) status = nets.every(isZero) ? "settled" : "unsettled";
      }
    }

    if (balanceError) {
      warnings.push(`${group.name}: ${balanceError}`);
      // Never mislabel an archived group as Active when balances are unknown.
      if (group.isArchived) continue;
    }

    const expenses = expensesByGroup.get(group.groupId) ?? [];
    const byCategory = new Map<CategoryKey, number>();
    let spent = 0;
    let spentThisMonth = 0;
    let spentThisWeek = 0;
    let lastActivityAt: string | null = null;
    for (const expense of expenses) {
      const amount = Number(expense.totalAmount) || 0;
      const key = categoryKey(expense.category);
      byCategory.set(key, (byCategory.get(key) ?? 0) + amount);
      spent += amount;
      const time = new Date(expense.expenseDate).getTime();
      if (time >= monthStart) spentThisMonth += amount;
      if (time >= weekStart) spentThisWeek += amount;
      if (!lastActivityAt || expense.expenseDate > lastActivityAt)
        lastActivityAt = expense.expenseDate;
    }

    groups.push({
      id: group.groupId,
      name: group.name,
      createdAt: group.createdAt,
      isCreator: group.createdBy === user.id,
      isArchived: Boolean(group.isArchived),
      status,
      members,
      owedToYou,
      youOwe,
      net: owedToYou - youOwe,
      spent,
      expenseCount: expenses.length,
      breakdown: [...byCategory.entries()]
        .map(([key, amount]) => ({ key, amount }))
        .filter((slice) => slice.amount > 0)
        .sort((a, b) => b.amount - a.amount),
      spentThisMonth,
      spentThisWeek,
      lastActivityAt,
    });
  }

  return { user: { id: user.id, name }, groups, warnings };
}

/** Totals across groups for the balance summaries. */
export function totalsFor(groups: GroupSummary[]) {
  return groups.reduce(
    (totals, group) => ({
      owedToYou: totals.owedToYou + group.owedToYou,
      youOwe: totals.youOwe + group.youOwe,
      net: totals.net + group.net,
      spentThisMonth: totals.spentThisMonth + group.spentThisMonth,
      spentThisWeek: totals.spentThisWeek + group.spentThisWeek,
    }),
    { owedToYou: 0, youOwe: 0, net: 0, spentThisMonth: 0, spentThisWeek: 0 },
  );
}
