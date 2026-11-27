"use client";

import { useEffect, useMemo, useState } from "react";
import { useSlidingPill } from "@/components/useSlidingPill";

import { useParams, useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import {
  bpsToWeight,
  centsToWeight,
  cleanDecimalInput,
  equalWeights,
  FULL_PERCENT_BPS,
  hundredthsToInput,
  toBps,
  toCents,
  weightsToBps,
  weightsToCents,
  withShare,
  type SplitMode,
  type Weights,
} from "@/lib/manemi/split";

import DatePicker from "@/components/DatePicker";
import Select from "@/components/Select";
import Avatar from "@/components/Avatar";
import CategoryIcon from "@/components/CategoryIcon";
import { notifyDataChanged } from "@/lib/manemi/events";
import Icon from "@/components/Icon";
import { CURRENCIES, categoryKey, money as formatMoney, type CategoryKey } from "@/lib/manemi/format";
import { callFunction } from "@/lib/manemi/functions";

import "./add-expense.css";

/** create-expense / update-expense responses (shape varies by version). */
type SaveResponse = { expense?: { expenseId?: string }; expenseId?: string; data?: { expense?: { expenseId?: string } } };

type Group = { groupId: string; name: string; createdBy: string };

type Member = { id: string; name: string; avatarUrl?: string | null };

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

const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const RECEIPT_MAX = 5 * 1024 * 1024;

const parseCents = toCents;


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
  // UX-04: how often you've used each category recently (most used first).
  const [categoryUse, setCategoryUse] = useState<Record<string, number>>({});

  const [mode, setMode] = useState<SplitMode>("equally");
  const modesPill = useSlidingPill<HTMLDivElement>();

  // The one source for the split: each member's share of the whole expense.
  // Equally / Exact / Percent are only views of it.
  const [weights, setWeights] = useState<Weights>({});

  // Text of the share input being typed in, so "12." or "0.0" isn't reformatted mid-typing.
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);

  // ?edit=<expenseId> opens an existing expense (EXP-09).
  const [editId] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("edit") ?? "",
  );
  const [currency, setCurrency] = useState("PHP");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [existingReceipt, setExistingReceipt] = useState<string | null>(null);
  const money = (cents: number) => formatMoney(cents / 100, currency);
  const symbol = CURRENCIES.find((item) => item.code === currency)?.symbol ?? "₱";

  useEffect(() => {
    let alive = true;

    async function load() {
      const supabase = createClient();

      // Local session read (no auth round trip); the queries below are still
      // checked by the database with this session's token.
      const { data: sessionData, error: authError } = await supabase.auth.getSession();
      const auth = { user: sessionData.session?.user ?? null };

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
        .select("userId, name, avatarUrl")
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
      const avatars = new Map(
        (profiles ?? []).map((profile) => [profile.userId as string, (profile.avatarUrl as string | null) ?? null]),
      );
      const groupMembers: Member[] = memberIds.map((id) => ({
        id,
        avatarUrl: avatars.get(id) ?? null,
        name:
          profileNames.get(id)?.trim() ||
          (id === me.id ? displayName : "Group member"),
      }));

      setGroup(data);
      setUserId(auth.user.id);
      setMembers(groupMembers);
      setWeights(equalWeights(memberIds));

      // Your most-used categories (from expenses you paid recently) come first.
      const { data: recentCategories } = await supabase
        .from("Expense")
        .select("category")
        .eq("paidBy_UserId", auth.user.id)
        .not("groupId", "is", null)
        .order("expenseDate", { ascending: false })
        .limit(60);
      if (!alive) return;
      const use: Record<string, number> = {};
      for (const row of recentCategories ?? []) {
        const key = categoryKey(String(row.category ?? ""));
        use[key] = (use[key] ?? 0) + 1;
      }
      setCategoryUse(use);
      const favorite = categories
        .filter((item) => (use[item.key] ?? 0) > 0)
        .sort((a, b) => (use[b.key] ?? 0) - (use[a.key] ?? 0))[0];
      if (favorite && !editId) setCategory(favorite.name);
      setPayerId(auth.user.id);

      if (editId) {
        const [expenseResult, splitResult] = await Promise.all([
          supabase
            .from("Expense")
            .select("expenseId, groupId, title, totalAmount, expenseDate, category, currency, paidBy_UserId, receiptUrl")
            .eq("expenseId", editId)
            .maybeSingle(),
          supabase.from("Expense_Split").select("userId, amountOwed, percentage").eq("expenseId", editId),
        ]);
        if (!alive) return;
        const expense = expenseResult.data;
        if (!expense || expense.groupId !== params.groupId) {
          setError("That expense wasn't found in this group.");
          setLoading(false);
          return;
        }
        const totalCents = Math.round(Number(expense.totalAmount) * 100);
        setAmount((totalCents / 100).toFixed(2));
        setTitle(String(expense.title ?? ""));
        setPayerId(String(expense.paidBy_UserId));
        const when = new Date(expense.expenseDate);
        setDate(`${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`);
        const key = categoryKey(expense.category);
        setCategory((categories.find((item) => item.key === key)?.name ?? "Other") as Category);
        setCurrency(String(expense.currency ?? "PHP"));
        setExistingReceipt((expense.receiptUrl as string | null) ?? null);

        const rows = (splitResult.data ?? []) as Array<{ userId: string; amountOwed: number | string | null; percentage: number | string | null }>;
        if (rows.length) {
          const cents = rows.map((row) => Math.round(Number(row.amountOwed ?? 0) * 100));
          if (rows.every((row) => row.percentage !== null && row.percentage !== undefined)) {
            setMode("percent");
          } else if (Math.max(...cents) - Math.min(...cents) <= 1) {
            setMode("equally");
          } else {
            setMode("exact");
          }
          // The saved amounts are the shared split; every mode views them.
          setWeights(Object.fromEntries(rows.map((row, index) => [row.userId, centsToWeight(cents[index], totalCents)])));
        }
      }
      setLoading(false);
    }

    void load();

    return () => {
      alive = false;
    };
  }, [params.groupId, editId]);

  const total = parseCents(amount);

  const memberIds = useMemo(() => members.map((member) => member.id), [members]);
  const selected = useMemo(() => withShare(memberIds, weights), [memberIds, weights]);

  // Each member's share in cents and in basis points (100% = 10000), both
  // read from the same weights, so the views always agree.
  const split = useMemo(() => weightsToCents(total, memberIds, weights), [total, memberIds, weights]);
  const shareBps = useMemo(() => weightsToBps(memberIds, weights), [memberIds, weights]);

  const assigned = Object.values(split).reduce((sum, cents) => sum + cents, 0);
  const percentageBps = Object.values(shareBps).reduce((sum, bps) => sum + bps, 0);
  const percentageSum = percentageBps / 100;

  const invalidPercentage =
    mode === "percent" && selected.some((id) => (shareBps[id] ?? 0) > FULL_PERCENT_BPS);

  // Whoever paid must have a share of the expense.
  const payerHasShare =
    !payerId || (mode === "equally" ? selected.includes(payerId) : (split[payerId] ?? 0) > 0 || (total <= 0 && (shareBps[payerId] ?? 0) > 0));
  const payerLabel = payerId === userId ? "You" : members.find((member) => member.id === payerId)?.name ?? "The payer";
  const splitAddsUp =
    selected.length > 0 &&
    (mode === "equally" ||
      (mode === "exact"
        ? assigned === total
        : percentageBps === FULL_PERCENT_BPS && !invalidPercentage));
  const validSplit = splitAddsUp && payerHasShare;

  /** Switch views. Exact and Percent show the same split; Equally evens it out among the people in it. */
  function changeMode(next: SplitMode) {
    if (next === mode) return;
    if (next === "equally") {
      // Everyone who had a share, plus whoever paid.
      const people = memberIds.filter((member) => member === payerId || selected.includes(member));
      setWeights(equalWeights(people.length ? people : memberIds));
    }
    setDraft(null);
    setMode(next);
  }

  /** Typing a share in Exact (₱) or Percent (%) updates the shared split. */
  function changeShare(id: string, text: string) {
    setDraft({ id, text });
    const weight = mode === "exact" ? centsToWeight(toCents(text), total) : bpsToWeight(toBps(text));
    setWeights((current) => ({ ...current, [id]: weight }));
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
                ? (shareBps[member.id] ?? 0) > 0
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

              percentage: (shareBps[member.id] ?? 0) / 100,
              // The amount shown on screen; the server keeps it when it matches the percentage.
              amount: (split[member.id] ?? 0) / 100,
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

      const data = editId
        ? await callFunction<SaveResponse>(
            "update-expense",
            { ...payload, groupId: undefined, expenseId: editId, currency, receiptUrl: existingReceipt },
            "PUT",
          )
        : await callFunction<SaveResponse>(
            "create-expense",
            { ...payload, currency },
          );

      const savedId = editId || data?.expense?.expenseId || data?.data?.expense?.expenseId || data?.expenseId || "";

      // EXP-08: the receipt is uploaded after the expense exists.
      if (receiptFile && savedId) {
        const form = new FormData();
        form.append("expenseId", savedId);
        form.append("file", receiptFile);
        try {
          await callFunction("upload-receipt", form);
        } catch (uploadError) {
          throw new Error(
            `The expense was saved, but the receipt didn't upload: ${uploadError instanceof Error ? uploadError.message : "try again"}. Open the expense and edit it to attach the receipt again.`,
          );
        }
      }

      // Only announce success after the Edge Function confirms creation.

      // The returned ID lets Group Details locate the exact saved expense.

      const createdExpenseId = editId ? null : savedId || null;

      const destination = new URLSearchParams();

      if (typeof createdExpenseId === "string" && createdExpenseId) {
        destination.set("expenseAdded", createdExpenseId);
      }
      if (editId) destination.set("expense", editId);

      notifyDataChanged(); // Home/Groups/History must not show cached totals
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

  /** Paid by: the new payer always gets a share (Equally adds them back in). */
  function changePayer(id: string) {
    setPayerId(id);
    if (mode === "equally" && !selected.includes(id)) {
      setWeights(equalWeights(memberIds.filter((member) => member === id || selected.includes(member))));
    }
  }

  /** Equally: include or exclude someone, then even out the shares again. The payer stays in. */
  const toggleMember = (id: string) => {
    if (id === payerId && selected.includes(id)) return;
    const next = memberIds.filter((member) => (member === id ? !selected.includes(member) : selected.includes(member)));
    setWeights(equalWeights(next));
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

          <h1>{editId ? "Edit Expense" : "Add Expense"}</h1>

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
                  <span aria-hidden="true">{symbol}</span>

                  <input
                    id="ae-amount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    value={amount}
                    // Numbers only: digits and one decimal point, up to ₱99,999,999.99.
                    onChange={(e) => setAmount(cleanDecimalInput(e.target.value))}
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
                    onChange={changePayer}
                    options={members.map((member) => {
                      const name = member.id === userId ? "You" : member.name;
                      return {
                        value: member.id,
                        label: name,
                        icon: (
                          <span className="ae-payer-avatar" aria-hidden="true">
                            <Avatar name={member.name || "?"} url={member.avatarUrl} />
                          </span>
                        ),
                      };
                    })}
                  />
                </div>

                <div className="ae-info-row">
                  <span id="ae-currency-label">Currency</span>

                  <Select
                    id="ae-currency"
                    label="Currency"
                    value={currency}
                    onChange={setCurrency}
                    options={CURRENCIES.map((item) => ({
                      value: item.code,
                      label: `${item.symbol} ${item.code}`,
                      hint: item.code === "PHP" ? item.label : `${item.label} · not in peso balances`,
                    }))}
                  />
                </div>

                <div className="ae-info-row">
                  <span>Date</span>

                  <DatePicker label="Date" value={date} onChange={setDate} />
                </div>

                <div className="ae-info-row ae-receipt-row">
                  <span>Receipt</span>
                  <div className="ae-receipt">
                    {receiptFile ? (
                      <>
                        <span className="ae-receipt-name">{receiptFile.name}</span>
                        <button type="button" onClick={() => setReceiptFile(null)}>
                          Remove
                        </button>
                      </>
                    ) : existingReceipt ? (
                      <span className="ae-receipt-name">Receipt attached</span>
                    ) : null}
                    <label className="ae-receipt-pick">
                      <input
                        type="file"
                        accept={RECEIPT_TYPES.join(",")}
                        className="ae-visually-hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          event.target.value = "";
                          if (!file) return;
                          if (!RECEIPT_TYPES.includes(file.type)) {
                            setReceiptError("Use a JPG, PNG or WebP photo.");
                            return;
                          }
                          if (file.size > RECEIPT_MAX) {
                            setReceiptError("That photo is over 5 MB. Choose a smaller one.");
                            return;
                          }
                          setReceiptError("");
                          setReceiptFile(file);
                        }}
                      />
                      {receiptFile || existingReceipt ? "Replace" : "Attach photo"}
                    </label>
                  </div>
                </div>
                {receiptError && (
                  <p className="ae-receipt-error" role="alert">
                    {receiptError}
                  </p>
                )}
              </div>

              <div className="ae-section-label">
                <h2>Category</h2>

                <span>{Object.keys(categoryUse).length ? "Most used first" : "Choose one"}</span>
              </div>

              <div className="ae-categories">
                {[...categories]
                  .sort((a, b) => (categoryUse[b.key] ?? 0) - (categoryUse[a.key] ?? 0))
                  .map((item) => (
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

              <div ref={modesPill} className="ae-modes mn-pill" role="group" aria-label="Split method">
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
                  Exact {symbol}
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

              {mode === "exact" && total <= 0 && (
                <p className="ae-split-hint">Enter the amount first to split it by exact amounts.</p>
              )}

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
                          aria-label={
                            member.id === payerId && included
                              ? `${member.name} paid, so they're included`
                              : `${included ? "Exclude" : "Include"} ${member.name}`
                          }
                          aria-disabled={member.id === payerId && included}
                          title={member.id === payerId && included ? "The person who paid is always part of the split" : undefined}
                        >
                          {included && <Icon name="check" size={16} strokeWidth={3} />}
                        </button>
                      )}

                      <span className="ae-avatar" aria-hidden="true">
                        <Avatar name={member.name} url={member.avatarUrl} />
                      </span>

                      <div className="ae-member-name">
                        <strong>
                          {member.id === userId ? "You" : member.name}
                        </strong>

                        {mode === "percent" && (
                          <small>{money(split[member.id] || 0)}</small>
                        )}
                        {mode === "exact" && total > 0 && (
                          <small>
                            {hundredthsToInput(shareBps[member.id] ?? 0) ||
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

                          {mode === "exact" && <span>{symbol}</span>}

                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="0"
                            disabled={mode === "exact" && total <= 0}
                            value={
                              draft?.id === member.id
                                ? draft.text
                                : hundredthsToInput(
                                    mode === "exact" ? split[member.id] ?? 0 : shareBps[member.id] ?? 0,
                                  )
                            }
                            onChange={(e) =>
                              changeShare(member.id, cleanDecimalInput(e.target.value, mode === "percent" ? 3 : 8))
                            }
                            onBlur={() => setDraft(null)}
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
                          : !payerHasShare
                            ? `${payerLabel} paid, so ${payerLabel === "You" ? "you need" : "they need"} a share too.`
                            : "Check the split amounts."}
                  </strong>

                  <span>
                    {validSplit
                      ? "Everyone's share is assigned."
                      : !payerHasShare && splitAddsUp
                        ? `Give ${payerLabel === "You" ? "yourself" : payerLabel} part of the amount, or change who paid.`
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
                  {saving ? "Saving..." : editId ? "Save Changes" : "Save Expense"}
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
