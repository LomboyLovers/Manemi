"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import "./add-expense.css";

type Group = { groupId: string; name: string; createdBy: string };
type Member = { id: string; name: string };
type SplitMode = "equally" | "exact" | "percent";
type Category = "Food" | "Transport" | "Lodging" | "Shopping" | "Other";

const categories: { name: Category; icon: string }[] = [
  { name: "Food", icon: "🍔" },
  { name: "Transport", icon: "🚕" },
  { name: "Lodging", icon: "🏨" },
  { name: "Shopping", icon: "🛍️" },
  { name: "Other", icon: "📦" },
];
const money = (cents: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    cents / 100,
  );
const parseCents = (value: string) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : 0;
};
const initials = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

export default function AddExpensePage() {
  const router = useRouter();
  const params = useParams<{ groupId: string }>();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [payerId, setPayerId] = useState("");
  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [category, setCategory] = useState<Category>("Food");
  const [mode, setMode] = useState<SplitMode>("equally");
  const [selected, setSelected] = useState<string[]>([]);
  const [entries, setEntries] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    async function load() {
      const supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!alive) return;
      if (authError || !auth.user) {
        setError("Please log in to add an expense.");
        setLoading(false);
        return;
      }
      const { data, error: groupError } = await supabase
        .from("Group")
        .select("groupId, name, createdBy")
        .eq("groupId", params.groupId)
        .eq("createdBy", auth.user.id)
        .eq("isArchived", false)
        .maybeSingle();
      if (!alive) return;
      if (groupError || !data) {
        setError(groupError?.message || "Group not found or access denied.");
        setLoading(false);
        return;
      }
      // Only the authenticated creator is loaded here. Once Group_Member and User
      // columns/RLS are confirmed, replace this with the real member roster.
      const displayName =
        (auth.user.user_metadata?.full_name as string | undefined)?.trim() ||
        auth.user.email?.split("@")[0] ||
        "You";
      const creator = { id: auth.user.id, name: displayName };
      setGroup(data);
      setUserId(auth.user.id);
      setMembers([creator]);
      setSelected([creator.id]);
      setPayerId(creator.id);
      setLoading(false);
    }
    void load();
    return () => {
      alive = false;
    };
  }, [params.groupId]);

  const total = parseCents(amount);
  const split = useMemo(() => {
    const selectedMembers = members.filter((member) =>
      selected.includes(member.id),
    );
    const result: Record<string, number> = {};
    if (mode === "equally") {
      const base = selectedMembers.length
        ? Math.floor(total / selectedMembers.length)
        : 0;
      const remainder = selectedMembers.length
        ? total % selectedMembers.length
        : 0;
      selectedMembers.forEach((member, index) => {
        result[member.id] = base + (index < remainder ? 1 : 0);
      });
    } else if (mode === "exact") {
      selectedMembers.forEach((member) => {
        result[member.id] = parseCents(entries[member.id] || "");
      });
    } else {
      // Use integer basis points to avoid floating point percentage errors.
      selectedMembers.forEach((member) => {
        const pct = Number(entries[member.id] || 0);
        result[member.id] = Number.isFinite(pct)
          ? Math.round((total * pct) / 100)
          : 0;
      });
    }
    return result;
  }, [members, selected, total, mode, entries]);

  const assigned = Object.values(split).reduce((sum, cents) => sum + cents, 0);
  const percentageSum = members
    .filter((m) => selected.includes(m.id))
    .reduce((sum, m) => sum + Number(entries[m.id] || 0), 0);
  const invalidPercentage =
    mode === "percent" &&
    members.some(
      (m) =>
        selected.includes(m.id) &&
        (!Number.isFinite(Number(entries[m.id])) ||
          Number(entries[m.id]) < 0 ||
          Number(entries[m.id]) > 100),
    );
  const validSplit =
    selected.length > 0 &&
    (mode === "equally" ||
      (mode === "exact"
        ? assigned === total
        : Math.abs(percentageSum - 100) < 0.000001 && !invalidPercentage));
  const formValid =
    total > 0 && title.trim().length > 0 && payerId.length > 0 && validSplit;
  const difference =
    mode === "percent" ? percentageSum - 100 : assigned - total;
  const unit = mode === "percent" ? "%" : "";
  const summary =
    mode === "equally"
      ? `Split equally · ${selected.length} ${selected.length === 1 ? "person" : "people"}`
      : mode === "percent"
        ? `${percentageSum.toFixed(2).replace(/\.00$/, "")}% assigned`
        : `${money(assigned)} of ${money(total)} assigned`;

  async function handleSaveExpense() {
    if (!formValid || !group || saving) return;

    setSaving(true);
    setSaveError("");

    try {
      const supabase = createClient();

      const { data: auth, error: authError } = await supabase.auth.getUser();

      if (authError || !auth.user) {
        throw new Error("Please log in again.");
      }

      const categoryMap: Record<Category, string> = {
        Food: "food",
        Transport: "transport",
        Lodging: "accomodation",
        Shopping: "shopping",
        Other: "other",
      };

      const participants = members
        .filter((member) => selected.includes(member.id))
        .map((member) => {
          if (mode === "exact") {
            return {
              userId: member.id,
              amount: split[member.id] / 100,
            };
          }

          if (mode === "percent") {
            return {
              userId: member.id,
              percentage: Number(entries[member.id]),
            };
          }

          return { userId: member.id };
        });

      const expenseDate = new Date(`${date}T12:00:00`).toISOString();

      const payload = {
        groupId: group.groupId,
        title: title.trim(),
        totalAmount: total / 100,
        category: categoryMap[category],
        splitType:
          mode === "equally"
            ? "equal"
            : mode === "percent"
              ? "percentage"
              : "exact",
        expenseDate,
        paidBy: payerId,
        participants,
      };

      const { data, error: functionError } = await supabase.functions.invoke(
        "create-expense",
        {
          body: payload,
        },
      );

      if (functionError) {
        let message = functionError.message;

        const response = (
          functionError as {
            context?: Response;
          }
        ).context;

        if (response) {
          try {
            const details = await response.clone().json();
            message =
              details.error || JSON.stringify(details.details || details);
          } catch {
            // Keep the original error message.
          }
        }

        throw new Error(message);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      router.replace(`/groups/${group.groupId}`);
      router.refresh();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Unable to save expense.",
      );
    } finally {
      setSaving(false);
    }
  }

  const toggleMember = (id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  };

  return (
    <main className="ae-page">
      <section className="ae-sheet">
        <div className="ae-handle" aria-hidden="true" />
        <header className="ae-header">
          <button
            type="button"
            className="ae-cancel"
            onClick={() => router.push(`/groups/${params.groupId}`)}
          >
            Cancel
          </button>
          <h1>Add Expense</h1>
          <span aria-hidden="true" />
        </header>
        {loading ? (
          <p className="ae-state">Loading group...</p>
        ) : error ? (
          <p className="ae-state" role="alert">
            {error}
          </p>
        ) : (
          group && (
            <>
              <div className="ae-amount-block">
                <label htmlFor="ae-amount">Amount</label>
                <div className="ae-amount-input">
                  <span>₱</span>
                  <input
                    id="ae-amount"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </div>
              <label className="ae-visually-hidden" htmlFor="ae-title">
                What was it for?
              </label>
              <input
                id="ae-title"
                className="ae-title-input"
                maxLength={100}
                placeholder="What was it for?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <div className="ae-info-box">
                <div className="ae-info-row">
                  <span>Group</span>
                  <strong>📦 {group.name}</strong>
                </div>
                <label className="ae-info-row" htmlFor="ae-payer">
                  <span>Paid by</span>
                  <select
                    id="ae-payer"
                    value={payerId}
                    onChange={(e) => setPayerId(e.target.value)}
                  >
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.id === userId ? "You" : member.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ae-info-row" htmlFor="ae-date">
                  <span>Date</span>
                  <input
                    id="ae-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
              </div>
              <div className="ae-section-label">
                <h2>Category</h2>
                <span>Choose one</span>
              </div>
              <div className="ae-categories">
                {categories.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    className={category === item.name ? "active" : ""}
                    onClick={() => setCategory(item.name)}
                  >
                    {item.icon} {item.name}
                  </button>
                ))}
              </div>
              <div className="ae-section-label">
                <h2>Split</h2>
                <span>
                  {selected.length} of {members.length} selected
                </span>
              </div>
              <div className="ae-modes" role="group" aria-label="Split method">
                <button
                  type="button"
                  className={mode === "equally" ? "active" : ""}
                  onClick={() => setMode("equally")}
                >
                  Equally
                </button>
                <button
                  type="button"
                  className={mode === "exact" ? "active" : ""}
                  onClick={() => setMode("exact")}
                >
                  Exact ₱
                </button>
                <button
                  type="button"
                  className={mode === "percent" ? "active" : ""}
                  onClick={() => setMode("percent")}
                >
                  Percent %
                </button>
              </div>
              <div className="ae-member-list">
                {members.map((member) => {
                  const included = selected.includes(member.id);
                  return (
                    <div className="ae-member-row" key={member.id}>
                      {mode === "equally" && (
                        <button
                          type="button"
                          className={`ae-check ${included ? "checked" : ""}`}
                          onClick={() => toggleMember(member.id)}
                          aria-label={`${included ? "Exclude" : "Include"} ${member.name}`}
                        >
                          {included ? "✓" : ""}
                        </button>
                      )}
                      <span className="ae-avatar">{initials(member.name)}</span>
                      <div className="ae-member-name">
                        <strong>
                          {member.id === userId ? "You" : member.name}
                        </strong>
                        {mode !== "equally" && (
                          <small>{money(split[member.id] || 0)}</small>
                        )}
                      </div>
                      {mode === "equally" ? (
                        <strong className="ae-share">
                          {included ? money(split[member.id] || 0) : "Excluded"}
                        </strong>
                      ) : (
                        <label className="ae-share-input">
                          <span className="ae-visually-hidden">
                            {member.name}{" "}
                            {mode === "exact" ? "amount" : "percentage"}
                          </span>
                          {mode === "exact" && <span>₱</span>}
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={mode === "percent" ? "100" : undefined}
                            step="0.01"
                            placeholder="0"
                            value={entries[member.id] ?? ""}
                            onChange={(e) => {
                              setEntries((prev) => ({
                                ...prev,
                                [member.id]: e.target.value,
                              }));
                              setSelected((prev) =>
                                prev.includes(member.id)
                                  ? prev
                                  : [...prev, member.id],
                              );
                            }}
                          />
                          {mode === "percent" && <span>%</span>}
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
              {mode !== "equally" && total > 0 && (
                <div
                  className={`ae-validation ${validSplit ? "valid" : "invalid"}`}
                  role="status"
                >
                  <strong>
                    {validSplit
                      ? "✓ Split adds up correctly."
                      : difference < 0
                        ? `⚠ ${mode === "percent" ? `${Math.abs(difference).toFixed(2).replace(/\.00$/, "")}% still unassigned.` : `${money(-difference)} still unassigned.`}`
                        : difference > 0
                          ? `⚠ ${mode === "percent" ? `${difference.toFixed(2).replace(/\.00$/, "")}% over the total.` : `${money(difference)} over the expense total.`}`
                          : "⚠ Check the split amounts."}
                  </strong>
                  <span>
                    {validSplit
                      ? "Everyone's share is assigned."
                      : "Adjust the shares before saving."}
                  </span>
                  <div className="ae-progress">
                    <div
                      style={{
                        width: `${Math.min(100, Math.max(0, mode === "percent" ? percentageSum : total ? (assigned / total) * 100 : 0))}%`,
                      }}
                    />
                  </div>
                  <small>
                    {summary}
                    {unit && difference !== 0
                      ? ` · ${Math.abs(difference).toFixed(2).replace(/\.00$/, "")}${unit} ${difference < 0 ? "left" : "over"}`
                      : ""}
                  </small>
                </div>
              )}
              <div className="ae-footer">
                <p>
                  {!total || !title.trim()
                    ? "Enter an amount and a title to continue"
                    : !validSplit
                      ? "Fix the split to continue"
                      : `${summary} · Ready to save`}
                </p>
                <button
                  type="button"
                  disabled={!formValid || saving}
                  onClick={handleSaveExpense}
                >
                  {saving ? "Saving Expense..." : "Save Expense"}
                </button>
                {saveError && (
                  <p role="alert" style={{ color: "#ff676d" }}>
                    {saveError}
                  </p>
                )}
              </div>
            </>
          )
        )}
      </section>
    </main>
  );
}
