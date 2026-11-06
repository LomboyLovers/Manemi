"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import "./group-details.css";

type Group = {
  groupId: string;
  name: string;
  createdBy: string;
};

type Expense = {
  expenseId: string;
  totalAmount: number;
};

const formatPeso = (amount: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(amount);

export default function GroupDetailsPage() {
  const params = useParams<{ groupId: string }>();
  const router = useRouter();

  const [group, setGroup] = useState<Group | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

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

      const { data, error: queryError } = await supabase
        .from("Group")
        .select("groupId, name, createdBy")
        .eq("groupId", params.groupId)
        .eq("createdBy", auth.user.id)
        .eq("isArchived", false)
        .maybeSingle();

      if (!active) return;

      if (queryError) {
        setError(queryError.message);
        setLoading(false);
        return;
      }

      if (!data) {
        setError("Group not found or you do not have access.");
        setLoading(false);
        return;
      }

      setGroup(data);

      const { data: expenseData, error: expenseError } = await supabase
        .from("Expense")
        .select("expenseId, totalAmount")
        .eq("groupId", params.groupId);

      if (!active) return;

      if (expenseError) {
        console.error("Failed to load expenses:", expenseError.message);
        setError("Unable to load group expenses.");
      } else {
        setExpenses(expenseData ?? []);
      }

      setLoading(false);
    }

    void loadGroup();

    return () => {
      active = false;
    };
  }, [params.groupId]);

  const openAddExpense = () => {
    router.push(`/groups/${params.groupId}/add-expense`);
  };

  const totalExpenses = expenses.reduce(
    (sum, expense) => sum + Number(expense.totalAmount),
    0,
  );

  const transactionCount = expenses.length;

  // Temporary until group members are connected.
  const memberCount = 1;

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
                  alert("Group link copied");
                } catch {
                  alert("Unable to copy link");
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
          <p className="md-state">Loading group...</p>
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
                    <span className="md-admin">Admin</span>
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

                <div className="md-settled">
                  <span className="md-settled-icon">✓</span>

                  <div>
                    <small>Your balance </small>
                    <strong>₱0.00 · Balance not yet connected</strong>
                  </div>
                </div>
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
                <section className="md-first-expense">
                  <h2>Group Expenses</h2>

                  <p>
                    {transactionCount}{" "}
                    {transactionCount === 1 ? "expense" : "expenses"} recorded
                    in this group.
                  </p>

                  <button
                    type="button"
                    className="md-add-first"
                    onClick={openAddExpense}
                  >
                    <span aria-hidden="true">＋</span>
                    Add Expense
                  </button>
                </section>
              )}
            </>
          )
        )}
      </div>

      <nav className="md-bottom" aria-label="Main navigation">
        <div className="md-bottom-pill">
          <Link href="/dashboard">
            <span>⌂</span>
            Home
          </Link>

          <Link href="/groups" className="active" aria-current="page">
            <span>♧</span>
            Groups
          </Link>

          <Link href="/history">
            <span>◷</span>
            History
          </Link>
        </div>

        <button
          type="button"
          className="md-plus"
          onClick={openAddExpense}
          aria-label="Add expense to this group"
        >
          +
        </button>
      </nav>
    </main>
  );
}
