"use client";

import { useEffect, useMemo, useState } from "react";

import { useParams, useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import {
  computeShares,
  convertSplit,
  FULL_PERCENT_BPS,
  hundredthsToInput,
  sharesToBps,
  toBps,
  toCents,
  type SplitMode,
} from "@/lib/manemi/split";

import DatePicker from "@/components/DatePicker";
import Select from "@/components/Select";
import CategoryIcon from "@/components/CategoryIcon";
import Icon from "@/components/Icon";
import type { CategoryKey } from "@/lib/manemi/format";

import "./add-expense.css";

type Group = { groupId: string; name: string; createdBy: string };

type Member = { id: string; name: string };

// Same list as the database's expense_category.
type Category =
  | "Food"
  | "Transport"
  | "Lodging"
  | "Shopping"
  | "Utilities"
  | "Entertainment"
  | "Other";

const categories: { name: Category; key: CategoryKey }[] = [
  { name: "Food", key: "food" },
  { name: "Transport", key: "transport" },
  { name: "Lodging", key: "lodging" },
  { name: "Shopping", key: "shopping" },
  { name: "Utilities", key: "utilities" },
  { name: "Entertainment", key: "entertainment" },
  { name: "Other", key: "other" },
];

const money = (cents: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    cents / 100,
  );

const parseCents = toCents;

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

      // Load the group and its roster together; the roster also confirms
      // membership, so no separate membership round trip is needed.
      const [groupResult, rosterResult] = await Promise.all([
        supabase
          .from("Group")
          .select("groupId, name, createdBy")
          .eq("groupId", params.groupId)
          .eq("isArchived", false)
          .maybeSingle(),
        supabase
          .from("Group_Member")
          .select("userId")
          .eq("groupId", params.groupId),
      ]);

      if (!alive) return;
      const { data, error: groupError } = groupResult;
      const { data: roster, error: rosterError } = rosterResult;
      if (rosterError || !roster) {
        setError(rosterError?.message || "Unable to load group members.");
        setLoading(false);
        return;
      }
      const me = auth.user;
      if (!roster.some((item) => item.userId === me.id)) {
        setError("You are not a member of this group.");
        setLoading(false);
        return;
      }
      if (groupError || !data) {
        setError(
          groupError?.message ||
            "Group not found, archived, or you don't have access.",
        );
        setLoading(false);
        return;
      }

      const memberIds = [
        ...new Set(roster.map((item) => item.userId as string)),
      ];
      if (!memberIds.includes(auth.user.id)) {
        setError("You are not a member of this group.");
        setLoading(false);
        return;
      }

      const { data: profiles, error: profileError } = await supabase
        .from("User")
        .select("userId, name")
        .in("userId", memberIds);

      if (!alive) return;
      if (profileError) {
        setError(`Unable to load member names: ${profileError.message}`);
        setLoading(false);
        return;
      }

      const profileNames = new Map(
        (profiles ?? []).map((profile) => [
          profile.userId as string,
          profile.name as string | null,
        ]),
      );
      const displayName =
        (auth.user.user_metadata?.full_name as string | undefined)?.trim() ||
        auth.user.email?.split("@")[0] ||
        "You";
      const groupMembers: Member[] = memberIds.map((id) => ({
        id,
        name:
          profileNames.get(id)?.trim() ||
          (id === me.id ? displayName : "Group member"),
      }));

      setGroup(data);
      setUserId(auth.user.id);
      setMembers(groupMembers);
      setSelected(memberIds);
      setPayerId(auth.user.id);
      setLoading(false);
    }

    void load();

    return () => {
      alive = false;
    };
  }, [params.groupId]);

  const total = parseCents(amount);

  const split = useMemo(
    () => computeShares(mode, total, { selected, entries }),
    [mode, total, selected, entries],
  );

  const assigned = Object.values(split).reduce((sum, cents) => sum + cents, 0);

  // Integer basis points (100% = 10000) avoid floating point drift.
  const percentageBps = selected.reduce(
    (sum, id) => sum + toBps(entries[id] ?? ""),
    0,
  );
  const percentageSum = percentageBps / 100;

  const invalidPercentage =
    mode === "percent" &&
    selected.some((id) => {
      const value = Number(entries[id] || 0);
      return !Number.isFinite(value) || value < 0 || value > 100;
    });

  const validSplit =
    selected.length > 0 &&
    (mode === "equally" ||
      (mode === "exact"
        ? assigned === total
        : percentageBps === FULL_PERCENT_BPS && !invalidPercentage));

  // Percent of the total each member's exact amount represents.
  const exactPercents = useMemo(
    () => sharesToBps(total, selected, split),
    [total, selected, split],
  );

  /** Switch split method, carrying the current shares over. */
  function changeMode(next: SplitMode) {
    if (next === mode) return;
    const converted = convertSplit(mode, next, total, { selected, entries });
    setSelected(converted.selected);
    setEntries(converted.entries);
    setMode(next);
  }

  const formValid =
    total > 0 && title.trim().length > 0 && payerId.length > 0 && validSplit;

  const difference =
    mode === "percent"
      ? (percentageBps - FULL_PERCENT_BPS) / 100
      : assigned - total;

  const unit = mode === "percent" ? "%" : "";

  const summary =
    mode === "equally"
      ? `Split equally · ${selected.length} ${selected.length === 1 ? "person" : "people"}`
      : mode === "percent"
        ? `${hundredthsToInput(percentageBps) || "0"}% assigned`
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

        Lodging: "lodging",

        Shopping: "shopping",

        Utilities: "utilities",

        Entertainment: "entertainment",

        Other: "other",
      };

      // People with a ₱0 / 0% share aren't part of this expense.
      const participants = members

        .filter(
          (member) =>
            selected.includes(member.id) &&
            (mode === "equally" ||
              (mode === "percent"
                ? toBps(entries[member.id] ?? "") > 0
                : (split[member.id] ?? 0) > 0)),
        )

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

      // Only announce success after the Edge Function confirms creation.

      // The returned ID lets Group Details locate the exact saved expense.

      const createdExpenseId =
        data?.expense?.expenseId ??
        data?.data?.expense?.expenseId ??
        data?.expenseId ??
        null;

      const destination = new URLSearchParams();

      if (typeof createdExpenseId === "string" && createdExpenseId) {
        destination.set("expenseAdded", createdExpenseId);
      }

      router.replace(
        `/groups/${group.groupId}${destination.size ? `?${destination.toString()}` : ""}`,
      );

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
                    // Sized to its content so "₱ amount" stays centered.
                    style={{ width: `${Math.max((amount || "0.00").length, 1) + 0.6}ch` }}
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

                  <strong className="ae-group-name"><Icon name="users" size={18} /> {group.name}</strong>
                </div>

                <div className="ae-info-row">
                  <span id="ae-payer-label">Paid by</span>

                  <Select
                    id="ae-payer"
                    label="Paid by"
                    value={payerId}
                    onChange={setPayerId}
                    options={members.map((member) => {
                      const name = member.id === userId ? "You" : member.name;
                      return {
                        value: member.id,
                        label: name,
                        icon: (
                          <span className="ae-payer-avatar" aria-hidden="true">
                            {(member.name || "?").charAt(0).toUpperCase()}
                          </span>
                        ),
                      };
                    })}
                  />
                </div>

                <div className="ae-info-row">
                  <span>Date</span>

                  <DatePicker label="Date" value={date} onChange={setDate} />
                </div>
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
                    aria-pressed={category === item.name}
                  >
                    <CategoryIcon name={item.key} size={18} />
                    {item.name}
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
                  onClick={() => changeMode("equally")}
                  aria-pressed={mode === "equally"}
                >
                  Equally
                </button>

                <button
                  type="button"
                  className={mode === "exact" ? "active" : ""}
                  onClick={() => changeMode("exact")}
                  aria-pressed={mode === "exact"}
                >
                  Exact ₱
                </button>

                <button
                  type="button"
                  className={mode === "percent" ? "active" : ""}
                  onClick={() => changeMode("percent")}
                  aria-pressed={mode === "percent"}
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
                          {included && <Icon name="check" size={16} strokeWidth={3} />}
                        </button>
                      )}

                      <span className="ae-avatar">{initials(member.name)}</span>

                      <div className="ae-member-name">
                        <strong>
                          {member.id === userId ? "You" : member.name}
                        </strong>

                        {mode === "percent" && (
                          <small>{money(split[member.id] || 0)}</small>
                        )}
                        {mode === "exact" && total > 0 && (
                          <small>
                            {hundredthsToInput(exactPercents[member.id] ?? 0) ||
                              "0"}
                            % of total
                          </small>
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
                    <Icon name={validSplit ? "check" : "alert"} size={16} strokeWidth={2.4} />{" "}
                    {validSplit
                      ? "Split adds up correctly."
                      : difference < 0
                        ? `${mode === "percent" ? `${Math.abs(difference).toFixed(2).replace(/\.0+$/, "")}% still unassigned.` : `${money(-difference)} still unassigned.`}`
                        : difference > 0
                          ? `${mode === "percent" ? `${difference.toFixed(2).replace(/\.0+$/, "")}% over the total.` : `${money(difference)} over the expense total.`}`
                          : "Check the split amounts."}
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
                      ? ` · ${Math.abs(difference).toFixed(2).replace(/\.0+$/, "")}${unit} ${difference < 0 ? "left" : "over"}`
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
