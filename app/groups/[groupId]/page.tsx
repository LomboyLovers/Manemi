"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import "./group-details.css";
import GroupDetailsSkeleton from "@/components/GroupDetailsSkeleton";
import AppNav from "@/components/AppNav";
import DirectionIcon from "@/components/DirectionIcon";
import InviteFriendsSheet from "@/components/InviteFriendsSheet";
import LeaveGroupDialog from "@/components/LeaveGroupDialog";
import SettleUpSheet from "@/components/SettleUpSheet";
import CategoryIcon from "@/components/CategoryIcon";
import Pagination from "@/components/Pagination";
import Icon from "@/components/Icon";
import { notifyDataChanged, useDataVersion } from "@/lib/manemi/events";
import { CATEGORY_META, categoryKey, CURRENCIES, isZero, money, peso } from "@/lib/manemi/format";
import { receiptLink } from "@/lib/manemi/functions";
import { cleanError } from "@/lib/manemi/friends";
import { editedLabel, latestEdits, type EditRow, type LastEdit } from "@/lib/manemi/edits";
import { timeAgo } from "@/lib/manemi/notifications";
import RawBreakdown from "@/components/RawBreakdown";
import Avatar from "@/components/Avatar";
import ConfirmDialog from "@/components/ConfirmDialog";
import MembersSheet, { type MemberRow } from "@/components/MembersSheet";
import PaymentsList, { type PaymentRow } from "@/components/PaymentsList";
import { buildLedger, groupRawItems, paymentEntry, rawItemsFor, sharesFromSplitRows, type RawSource } from "@/lib/manemi/ledger";

type Group = {
  groupId: string;
  name: string;
  createdBy: string;
  isArchived?: boolean | null;
};

type GroupMember = {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  /** GROUP-03: shown next to the name so everyone can tell who runs the group. */
  role?: "owner" | "admin" | "member";
  userCode?: string | null;
};
type ExpenseSplit = {
  expenseId: string;
  userId: string;
  amountOwed: number | string | null;
  percentage: number | string | null;
};

type Expense = {
  expenseId: string;
  paidBy_UserId: string;
  title: string;
  totalAmount: number;
  expenseDate: string;
  category: string | null;
  receiptUrl: string | null;
  /** PHP unless set; only PHP expenses count toward balances. */
  currency?: string | null;
};

const formatPeso = peso;

export default function GroupDetailsPage() {
  const params = useParams<{ groupId: string }>();
  const router = useRouter();

  const [group, setGroup] = useState<Group | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  // When each expense was added (from the audit log), for "newest first".
  const [addedAt, setAddedAt] = useState<Map<string, string>>(new Map());
  const [edits, setEdits] = useState<Map<string, LastEdit>>(new Map());
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [myRole, setMyRole] = useState<"owner" | "admin" | "member">("member");
  // Completed settle-ups: they cancel the debts they pay back.
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptState, setReceiptState] = useState<"idle" | "loading" | "error">("idle");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [expenseSplits, setExpenseSplits] = useState<ExpenseSplit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  // null = closed, "" = open on the list, userId = open on that person
  const [settleWith, setSettleWith] = useState<string | null>(null);
  const dataVersion = useDataVersion();
  const [activeCategory, setActiveCategory] = useState("All");
  const [expensePage, setExpensePage] = useState(1);
  const EXPENSES_PER_PAGE = 10;
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingExpense, setDeletingExpense] = useState(false);
  const [expenseActionError, setExpenseActionError] = useState("");
  const [expenseNotice, setExpenseNotice] = useState("");
  const [addedExpense, setAddedExpense] = useState<Expense | null>(null);
  const [expenseSheetClosing, setExpenseSheetClosing] = useState(false);
  const [activeTab, setActiveTab] = useState<"expenses" | "balances">(
    "expenses",
  );
  const [balanceError, setBalanceError] = useState("");

  // Skeleton only for the first load of a group; refreshes (after a payment,
  // a delete, ...) update in place instead of flashing the skeleton.
  const loadedGroupRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadGroup() {
      if (loadedGroupRef.current !== params.groupId) setLoading(true);
      setError("");

      const supabase = createClient();

      // Local session read (no auth round trip); the queries below are still
      // checked by the database with this session's token.
      const { data: sessionData, error: authError } = await supabase.auth.getSession();
      const auth = { user: sessionData.session?.user ?? null };

      if (!active) return;

      if (authError || !auth.user) {
        setError("Please log in to view this group.");
        setLoading(false);
        return;
      }

      const me = auth.user;
      setCurrentUserId(me.id);

      // Everything below only needs the group ID, so load it in parallel.
      // The roster doubles as the membership check.
      const [groupResult, rosterResult, expenseResult, paymentResult, addedResult] =
        await Promise.all([
          supabase
            .from("Group")
            .select("groupId, name, createdBy, isArchived")
            .eq("groupId", params.groupId)
            .maybeSingle(),
          supabase
            .from("Group_Member")
            .select("userId, role")
            .eq("groupId", params.groupId),
          supabase
            .from("Expense")
            .select(
              "expenseId, paidBy_UserId, title, totalAmount, expenseDate, category, receiptUrl, currency",
            )
            .eq("groupId", params.groupId)
            .order("expenseDate", { ascending: false }),
          supabase
            .from("Settlement")
            .select("settlementId, payerId, receiverId, amount, paymentMethod, settledAt, createdAt")
            .eq("groupId", params.groupId)
            .eq("status", "completed"),
          supabase
            .from("Group_Activity")
            .select("entityId, actorId, action, createdAt")
            .eq("groupId", params.groupId)
            .in("action", ["expense_created", "expense_updated"]),
        ]);

      if (!active) return;

      const activityRows = (addedResult.data ?? []) as Array<EditRow>;
      setAddedAt(
        new Map(
          activityRows
            .filter((row) => row.action === "expense_created")
            .map((row) => [String(row.entityId), String(row.createdAt)]),
        ),
      );
      setEdits(latestEdits(activityRows));

      const { data: memberRows, error: memberError } = rosterResult;
      if (memberError) {
        setError(`Unable to load group members: ${memberError.message}`);
        setLoading(false);
        return;
      }
      setMyRole(
        ((memberRows ?? []).find((row) => row.userId === me.id)?.role as
          | "owner"
          | "admin"
          | "member"
          | undefined) ?? "member",
      );
      const memberIds = [
        ...new Set((memberRows ?? []).map((row) => row.userId as string)),
      ];
      if (!memberIds.includes(me.id)) {
        setError("Group not found or you do not have access.");
        setLoading(false);
        return;
      }

      const { data, error: queryError } = groupResult;
      if (queryError || !data) {
        setError(queryError?.message || "Group not found or you do not have access.");
        setLoading(false);
        return;
      }
      setGroup(data);

      setPayments(paymentResult.data ?? []);
      const expenseData = expenseResult.data;
      const expenseIds = (expenseData ?? []).map((item) => item.expenseId);

      // Names and split participants depend on the results above.
      const [usersResult, splitsResult] = await Promise.all([
        memberIds.length
          ? supabase.from("User").select("userId, name, avatarUrl, userCode").in("userId", memberIds)
          : Promise.resolve({ data: [], error: null }),
        expenseIds.length
          ? supabase
              .from("Expense_Split")
              .select("expenseId, userId, amountOwed, percentage")
              .in("expenseId", expenseIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (!active) return;

      let namesById = new Map<string, string>();
      const avatarsById = new Map<string, string | null>();
      const codesById = new Map<string, string | null>();
      const rolesById = new Map(
        (memberRows ?? []).map((row) => [row.userId as string, String(row.role) as GroupMember["role"]]),
      );
      if (usersResult.error) {
        console.warn("Unable to load member names:", usersResult.error.message);
      } else {
        namesById = new Map(
          (usersResult.data ?? []).map((user) => [
            user.userId as string,
            String(user.name || "").trim(),
          ]),
        );
        for (const user of usersResult.data ?? []) {
          avatarsById.set(user.userId as string, (user.avatarUrl as string | null) ?? null);
          codesById.set(user.userId as string, (user.userCode as string | null) ?? null);
        }
      }
      setMembers(
        memberIds.map((id) => ({
          userId: id,
          avatarUrl: avatarsById.get(id) ?? null,
          role: rolesById.get(id) ?? "member",
          userCode: codesById.get(id) ?? null,
          name:
            namesById.get(id) ||
            (id === me.id
              ? String(
                  me.user_metadata?.full_name ||
                    me.email?.split("@")[0] ||
                    "You",
                )
              : "Unknown member"),
        })),
      );

      if (expenseResult.error) {
        console.error("Failed to load expenses:", expenseResult.error.message);
        setError("Unable to load group expenses.");
      } else {
        setExpenses(expenseData ?? []);
        setBalanceError(
          splitsResult.error
            ? "Balances are unavailable: expense participants couldn't be loaded."
            : "",
        );
        if (splitsResult.error) {
          console.warn(
            "Unable to load expense participants:",
            splitsResult.error.message,
          );
          setExpenseSplits([]);
        } else {
          setExpenseSplits((splitsResult.data ?? []) as ExpenseSplit[]);
        }
        // Read the saved expense ID after returning from Add Expense.
        // Match it against the database result, not a hardcoded title/amount.
        const paramsFromUrl = new URLSearchParams(window.location.search);
        // History links here with ?expense=<id> to open that expense.
        const openId = paramsFromUrl.get("expense");
        if (openId) {
          const target = (expenseData ?? []).find(
            (item) => item.expenseId === openId,
          );
          if (target) setSelectedExpense(target);
          paramsFromUrl.delete("expense");
        }
        const addedId = paramsFromUrl.get("expenseAdded");
        if (addedId) {
          const match = (expenseData ?? []).find(
            (item) => item.expenseId === addedId,
          );
          if (match) {
            setAddedExpense(match);
            setExpenseNotice("");
          }
          paramsFromUrl.delete("expenseAdded");
        }
        if (openId || addedId) {
          const remaining = paramsFromUrl.toString();
          window.history.replaceState(
            window.history.state,
            "",
            `${window.location.pathname}${remaining ? `?${remaining}` : ""}${window.location.hash}`,
          );
        }
      }

      // Groups page → Leave Group → "Settle Debts" lands here with ?settle=1.
      const query = new URLSearchParams(window.location.search);
      if (query.get("settle")) {
        setSettleWith("");
        query.delete("settle");
        const rest = query.toString();
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
      }

      loadedGroupRef.current = params.groupId;
      setLoading(false);
    }

    void loadGroup();

    return () => {
      active = false;
    };
  }, [params.groupId, dataVersion]);

  const canInvite =
    Boolean(group) && !group?.isArchived && (myRole === "owner" || myRole === "admin");

  // Balances from each expense's real participants (see lib/manemi/ledger).
  // The same entries feed the raw breakdown, so both always agree.
  const ledgerEntries = useMemo((): RawSource[] => {
    const splitsByExpense = new Map<string, ExpenseSplit[]>();
    for (const split of expenseSplits) {
      const list = splitsByExpense.get(split.expenseId) ?? [];
      list.push(split);
      splitsByExpense.set(split.expenseId, list);
    }
    const paid = payments
      .map((payment) => ({
        ...paymentEntry(
          payment.settlementId,
          payment.payerId,
          payment.receiverId,
          Math.round(Number(payment.amount) * 100) || 0,
          params.groupId,
        ),
        kind: "payment" as const,
        title: "Payment",
        date: String(payment.settledAt ?? payment.createdAt ?? ""),
      }))
      .filter((entry) => entry.totalCents > 0);
    return [
      ...paid,
      ...expenses.filter((expense) => (expense.currency ?? "PHP") === "PHP").map((expense) => {
        const totalCents = Math.round(Number(expense.totalAmount) * 100) || 0;
        let shares = sharesFromSplitRows(
          totalCents,
          splitsByExpense.get(expense.expenseId) ?? [],
        );
        if (!shares.length) {
          // Older expenses without participant rows: everyone in the group.
          shares = sharesFromSplitRows(
            totalCents,
            members.map((member) => ({
              expenseId: expense.expenseId,
              userId: member.userId,
            })),
          );
        }
        return {
          id: expense.expenseId,
          groupId: params.groupId,
          payerId: expense.paidBy_UserId,
          totalCents,
          shares,
          kind: "expense" as const,
          title: expense.title,
          date: expense.expenseDate,
        };
      }),
    ];
  }, [expenses, expenseSplits, members, payments, params.groupId]);
  const ledger = useMemo(() => buildLedger(ledgerEntries), [ledgerEntries]);
  const rawPeople = useMemo(
    () => (currentUserId ? groupRawItems(rawItemsFor(currentUserId, ledgerEntries)) : []),
    [currentUserId, ledgerEntries],
  );

  const myBalance = currentUserId ? ledger.forUser(currentUserId) : null;
  const myNet = balanceError || !myBalance ? null : myBalance.net / 100;
  const memberNets = useMemo(() => ledger.memberNets(), [ledger]);
  const memberBalances = members.map((member) => ({
    userId: member.userId,
    net: (memberNets.get(member.userId) ?? 0) / 100,
  }));

  // Toasts dismiss themselves after a few seconds.
  useEffect(() => {
    if (!expenseNotice && !addedExpense) return;
    const timer = window.setTimeout(() => {
      setExpenseNotice("");
      setAddedExpense(null);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [expenseNotice, addedExpense]);

  const openExpenseDetails = (expense: Expense) => {
    setSelectedExpense(expense);
    setShowDeleteConfirm(false);
    setExpenseSheetClosing(false);
    setExpenseActionError("");
  };

  const closeExpenseDetails = () => {
    setExpenseSheetClosing(true);

    window.setTimeout(() => {
      setSelectedExpense(null);
      setShowDeleteConfirm(false);
      setExpenseSheetClosing(false);
      setExpenseActionError("");
    }, 220);
  };

  const deleteSelectedExpense = async () => {
    if (!selectedExpense || deletingExpense) return;

    setDeletingExpense(true);
    setExpenseActionError("");

    try {
      const supabase = createClient();

      const { data, error } = await supabase.functions.invoke(
        "delete-expense",
        {
          method: "POST",
          body: { expenseId: selectedExpense.expenseId },
        },
      );

      if (error) {
        let message = error.message;

        if (error.context instanceof Response) {
          const responseBody = await error.context.json().catch(() => null);

          message = responseBody?.error ?? message;
        }

        throw new Error(message);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      if (data?.expenseId !== selectedExpense.expenseId) {
        throw new Error("Unable to verify the deletion.");
      }

      const deletedTitle = selectedExpense.title;

      setShowDeleteConfirm(false);
      setSelectedExpense(null);
      setExpenseSheetClosing(false);
      notifyDataChanged(); // reloads this page and clears cached totals
      setExpenseNotice(`Deleted "${deletedTitle}" successfully.`);
    } catch (error) {
      setExpenseActionError(
        error instanceof Error ? error.message : "Unable to delete expense.",
      );
    } finally {
      setDeletingExpense(false);
    }
  };

  const openAddExpense = () => {
    router.push(`/groups/${params.groupId}/add-expense`);
  };

  // Each currency is totalled on its own; the summary's headline and stats are pesos.
  const totalsByCurrency = expenses.reduce((map, expense) => {
    const code = String(expense.currency ?? "PHP");
    const entry = map.get(code) ?? { cents: 0, count: 0 };
    entry.cents += Math.round(Number(expense.totalAmount) * 100) || 0;
    entry.count += 1;
    map.set(code, entry);
    return map;
  }, new Map<string, { cents: number; count: number }>());
  const pesoTotals = totalsByCurrency.get("PHP") ?? { cents: 0, count: 0 };
  const totalExpenses = pesoTotals.cents / 100;
  const transactionCount = pesoTotals.count;
  // Other currencies used in this group, in the app's currency order; none = nothing shown.
  const otherCurrencyTotals = CURRENCIES.filter((item) => item.code !== "PHP" && totalsByCurrency.has(item.code)).map(
    (item) => ({ code: item.code, label: item.label, ...totalsByCurrency.get(item.code)! }),
  );
  const categories = [
    "All",
    ...Array.from(
      new Set(expenses.map((expense) => expense.category).filter(Boolean)),
    ),
  ] as string[];

  // Newest first: the most recently added expense is at the top (expenses
  // from before the audit log fall back to their date).
  const newestFirst = useMemo(() => {
    const key = (expense: Expense) => new Date(addedAt.get(expense.expenseId) ?? expense.expenseDate).getTime() || 0;
    return [...expenses].sort((a, b) => key(b) - key(a));
  }, [expenses, addedAt]);
  const filteredExpenses =
    activeCategory === "All"
      ? newestFirst
      : newestFirst.filter((expense) => expense.category === activeCategory);
  // Stay on a real page after deletes shrink the list.
  const expensePageNow = Math.min(
    expensePage,
    Math.max(1, Math.ceil(filteredExpenses.length / EXPENSES_PER_PAGE)),
  );

  const categoryIcon = (category: string | null, size = 22) => (
    <CategoryIcon name={categoryKey(category)} size={size} />
  );

  const memberCount = members.length;

  const memberName = (id: string) =>
    members.find((member) => member.userId === id)?.name || "Unknown member";
  const editedBy = (expenseId: string) =>
    editedLabel(edits.get(expenseId), currentUserId, (id) => members.find((member) => member.userId === id)?.name ?? null);
  const memberAvatar = (id: string) => members.find((member) => member.userId === id)?.avatarUrl ?? null;

  // People you owe in this group, largest first (for Settle Debts).
  const myDebts = (myBalance?.counterparties ?? [])
    .filter((item) => item.cents < 0)
    .map((item) => ({ userId: item.userId, name: memberName(item.userId), cents: -item.cents }));
  const canAct = Boolean(group) && !group?.isArchived;
  const isOwner = myRole === "owner";
  const canManage = myRole === "owner" || myRole === "admin";

  // People you owe first (largest first), then people who owe you.
  const myPeople = [...(myBalance?.counterparties ?? [])].sort(
    (a, b) => Number(a.cents > 0) - Number(b.cents > 0) || Math.abs(b.cents) - Math.abs(a.cents),
  );

  // Your share of one expense (cents) from its split rows.
  const splitsByExpense = useMemo(() => {
    const map = new Map<string, ExpenseSplit[]>();
    for (const split of expenseSplits) {
      const list = map.get(split.expenseId) ?? [];
      list.push(split);
      map.set(split.expenseId, list);
    }
    return map;
  }, [expenseSplits]);
  const involvement = (expense: Expense) => {
    const total = Math.round(Number(expense.totalAmount) * 100) || 0;
    const shares = sharesFromSplitRows(total, splitsByExpense.get(expense.expenseId) ?? []);
    const mine = shares.find((share) => share.userId === currentUserId)?.cents ?? 0;
    if (expense.paidBy_UserId === currentUserId) {
      const collectible = total - mine;
      return collectible > 0
        ? { tone: "positive" as const, label: "Total collectible", cents: collectible, total }
        : { tone: "muted" as const, label: "Only you", cents: 0, total };
    }
    return mine > 0
      ? { tone: "negative" as const, label: "You owe", cents: mine, total }
      : { tone: "muted" as const, label: "Not involved", cents: 0, total };
  };

  async function saveName() {
    if (!group) return;
    const name = nameDraft.trim();
    if (!name) {
      setRenameError("Enter a group name.");
      return;
    }
    if (name === group.name) {
      setRenaming(false);
      return;
    }
    const { error: rpcError } = await createClient().rpc("rename_group", { p_group_id: group.groupId, p_name: name });
    if (rpcError) {
      setRenameError(cleanError(rpcError, "Couldn't rename the group."));
      return;
    }
    setGroup({ ...group, name });
    setRenaming(false);
    setRenameError("");
    notifyDataChanged();
  }

  // Receipt: a short-lived signed link, only for group members.
  useEffect(() => {
    setReceiptUrl(null);
    setReceiptState("idle");
    if (!selectedExpense?.receiptUrl) return;
    let active = true;
    setReceiptState("loading");
    receiptLink(selectedExpense.receiptUrl)
      .then((url) => {
        if (!active) return;
        setReceiptUrl(url);
        setReceiptState(url ? "idle" : "error");
      })
      .catch(() => active && setReceiptState("error"));
    return () => {
      active = false;
    };
  }, [selectedExpense]);

  const splitBetween = (expenseId: string) => {
    const participantIds = [
      ...new Set(
        expenseSplits
          .filter((split) => split.expenseId === expenseId)
          .map((split) => split.userId),
      ),
    ];
    if (!participantIds.length) return "Participants unavailable";
    // Everyone means every CURRENT group member participates.
    if (
      members.length > 0 &&
      participantIds.length === members.length &&
      members.every((member) => participantIds.includes(member.userId))
    ) {
      return "Everyone";
    }
    return participantIds.map(memberName).join(", ");
  };

  const averagePerPerson = memberCount > 0 ? totalExpenses / memberCount : 0;

  return (
    <main className="manemi-detail-page mn-app-page">
      <div className="md-container">
      <div className="manemi-detail-content">
        <header className="md-topbar">
          <Link href="/groups" className="md-back">
            <span aria-hidden="true">‹</span> Groups
          </Link>

          <div className="md-top-actions">
            {canInvite && (
              <button
                type="button"
                className="md-invite-button"
                onClick={() => setInviteOpen(true)}
              >
                <span aria-hidden="true">＋</span> Invite Friends
              </button>
            )}

            <div className="md-menu-wrap">
              <button
                type="button"
                aria-label="Group options"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(!menuOpen)}
              >
                •••
              </button>

              {menuOpen && (
                <div className="md-menu" role="menu">
                  {group && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setMembersOpen(true);
                      }}
                    >
                      Members ({members.length})
                    </button>
                  )}
                  {group && !group.isArchived && (
                    <button
                      type="button"
                      role="menuitem"
                      aria-disabled={!canInvite || undefined}
                      aria-describedby={canInvite ? undefined : "md-invite-note"}
                      className={canInvite ? "" : "md-menu-disabled"}
                      onClick={() => {
                        if (!canInvite) return;
                        setMenuOpen(false);
                        setInviteOpen(true);
                      }}
                    >
                      Invite Friends
                    </button>
                  )}
                  {group && isOwner && !group.isArchived && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setNameDraft(group.name);
                        setRenameError("");
                        setRenaming(true);
                      }}
                    >
                      Rename Group
                    </button>
                  )}
                  {group && myRole !== "owner" && (
                    <button
                      type="button"
                      role="menuitem"
                      className="md-menu-danger"
                      onClick={() => {
                        setMenuOpen(false);
                        setLeaveOpen(true);
                      }}
                    >
                      Leave Group
                    </button>
                  )}
                  {!canInvite && group && !group.isArchived && (
                    <p className="md-menu-note" id="md-invite-note">
                      Only the owner or an admin can invite people.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {settleWith !== null && group && (
          <SettleUpSheet
            groupId={group.groupId}
            groupName={group.name}
            debts={myDebts}
            initialReceiverId={settleWith || undefined}
            onClose={() => setSettleWith(null)}
            onRecorded={(message) => {
              setSettleWith(null);
              setExpenseNotice(message);
              setActiveTab("balances");
            }}
          />
        )}

        {membersOpen && group && (
          <MembersSheet
            groupName={group.name}
            meId={currentUserId}
            myRole={myRole}
            archived={Boolean(group.isArchived)}
            members={members.map(
              (member): MemberRow => ({
                userId: member.userId,
                name: member.name,
                avatarUrl: member.avatarUrl ?? null,
                role: member.role ?? "member",
                userCode: member.userCode ?? null,
                net: (memberNets.get(member.userId) ?? 0) / 100,
              }),
            )}
            onClose={() => setMembersOpen(false)}
            onRemove={async (member) => {
              const { error: rpcError } = await createClient().rpc("remove_group_member", {
                p_group_id: group.groupId,
                p_user_id: member.userId,
              });
              if (rpcError) throw new Error(cleanError(rpcError, "Couldn't remove them."));
              notifyDataChanged();
            }}
          />
        )}

        {removing && group && (
          <ConfirmDialog
            title={`Remove ${removing.name} from “${group.name}”?`}
            confirmLabel="Remove member"
            destructive
            onClose={() => setRemoving(null)}
            onConfirm={async () => {
              const { error: rpcError } = await createClient().rpc("remove_group_member", {
                p_group_id: group.groupId,
                p_user_id: removing.userId,
              });
              if (rpcError) throw new Error(cleanError(rpcError, "Couldn't remove them."));
              setExpenseNotice(`Removed ${removing.name} from the group.`);
              setRemoving(null);
              notifyDataChanged();
            }}
          >
            <p>
              They&apos;ll lose access to this group. Expenses and payments they were part of stay in the
              history. You can invite them again later.
            </p>
          </ConfirmDialog>
        )}

        {leaveOpen && group && (
          <LeaveGroupDialog
            groupId={group.groupId}
            groupName={group.name}
            balances={(myBalance?.counterparties ?? []).map((item) => ({
              userId: item.userId,
              name: memberName(item.userId),
              amount: item.cents / 100,
            }))}
            onSettle={() => {
              setLeaveOpen(false);
              setSettleWith("");
            }}
            onClose={() => setLeaveOpen(false)}
            onLeft={() => router.replace("/groups")}
          />
        )}

        {loading ? (
          <GroupDetailsSkeleton />
        ) : error ? (
          <div className="md-state" role="alert">
            {error}
            <p>
              <Link href="/groups">Return to Groups</Link>
            </p>
          </div>
        ) : (
          group && (
            <>
              <section className="md-group-heading">
                <div className="md-group-icon" aria-hidden="true">
                  <Icon name="users" size={28} />
                </div>

                <div className="md-heading-text">
                  {renaming ? (
                    <form
                      className="md-rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveName();
                      }}
                    >
                      <label htmlFor="md-rename-input" className="mn-visually-hidden">
                        Group name
                      </label>
                      <input
                        id="md-rename-input"
                        autoFocus
                        maxLength={50}
                        value={nameDraft}
                        aria-invalid={Boolean(renameError)}
                        aria-describedby={renameError ? "md-rename-error" : "md-rename-hint"}
                        onChange={(event) => {
                          setNameDraft(event.target.value);
                          setRenameError("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setRenaming(false);
                            setRenameError("");
                          }
                        }}
                        onBlur={() => void saveName()}
                      />
                      <span id="md-rename-hint" className="mn-visually-hidden">
                        Enter saves, Escape cancels
                      </span>
                    </form>
                  ) : (
                    <h1>{group.name}</h1>
                  )}
                  {renameError && (
                    <p id="md-rename-error" className="md-rename-error" role="alert">
                      {renameError}
                    </p>
                  )}
                  <p>
                    {memberCount} member
                    {memberCount !== 1 ? "s" : ""} ·{" "}
                    <span className="md-admin">
                      {myRole === "owner" ? "Owner" : myRole === "admin" ? "Admin" : "Member"}
                    </span>
                  </p>
                </div>
              </section>

              <section className="md-summary">
                <p className="md-eyebrow">GROUP SUMMARY · TOTAL EXPENSES</p>

                <strong className="md-total">
                  {formatPeso(totalExpenses)}
                </strong>

                {otherCurrencyTotals.length > 0 && (
                  <div className="md-currency-block">
                    <p className="md-currency-heading" id="md-currency-heading">
                      Other currencies <span>· not in peso balances</span>
                    </p>
                    <ul className="md-currency-totals" aria-labelledby="md-currency-heading">
                      {otherCurrencyTotals.map((item) => (
                        <li key={item.code} title={item.label}>
                          <span className="md-currency-code">{item.code}</span>
                          <span className="md-currency-text">
                            <strong>{money(item.cents / 100, item.code)}</strong>
                            <small>
                              {item.count} {item.count === 1 ? "transaction" : "transactions"}
                            </small>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="md-stats">
                  <div>
                    <strong>{transactionCount}</strong>
                    <span>Transactions</span>
                  </div>

                  <div>
                    <strong>{memberCount}</strong>
                    <span>{memberCount === 1 ? "Member" : "Members"}</span>
                  </div>

                  <div>
                    <strong>{formatPeso(averagePerPerson)}</strong>
                    <span>Avg / person</span>
                  </div>
                </div>

                {(() => {
                  const tone =
                    myNet === null
                      ? { cls: "md-balance-unknown", icon: "?", text: "Balance unavailable" }
                      : isZero(myNet)
                        ? { cls: "md-balance-zero", icon: <DirectionIcon dir="done" />, text: "Settled up" }
                        : myNet > 0
                          ? { cls: "md-balance-positive", icon: <DirectionIcon dir="in" />, text: "You're owed" }
                          : { cls: "md-balance-negative", icon: <DirectionIcon dir="out" />, text: "You owe" };
                  return (
                    <div className={`md-settled ${tone.cls}`}>
                      <span className="md-settled-icon" aria-hidden="true">
                        {tone.icon}
                      </span>
                      <div>
                        <small>Your balance</small>
                        <strong>
                          {myNet === null
                            ? balanceError || tone.text
                            : `${tone.text} · ${formatPeso(Math.abs(myNet))}`}
                        </strong>
                      </div>
                    </div>
                  );
                })()}

                {myPeople.length > 0 && (
                  <ul className="md-people" aria-label="Who you owe and who owes you">
                    {myPeople.map((item) => {
                      const name = memberName(item.userId);
                      const owesYou = item.cents > 0;
                      return (
                        <li key={item.userId} className={owesYou ? "is-positive" : "is-negative"}>
                          <span className="md-people-avatar" aria-hidden="true">
                            <Avatar name={name} url={memberAvatar(item.userId)} />
                          </span>
                          <span className="md-people-name">{owesYou ? `${name} owes you` : `You owe ${name}`}</span>
                          <strong>{formatPeso(Math.abs(item.cents) / 100)}</strong>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {myPeople.length > 0 && <RawBreakdown people={rawPeople} nameOf={memberName} />}


                {canAct && (
                  <div className="md-actions">
                    <button type="button" className="md-action-primary" onClick={openAddExpense}>
                      <span aria-hidden="true">＋</span> Add Expense
                    </button>
                    <button
                      type="button"
                      className="md-action-secondary"
                      onClick={() => setSettleWith("")}
                      disabled={myNet === null || myDebts.length === 0}
                      title={myDebts.length === 0 ? "You don't owe anyone in this group" : undefined}
                    >
                      <span aria-hidden="true">⇄</span> Settle Debts
                    </button>
                  </div>
                )}
              </section>

              {transactionCount === 0 ? (
                <section className="md-first-expense">
                  <div className="md-first-icon">▤</div>

                  <h2>No expenses yet</h2>

                  <p>
                    Add the first expense and Manemi will work out who owes
                    whom.
                  </p>

                  <button
                    type="button"
                    className="md-add-first"
                    onClick={openAddExpense}
                  >
                    <span aria-hidden="true">＋</span>
                    Add First Expense
                  </button>

                  {canInvite && (
                    <button
                      type="button"
                      className="md-invite-members"
                      onClick={() => setInviteOpen(true)}
                    >
                      <span aria-hidden="true">＋</span> Invite Friends
                    </button>
                  )}
                </section>
              ) : (
                <section className="md-expenses-section">
                  <div className="md-tabs" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTab === "expenses"}
                      className={activeTab === "expenses" ? "active" : ""}
                      onClick={() => setActiveTab("expenses")}
                    >
                      Expenses
                    </button>

                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTab === "balances"}
                      className={activeTab === "balances" ? "active" : ""}
                      onClick={() => setActiveTab("balances")}
                    >
                      Balances
                    </button>
                  </div>

                  {activeTab === "balances" ? (
                    <div role="tabpanel" className="md-balances-panel">
                      {balanceError ? (
                        <p className="md-no-transactions">{balanceError}</p>
                      ) : (
                        <>
                          <h2 className="md-balances-heading">Your breakdown</h2>
                          <div className="md-balances">
                            {myBalance && myBalance.counterparties.length ? (
                              myBalance.counterparties.map((item) => {
                                const name = memberName(item.userId);
                                const owesYou = item.cents > 0;
                                return (
                                  <div
                                    key={item.userId}
                                    className={`md-balance-row ${owesYou ? "md-balance-positive" : "md-balance-negative"}`}
                                  >
                                    <span className="md-balance-avatar" aria-hidden="true">
                                      <Avatar name={name} url={memberAvatar(item.userId)} />
                                    </span>
                                    <div className="md-balance-name">
                                      <strong>
                                        {owesYou ? `${name} owes you` : `You owe ${name}`}
                                      </strong>
                                      <small>
                                        {owesYou ? (
                                          <>
                                            <DirectionIcon dir="in" /> Owed to you
                                          </>
                                        ) : (
                                          <>
                                            <DirectionIcon dir="out" /> Your debt
                                          </>
                                        )}
                                      </small>
                                    </div>
                                    <strong className="md-balance-amount">
                                      {formatPeso(Math.abs(item.cents) / 100)}
                                    </strong>
                                    {!owesYou && canAct && (
                                      <button
                                        type="button"
                                        className="md-balance-pay"
                                        aria-label={`Settle up with ${name}`}
                                        onClick={() => setSettleWith(item.userId)}
                                      >
                                        Settle
                                      </button>
                                    )}
                                  </div>
                                );
                              })
                            ) : (
                              <p className="md-balances-empty">
                                <DirectionIcon dir="done" /> You&apos;re square with everyone in this group.
                              </p>
                            )}
                          </div>

                          <h2 className="md-balances-heading">Members · {members.length}</h2>
                          <div className="md-balances">
                            {[...memberBalances]
                              .sort((a, b) => b.net - a.net)
                              .map((member) => {
                                const isMe = member.userId === currentUserId;
                                const label = isMe ? "You" : memberName(member.userId);
                                const info = members.find((item) => item.userId === member.userId);
                                const cls = isZero(member.net)
                                  ? "md-balance-zero"
                                  : member.net > 0
                                    ? "md-balance-positive"
                                    : "md-balance-negative";
                                return (
                                  <div key={member.userId} className={`md-balance-row ${cls}`}>
                                    <span className="md-balance-avatar" aria-hidden="true">
                                      <Avatar name={label} url={memberAvatar(member.userId)} />
                                    </span>
                                    <div className="md-balance-name">
                                      <strong>
                                        {label}
                                        {info?.role === "owner" || info?.role === "admin" ? (
                                          <span className={`md-role-badge is-${info.role}`}>
                                            {info.role === "owner" ? "Owner" : "Admin"}
                                          </span>
                                        ) : null}
                                      </strong>
                                      {info?.userCode && <span className="md-member-code">@{info.userCode}</span>}
                                      <small>
                                        <DirectionIcon
                                          dir={isZero(member.net) ? "done" : member.net > 0 ? "in" : "out"}
                                        />{" "}
                                        {isZero(member.net)
                                          ? "Settled up"
                                          : member.net > 0
                                            ? `${isMe ? "Are" : "Is"} owed overall`
                                            : `${isMe ? "Owe" : "Owes"} overall`}
                                      </small>
                                    </div>
                                    <strong className="md-balance-amount">
                                      {formatPeso(Math.abs(member.net))}
                                    </strong>
                                    {canAct &&
                                      !isMe &&
                                      isZero(member.net) &&
                                      (isOwner ? info?.role !== "owner" : myRole === "admin" && info?.role === "member") && (
                                      <button
                                        type="button"
                                        className="md-balance-remove"
                                        aria-label={`Remove ${label} from the group`}
                                        onClick={() => setRemoving({ userId: member.userId, name: label })}
                                      >
                                        Remove
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                          {(isOwner || myRole === "admin") && canAct && members.length > 1 && (
                            <p className="md-balances-note">Only members who are settled up can be removed.</p>
                          )}

                          <h2 className="md-balances-heading">Settle-up plan</h2>
                          <p className="md-balances-note">
                            The fewest payments that settle everyone in this group.
                          </p>
                          <div className="md-balances">
                            {ledger.plan().length ? (
                              ledger.plan().map((transfer) => {
                                const mine = transfer.from === currentUserId;
                                const toMe = transfer.to === currentUserId;
                                return (
                                  <div
                                    key={`${transfer.from}-${transfer.to}`}
                                    className={`md-balance-row ${mine ? "md-balance-negative" : toMe ? "md-balance-positive" : "md-balance-zero"}`}
                                  >
                                    <span className="md-balance-avatar" aria-hidden="true">
                                      <Avatar name={mine ? "You" : memberName(transfer.from)} url={memberAvatar(transfer.from)} />
                                    </span>
                                    <div className="md-balance-name">
                                      <strong>
                                        {mine ? "You" : memberName(transfer.from)} pay{mine ? "" : "s"}{" "}
                                        {toMe ? "you" : memberName(transfer.to)}
                                      </strong>
                                    </div>
                                    <strong className="md-balance-amount">{formatPeso(transfer.cents / 100)}</strong>
                                    {mine && canAct && (
                                      <button
                                        type="button"
                                        className="md-balance-pay"
                                        aria-label={`Record paying ${memberName(transfer.to)}`}
                                        onClick={() => setSettleWith(transfer.to)}
                                      >
                                        Settle
                                      </button>
                                    )}
                                  </div>
                                );
                              })
                            ) : (
                              <p className="md-balances-empty">Everyone is settled up.</p>
                            )}
                          </div>

                          <h2 className="md-balances-heading">Payments</h2>
                          <PaymentsList
                            payments={payments}
                            me={currentUserId ?? ""}
                            canManageAll={canManage}
                            nameOf={memberName}
                          />
                        </>
                      )}
                    </div>
                  ) : (
                  <>
                  <div className="md-categories">
                    {categories.map((category) => (
                      <button
                        key={category}
                        type="button"
                        className={activeCategory === category ? "active" : ""}
                        onClick={() => {
                          setActiveCategory(category);
                          setExpensePage(1);
                        }}
                      >
                        {category !== "All" && (
                          <span aria-hidden="true">{categoryIcon(category, 16)}</span>
                        )}
                        {category === "All"
                          ? "All"
                          : CATEGORY_META[categoryKey(category)].label}
                      </button>
                    ))}
                  </div>

                  <div className="md-transactions">
                    {filteredExpenses.length === 0 ? (
                      <p className="md-no-transactions">
                        No expenses found in this category.
                      </p>
                    ) : (
                      filteredExpenses
                        .slice((expensePageNow - 1) * EXPENSES_PER_PAGE, expensePageNow * EXPENSES_PER_PAGE)
                        .map((expense) => (
                        <article
                          key={expense.expenseId}
                          className="md-transaction-card md-transaction-clickable"
                          role="button"
                          tabIndex={0}
                          aria-label={`View details for ${expense.title}`}
                          onClick={() => openExpenseDetails(expense)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openExpenseDetails(expense);
                            }
                          }}
                        >
                          <div className="md-transaction-icon">
                            {categoryIcon(expense.category)}
                          </div>

                          <div className="md-transaction-info">
                            <h3>{expense.title}</h3>
                            <p>
                              Paid by{" "}
                              {expense.paidBy_UserId === currentUserId
                                ? "you"
                                : memberName(expense.paidBy_UserId)}
                            </p>
                            <small>
                              {new Date(expense.expenseDate).toLocaleDateString(
                                "en-PH",
                                {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                },
                              )}
                            </small>
                            {edits.has(expense.expenseId) && (
                              <span className="md-edited" title={new Date(edits.get(expense.expenseId)!.at).toLocaleString("en-PH")}>
                                {editedBy(expense.expenseId)} · {timeAgo(edits.get(expense.expenseId)!.at)}
                              </span>
                            )}
                          </div>

                          <div className="md-transaction-amount">
                            {(() => {
                              const who = involvement(expense);
                              const total = money(who.total / 100, expense.currency);
                              return (
                                <p className={`md-involve is-${who.tone}`}>
                                  {who.cents > 0 ? (
                                    <b>
                                      <span className="md-involve-label">{who.label}:</span>{" "}
                                      {money(who.cents / 100, expense.currency)}
                                    </b>
                                  ) : (
                                    <b>{who.label}</b>
                                  )}
                                  <small>{who.cents > 0 ? `of ${total}` : `${total} total`}</small>
                                </p>
                              );
                            })()}
                            <span
                              className="md-category-tag"
                              style={{
                                color: CATEGORY_META[categoryKey(expense.category)].color,
                                background: `color-mix(in srgb, ${CATEGORY_META[categoryKey(expense.category)].color} 16%, transparent)`,
                              }}
                            >
                              {CATEGORY_META[categoryKey(expense.category)].label}
                            </span>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                  <Pagination
                    page={expensePageNow}
                    total={filteredExpenses.length}
                    pageSize={EXPENSES_PER_PAGE}
                    onChange={setExpensePage}
                    noun="expenses"
                  />
                  </>
                  )}
                </section>
              )}
            </>
          )
        )}
      </div>
      </div>

      {/* Expense Details and Delete Confirmation */}
      {selectedExpense && (
        <div
          className={`md-sheet-overlay ${expenseSheetClosing ? "md-sheet-closing" : ""}`}
          onClick={() => {
            if (!deletingExpense) closeExpenseDetails();
          }}
        >
          <section
            className="md-expense-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={
              showDeleteConfirm ? "Confirm delete expense" : "Expense details"
            }
            onClick={(event) => event.stopPropagation()}
          >
            <div className="md-sheet-handle" />

            {showDeleteConfirm ? (
              <div className="md-delete-content">
                <div className="md-delete-icon" aria-hidden="true">
                  <Icon name="trash" size={30} />
                </div>
                <h2 className="md-delete-title">
                  Delete &quot;{selectedExpense.title}&quot;?
                </h2>
                <p className="md-delete-description">
                  Are you sure you want to delete{" "}
                  <strong>
                    {formatPeso(Number(selectedExpense.totalAmount))}
                  </strong>{" "}
                  from {group?.name}? This action cannot be undone.
                </p>

                {expenseActionError && (
                  <p className="md-sheet-error" role="alert">
                    {expenseActionError}
                  </p>
                )}

                <button
                  type="button"
                  className="md-delete-confirm"
                  onClick={deleteSelectedExpense}
                  disabled={deletingExpense}
                >
                  {deletingExpense ? "Deleting..." : "Delete Expense"}
                </button>
                <button
                  type="button"
                  className="md-delete-cancel"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setExpenseActionError("");
                  }}
                  disabled={deletingExpense}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div className="md-sheet-header">
                  <button type="button" onClick={closeExpenseDetails}>
                    Close
                  </button>
                  <strong>Expense</strong>
                  <span />
                </div>

                <div className="md-sheet-expense-heading">
                  <div className="md-sheet-category-icon">
                    {categoryIcon(selectedExpense.category, 28)}
                  </div>
                  <div>
                    <h2>{selectedExpense.title}</h2>
                    <p>{group?.name}</p>
                  </div>
                </div>

                <div className="md-sheet-amount-card">
                  <div>
                    <span>Expense amount</span>
                    <strong>
                      {money(Number(selectedExpense.totalAmount), selectedExpense.currency)}
                    </strong>
                  </div>
                  <span className="md-sheet-category">
                    {CATEGORY_META[categoryKey(selectedExpense.category)].label}
                  </span>
                </div>

                <div className="md-sheet-information">
                  <div>
                    <span>Paid by</span>
                    <strong>{memberName(selectedExpense.paidBy_UserId)}</strong>
                  </div>
                  <div>
                    <span>Split between</span>
                    <strong>{splitBetween(selectedExpense.expenseId)}</strong>
                  </div>
                  <div>
                    <span>Date</span>
                    <strong>
                      {new Date(selectedExpense.expenseDate).toLocaleDateString(
                        "en-PH",
                      )}
                    </strong>
                  </div>
                  {edits.has(selectedExpense.expenseId) && (
                    <div>
                      <span>Last edited</span>
                      <strong>
                        {editedBy(selectedExpense.expenseId).replace(/^Edited( by)? ?/, "") || "Someone"}
                        {" · "}
                        {new Date(edits.get(selectedExpense.expenseId)!.at).toLocaleString("en-PH", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </strong>
                    </div>
                  )}
                </div>

                {selectedExpense.receiptUrl && (
                  <div className="md-sheet-receipt">
                    <span>Receipt</span>
                    {receiptState === "loading" ? (
                      <p aria-busy="true">Loading receipt…</p>
                    ) : receiptState === "error" || !receiptUrl ? (
                      <p role="alert">Couldn&apos;t load the receipt. Try again later.</p>
                    ) : (
                      <a href={receiptUrl} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={receiptUrl} alt={`Receipt for ${selectedExpense.title}`} />
                      </a>
                    )}
                  </div>
                )}

                {canAct && (selectedExpense.paidBy_UserId === currentUserId || canManage) ? (
                  <div className="md-sheet-actions">
                    <button
                      type="button"
                      className="md-sheet-edit-button"
                      onClick={() =>
                        router.push(
                          `/groups/${params.groupId}/add-expense?edit=${encodeURIComponent(selectedExpense.expenseId)}`,
                        )
                      }
                    >
                      Edit Expense
                    </button>
                    <button
                      type="button"
                      className="md-sheet-delete-button"
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      Delete Expense
                    </button>
                  </div>
                ) : (
                  <p className="md-sheet-note">Only the payer or a group admin can edit or delete this expense.</p>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {addedExpense && (
        <div className="md-expense-notice" role="status">
          <span className="md-notice-check" aria-hidden="true">
            <Icon name="check" size={18} strokeWidth={2.6} />
          </span>
          <div className="md-notice-body">
            <strong>Expense added</strong>
            <span>
              {addedExpense.title} ·{" "}
              {formatPeso(Number(addedExpense.totalAmount))}
            </span>
          </div>
          <button
            type="button"
            className="md-notice-view"
            onClick={() => {
              openExpenseDetails(addedExpense);
              setAddedExpense(null);
            }}
          >
            View
          </button>
          <button
            type="button"
            className="md-notice-dismiss"
            aria-label="Dismiss notification"
            onClick={() => setAddedExpense(null)}
          >
            ×
          </button>
        </div>
      )}
      {!addedExpense && expenseNotice && (
        <div className="md-expense-notice" role="status">
          <span className="md-notice-check" aria-hidden="true">
            <Icon name="check" size={18} strokeWidth={2.6} />
          </span>
          <div className="md-notice-body">
            <strong>{expenseNotice}</strong>
          </div>
          <button
            type="button"
            className="md-notice-dismiss"
            aria-label="Dismiss notification"
            onClick={() => setExpenseNotice("")}
          >
            ×
          </button>
        </div>
      )}

      <AppNav active="groups" />

      {inviteOpen && group && (
        <InviteFriendsSheet
          groupId={group.groupId}
          groupName={group.name}
          memberIds={members.map((member) => member.userId)}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </main>
  );
}
