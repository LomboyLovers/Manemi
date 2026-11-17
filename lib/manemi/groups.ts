// Loads everything Home, Groups and History need in a few parallel rounds:
//   1. auth user
//   2. memberships + owned groups + profile name
//   3. groups + all rosters + all expenses
//   4. member names + all expense split rows
// Balances are then computed in memory by the ledger, using each expense's
// real participants (see ledger.ts). Search and filters never hit the API.

import type { createClient } from "@/lib/supabase/client";
import { categoryKey, type CategoryKey } from "./format.ts";
import {
  buildLedger,
  sharesFromSplitRows,
  type LedgerExpense,
} from "./ledger.ts";

type Supabase = ReturnType<typeof createClient>;

/** Signed amount in pesos: positive = they owe you, negative = you owe them. */
export type Counterparty = { userId: string; name: string; amount: number };

export type GroupSummary = {
  id: string;
  name: string;
  createdAt: string;
  isCreator: boolean;
  isArchived: boolean;
  status: "active" | "settled" | "unsettled";
  members: number;
  /** What others owe you in this group (pesos). */
  owedToYou: number;
  /** What you owe others in this group (pesos). */
  youOwe: number;
  /** owedToYou - youOwe: positive = you're owed, negative = you owe. */
  net: number;
  /** Who you owe / who owes you, largest first. */
  counterparties: Counterparty[];
  /** Total of every expense in the group (pesos). */
  spent: number;
  expenseCount: number;
  spentThisMonth: number;
  spentThisWeek: number;
  lastActivityAt: string | null;
};

export type HistoryExpense = {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  amount: number;
  category: CategoryKey;
  date: string;
  payerId: string;
  payerName: string;
  /** Your share in pesos, 0 if you weren't part of it. */
  yourShare: number;
  involvesYou: boolean;
};

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  /** User.userCode, shown as @handle. */
  handle: string;
};

export type GroupsData = {
  user: CurrentUser;
  groups: GroupSummary[];
  /** Every expense across your groups, newest first. */
  expenses: HistoryExpense[];
  warnings: string[];
};

type ExpenseRow = {
  expenseId: string;
  groupId: string;
  paidBy_UserId: string;
  title: string;
  totalAmount: number | string;
  category: string | null;
  expenseDate: string;
};

type SplitRow = {
  expenseId: string;
  userId: string;
  amountOwed: number | string | null;
  percentage: number | string | null;
};

const CHUNK = 150; // keep `in (...)` URLs short

async function inChunks<T>(
  ids: string[],
  load: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const results = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, index) =>
      load(ids.slice(index * CHUNK, (index + 1) * CHUNK)),
    ),
  );
  const error = results.find((result) => result.error)?.error ?? null;
  return { data: results.flatMap((result) => result.data ?? []), error };
}

function startOfMonth(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function startOfWeek(now: Date) {
  const day = (now.getDay() + 6) % 7; // Monday
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).getTime();
}

const toPesos = (cents: number) => cents / 100;

/** Returns null when nobody is signed in. Throws on a fatal load error. */
export async function loadGroupsData(supabase: Supabase): Promise<GroupsData | null> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return null;
  const me = user;

  const [membershipsResult, ownedResult, profileResult] = await Promise.all([
    supabase.from("Group_Member").select("groupId").eq("userId", me.id),
    // Include groups the user created in case the membership row is missing.
    supabase.from("Group").select("groupId").eq("createdBy", me.id),
    supabase.from("User").select("name, userCode").eq("userId", me.id).maybeSingle(),
  ]);
  if (membershipsResult.error)
    throw new Error(`Unable to load group memberships: ${membershipsResult.error.message}`);
  if (ownedResult.error) throw new Error(ownedResult.error.message);

  const myName =
    String(profileResult.data?.name ?? "").trim() ||
    String(me.user_metadata?.full_name ?? "").trim() ||
    me.email?.split("@")[0] ||
    "there";

  const currentUser: CurrentUser = {
    id: me.id,
    name: myName,
    email: me.email ?? "",
    handle: String(profileResult.data?.userCode ?? "").trim(),
  };

  const groupIds = [
    ...new Set<string>([
      ...(membershipsResult.data ?? []).map((row: { groupId: string }) => row.groupId),
      ...(ownedResult.data ?? []).map((row: { groupId: string }) => row.groupId),
    ]),
  ];
  const empty = { user: currentUser, groups: [], expenses: [], warnings: [] };
  if (!groupIds.length) return empty;

  const [groupsResult, rosterResult, expensesResult] = await Promise.all([
    supabase
      .from("Group")
      .select("groupId, name, createdAt, createdBy, isArchived")
      .in("groupId", groupIds)
      .order("createdAt", { ascending: false }),
    supabase.from("Group_Member").select("groupId, userId").in("groupId", groupIds),
    supabase
      .from("Expense")
      .select("expenseId, groupId, paidBy_UserId, title, totalAmount, category, expenseDate")
      .in("groupId", groupIds)
      .order("expenseDate", { ascending: false }),
  ]);
  if (groupsResult.error) throw new Error(groupsResult.error.message);

  const warnings: string[] = [];
  if (rosterResult.error) warnings.push(`Group members unavailable: ${rosterResult.error.message}`);
  if (expensesResult.error) warnings.push(`Expenses unavailable: ${expensesResult.error.message}`);

  const rosterRows = (rosterResult.data ?? []) as Array<{ groupId: string; userId: string }>;
  const expenseRows = (expensesResult.data ?? []) as ExpenseRow[];
  const peopleIds = [
    ...new Set([me.id, ...rosterRows.map((row) => row.userId), ...expenseRows.map((row) => row.paidBy_UserId)]),
  ];

  const [usersResult, splitsResult] = await Promise.all([
    inChunks<{ userId: string; name: string | null }>(peopleIds, (chunk) =>
      supabase.from("User").select("userId, name").in("userId", chunk),
    ),
    inChunks<SplitRow>(
      expenseRows.map((row) => row.expenseId),
      (chunk) =>
        supabase
          .from("Expense_Split")
          .select("expenseId, userId, amountOwed, percentage")
          .in("expenseId", chunk),
    ),
  ]);
  if (splitsResult.error) warnings.push(`Expense participants unavailable: ${splitsResult.error.message}`);

  const names = new Map<string, string>();
  for (const row of usersResult.data) {
    const name = String(row.name ?? "").trim();
    if (name) names.set(row.userId, name);
  }
  names.set(me.id, myName);
  const nameOf = (id: string) => (id === me.id ? "You" : names.get(id) || "Group member");

  const membersByGroup = new Map<string, Set<string>>();
  for (const row of rosterRows) {
    const set = membersByGroup.get(row.groupId) ?? new Set<string>();
    set.add(row.userId);
    membersByGroup.set(row.groupId, set);
  }
  const splitsByExpense = new Map<string, SplitRow[]>();
  for (const row of splitsResult.data) {
    const list = splitsByExpense.get(row.expenseId) ?? [];
    list.push(row);
    splitsByExpense.set(row.expenseId, list);
  }

  const groupName = new Map<string, string>(
    (groupsResult.data ?? []).map((group: { groupId: string; name: string }) => [group.groupId, group.name]),
  );

  // Turn each expense into ledger form using its real participants.
  let missingParticipants = 0;
  const ledgerByGroup = new Map<string, LedgerExpense[]>();
  const history: HistoryExpense[] = [];
  for (const row of expenseRows) {
    const totalCents = Math.round((Number(row.totalAmount) || 0) * 100);
    let shares = sharesFromSplitRows(totalCents, splitsByExpense.get(row.expenseId) ?? []);
    if (!shares.length) {
      // Older expenses saved without participants: assume everyone, and say so.
      missingParticipants += 1;
      shares = sharesFromSplitRows(
        totalCents,
        [...(membersByGroup.get(row.groupId) ?? [])].map((userId) => ({ expenseId: row.expenseId, userId })),
      );
    }
    const entry: LedgerExpense = {
      id: row.expenseId,
      groupId: row.groupId,
      payerId: row.paidBy_UserId,
      totalCents,
      shares,
    };
    const list = ledgerByGroup.get(row.groupId) ?? [];
    list.push(entry);
    ledgerByGroup.set(row.groupId, list);

    const myShare = shares.find((share) => share.userId === me.id)?.cents ?? 0;
    history.push({
      id: row.expenseId,
      groupId: row.groupId,
      groupName: groupName.get(row.groupId) ?? "Group",
      title: row.title,
      amount: toPesos(totalCents),
      category: categoryKey(row.category),
      date: row.expenseDate,
      payerId: row.paidBy_UserId,
      payerName: nameOf(row.paidBy_UserId),
      yourShare: toPesos(myShare),
      involvesYou: myShare > 0 || row.paidBy_UserId === me.id,
    });
  }
  if (missingParticipants)
    console.warn(
      `${missingParticipants} expense(s) have no participant rows; split among all members.`,
    );

  const now = new Date();
  const monthStart = startOfMonth(now);
  const weekStart = startOfWeek(now);

  const groups: GroupSummary[] = (groupsResult.data ?? []).map(
    (group: { groupId: string; name: string; createdAt: string; createdBy: string; isArchived: boolean }) => {
      const expenses = ledgerByGroup.get(group.groupId) ?? [];
      const ledger = buildLedger(expenses);
      const mine = ledger.forUser(me.id);
      const nets = [...ledger.memberNets().values()];
      const groupHistory = history.filter((item) => item.groupId === group.groupId);

      let spent = 0;
      let spentThisMonth = 0;
      let spentThisWeek = 0;
      for (const item of groupHistory) {
        spent += item.amount;
        const time = new Date(item.date).getTime();
        if (time >= monthStart) spentThisMonth += item.amount;
        if (time >= weekStart) spentThisWeek += item.amount;
      }

      return {
        id: group.groupId,
        name: group.name,
        createdAt: group.createdAt,
        isCreator: group.createdBy === me.id,
        isArchived: Boolean(group.isArchived),
        // An archived group is Settled only when every member's net is zero.
        status: group.isArchived ? (nets.every((net) => net === 0) ? "settled" : "unsettled") : "active",
        members: membersByGroup.get(group.groupId)?.size || 1,
        owedToYou: toPesos(mine.owedToYou),
        youOwe: toPesos(mine.youOwe),
        net: toPesos(mine.net),
        counterparties: mine.counterparties.map((item) => ({
          userId: item.userId,
          name: nameOf(item.userId),
          amount: toPesos(item.cents),
        })),
        spent,
        expenseCount: groupHistory.length,
        spentThisMonth,
        spentThisWeek,
        lastActivityAt: groupHistory[0]?.date ?? null,
      } satisfies GroupSummary;
    },
  );

  return { user: currentUser, groups, expenses: history, warnings };
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
