"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import "./group-details.css";
import GroupDetailsSkeleton from "@/components/GroupDetailsSkeleton";
import Image from "next/image";
import { isZero, peso } from "@/lib/manemi/format";

type Group = {
  groupId: string;
  name: string;
  createdBy: string;
};

type GroupMember = { userId: string; name: string };
type ExpenseSplit = { expenseId: string; userId: string };

type Expense = {
  expenseId: string;
  paidBy_UserId: string;
  title: string;
  totalAmount: number;
  expenseDate: string;
  category: string | null;
  receiptUrl: string | null;
};

type MemberBalance = { userId?: string; net: number };

type BalancesResponse = {
  error?: string;
  members?: Array<{ userId?: string; net: number | string }>;
  summary?: { owedToYou?: number | string; youOwe?: number | string };
};

const formatPeso = peso;

export default function GroupDetailsPage() {
  const params = useParams<{ groupId: string }>();
  const router = useRouter();

  const [group, setGroup] = useState<Group | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [expenseSplits, setExpenseSplits] = useState<ExpenseSplit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("All");
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingExpense, setDeletingExpense] = useState(false);
  const [expenseActionError, setExpenseActionError] = useState("");
  const [expenseNotice, setExpenseNotice] = useState("");
  const [addedExpense, setAddedExpense] = useState<Expense | null>(null);
  const [expenseSheetClosing, setExpenseSheetClosing] = useState(false);
  const [refreshExpenses, setRefreshExpenses] = useState(0);
  const [activeTab, setActiveTab] = useState<"expenses" | "balances">(
    "expenses",
  );
  const [myNet, setMyNet] = useState<number | null>(null);
  const [memberBalances, setMemberBalances] = useState<MemberBalance[]>([]);
  const [balanceError, setBalanceError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadGroup() {
      setLoading(true);
      setError("");

      const supabase = createClient();

      const { data: auth, error: authError } = await supabase.auth.getUser();

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
      const [groupResult, rosterResult, expenseResult, balanceResult] =
        await Promise.all([
          supabase
            .from("Group")
            .select("groupId, name, createdBy")
            .eq("groupId", params.groupId)
            .maybeSingle(),
          supabase
            .from("Group_Member")
            .select("userId")
            .eq("groupId", params.groupId),
          supabase
            .from("Expense")
            .select(
              "expenseId, paidBy_UserId, title, totalAmount, expenseDate, category, receiptUrl",
            )
            .eq("groupId", params.groupId)
            .order("expenseDate", { ascending: false }),
          supabase.functions.invoke<BalancesResponse>("get-balances", {
            body: { groupId: params.groupId },
          }),
        ]);

      if (!active) return;

      const { data: memberRows, error: memberError } = rosterResult;
      if (memberError) {
        setError(`Unable to load group members: ${memberError.message}`);
        setLoading(false);
        return;
      }
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

      // Personal balance and per-member nets from get-balances.
      const balances = balanceResult.data;
      if (
        balanceResult.error ||
        balances?.error ||
        !Array.isArray(balances?.members)
      ) {
        setBalanceError(
          balanceResult.error?.message ??
            balances?.error ??
            "Balances are unavailable right now.",
        );
        setMyNet(null);
        setMemberBalances([]);
      } else {
        setBalanceError("");
        setMyNet(
          (Number(balances.summary?.owedToYou ?? 0) || 0) -
            (Number(balances.summary?.youOwe ?? 0) || 0),
        );
        setMemberBalances(
          balances.members.map((member) => ({
            userId: member.userId,
            net: Number(member.net) || 0,
          })),
        );
      }

      const expenseData = expenseResult.data;
      const expenseIds = (expenseData ?? []).map((item) => item.expenseId);

      // Names and split participants depend on the results above.
      const [usersResult, splitsResult] = await Promise.all([
        memberIds.length
          ? supabase.from("User").select("userId, name").in("userId", memberIds)
          : Promise.resolve({ data: [], error: null }),
        expenseIds.length
          ? supabase
              .from("Expense_Split")
              .select("expenseId, userId")
              .in("expenseId", expenseIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (!active) return;

      let namesById = new Map<string, string>();
      if (usersResult.error) {
        console.warn("Unable to load member names:", usersResult.error.message);
      } else {
        namesById = new Map(
          (usersResult.data ?? []).map((user) => [
            user.userId as string,
            String(user.name || "").trim(),
          ]),
        );
      }
      setMembers(
        memberIds.map((id) => ({
          userId: id,
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
          const remaining = paramsFromUrl.toString();
          window.history.replaceState(
            window.history.state,
            "",
            `${window.location.pathname}${remaining ? `?${remaining}` : ""}${window.location.hash}`,
          );
        }
      }

      setLoading(false);
    }

    void loadGroup();

    return () => {
      active = false;
    };
  }, [params.groupId, refreshExpenses]);

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
      setRefreshExpenses((previous) => previous + 1);
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

  const totalExpenses = expenses.reduce(
    (sum, expense) => sum + Number(expense.totalAmount),
    0,
  );

  const transactionCount = expenses.length;
  const categories = [
    "All",
    ...Array.from(
      new Set(expenses.map((expense) => expense.category).filter(Boolean)),
    ),
  ] as string[];

  const filteredExpenses =
    activeCategory === "All"
      ? expenses
      : expenses.filter((expense) => expense.category === activeCategory);

  const categoryIcon = (category: string | null) => {
    switch (category?.toLowerCase()) {
      case "food":
        return "🍔";
      case "transport":
        return "🚕";
      case "lodging":
        return "🏠";
      case "shopping":
        return "🛍️";
      default:
        return "💳";
    }
  };

  const memberCount = members.length;

  const memberName = (id: string) =>
    members.find((member) => member.userId === id)?.name || "Unknown member";

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
    <main className="manemi-detail-page">
      <div className="manemi-detail-content">
        <header className="md-topbar">
          <Link href="/groups" className="md-back">
            <span aria-hidden="true">‹</span> Groups
          </Link>

          <div className="md-top-actions">
            <button
              type="button"
              aria-label="Copy group link"
              title="Copy group link"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  setExpenseNotice("Group link copied");
                } catch {
                  setExpenseNotice("Unable to copy link");
                }
              }}
            >
              🔗
            </button>

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
                <div className="md-menu">More group actions coming soon</div>
              )}
            </div>
          </div>
        </header>

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
                  📦
                </div>

                <div>
                  <h1>{group.name}</h1>
                  <p>
                    {memberCount} member
                    {memberCount !== 1 ? "s" : ""} ·{" "}
                    <span className="md-admin">
                      {group.createdBy === currentUserId ? "Admin" : "Member"}
                    </span>
                  </p>
                </div>
              </section>

              <section className="md-summary">
                <p className="md-eyebrow">GROUP SUMMARY · TOTAL EXPENSES</p>

                <strong className="md-total">
                  {formatPeso(totalExpenses)}
                </strong>

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
                        ? { cls: "md-balance-zero", icon: "✓", text: "Settled up" }
                        : myNet > 0
                          ? { cls: "md-balance-positive", icon: "↙", text: "You're owed" }
                          : { cls: "md-balance-negative", icon: "↗", text: "You owe" };
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

                  <button
                    type="button"
                    className="md-invite-members"
                    onClick={() => alert("Member invitations coming soon.")}
                  >
                    🔗 Invite Members
                  </button>
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
                    <div className="md-balances" role="tabpanel">
                      {balanceError ? (
                        <p className="md-no-transactions">{balanceError}</p>
                      ) : (
                        [...memberBalances]
                          .sort((a, b) => b.net - a.net)
                          .map((member, index) => {
                            const isMe = member.userId === currentUserId;
                            const label = member.userId
                              ? isMe
                                ? "You"
                                : memberName(member.userId)
                              : `Member ${index + 1}`;
                            const cls = isZero(member.net)
                              ? "md-balance-zero"
                              : member.net > 0
                                ? "md-balance-positive"
                                : "md-balance-negative";
                            return (
                              <div
                                key={member.userId ?? index}
                                className={`md-balance-row ${cls}`}
                              >
                                <span className="md-balance-avatar" aria-hidden="true">
                                  {label.charAt(0).toUpperCase()}
                                </span>
                                <div className="md-balance-name">
                                  <strong>{label}</strong>
                                  <small>
                                    {isZero(member.net)
                                      ? "✓ Settled up"
                                      : member.net > 0
                                        ? `↙ ${isMe ? "Are" : "Is"} owed`
                                        : `↗ ${isMe ? "Owe" : "Owes"}`}
                                  </small>
                                </div>
                                <strong className="md-balance-amount">
                                  {formatPeso(Math.abs(member.net))}
                                </strong>
                              </div>
                            );
                          })
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
                        onClick={() => setActiveCategory(category)}
                      >
                        {category !== "All" && categoryIcon(category)}
                        {category}
                      </button>
                    ))}
                  </div>

                  <div className="md-transactions">
                    {filteredExpenses.length === 0 ? (
                      <p className="md-no-transactions">
                        No expenses found in this category.
                      </p>
                    ) : (
                      filteredExpenses.map((expense) => (
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
                            <p>Paid by {memberName(expense.paidBy_UserId)}</p>
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
                          </div>

                          <div className="md-transaction-amount">
                            <strong>
                              {formatPeso(Number(expense.totalAmount))}
                            </strong>
                            <span>{expense.category ?? "Other"}</span>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                  </>
                  )}
                </section>
              )}
            </>
          )
        )}
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
                  🗑
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
                    {categoryIcon(selectedExpense.category)}
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
                      {formatPeso(Number(selectedExpense.totalAmount))}
                    </strong>
                  </div>
                  <span className="md-sheet-category">
                    {selectedExpense.category ?? "Other"}
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
                </div>

                <button
                  type="button"
                  className="md-sheet-delete-button"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete Expense
                </button>
              </>
            )}
          </section>
        </div>
      )}

      {addedExpense && (
        <div className="md-expense-notice" role="status">
          <span className="md-notice-check" aria-hidden="true">
            ✓
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
            ✓
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

      <nav className="md-bottom" aria-label="Main navigation">
        <div className="md-bottom-pill">
          <Link href="/dashboard">
            <Image src="/icons/home.png" alt="" width={20} height={20} />
            <span>Home</span>
          </Link>

          <Link href="/groups" className="active" aria-current="page">
            <Image src="/icons/group.png" alt="" width={20} height={20} />
            <span>Groups</span>
          </Link>

          <Link href="/history">
            <Image src="/icons/clock.png" alt="" width={20} height={20} />
            <span>History</span>
          </Link>
        </div>

        <button
          type="button"
          className="md-plus"
          onClick={openAddExpense}
          aria-label="Add expense"
          title="Add expense"
        >
          <Image src="/icons/plus.png" alt="" width={24} height={24} />
        </button>
      </nav>
    </main>
  );
}
