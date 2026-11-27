"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import DatePicker from "@/components/DatePicker";
import Select from "@/components/Select";
import CategoryIcon from "@/components/CategoryIcon";
import ConfirmDialog from "@/components/ConfirmDialog";
import { notifyDataChanged } from "@/lib/manemi/events";
import { CURRENCIES, CATEGORY_META, categoryKey, type CategoryKey } from "@/lib/manemi/format";
import { cleanDecimalInput, toCents } from "@/lib/manemi/split";
import { receiptLink } from "@/lib/manemi/functions";
import {
  deletePersonal,
  getPersonal,
  PERSONAL_NOTE_MAX,
  removePersonalReceipt,
  savePersonal,
  uploadPersonalReceipt,
  type PersonalExpense,
} from "@/lib/manemi/personal";
import "../../groups/[groupId]/add-expense/add-expense.css";
import "../personal.css";

// Pattern 3 (Form): add or edit one personal expense. No group, no split.

const CATEGORY_KEYS: CategoryKey[] = ["food", "transport", "lodging", "shopping", "utilities", "entertainment", "other"];
const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const RECEIPT_MAX = 5 * 1024 * 1024;

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

// The edit id comes from useSearchParams, not window.location: on an in-app
// tap (History → Edit) this page renders before the address bar changes, so
// window.location still showed /history and Edit opened a blank new expense.
export default function AddPersonalExpensePage() {
  return (
    <Suspense fallback={<FormShell />}>
      <PersonalExpenseRoute />
    </Suspense>
  );
}

function PersonalExpenseRoute() {
  const editId = useSearchParams().get("edit");
  // A new key resets every field when moving between "add" and "edit X".
  return <PersonalExpenseForm key={editId ?? "new"} editId={editId} />;
}

function FormShell() {
  return (
    <main className="ae-page">
      <section className="ae-sheet">
        <div className="ae-handle" aria-hidden="true" />
        <p className="ae-state">Loading…</p>
      </section>
    </main>
  );
}

function PersonalExpenseForm({ editId }: { editId: string | null }) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(Boolean(editId));
  const [loadError, setLoadError] = useState("");
  const [existing, setExisting] = useState<PersonalExpense | null>(null);

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("PHP");
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(today);
  const [category, setCategory] = useState<CategoryKey>("food");
  const [categoryUse, setCategoryUse] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [keepReceipt, setKeepReceipt] = useState(true);
  const [receiptError, setReceiptError] = useState("");
  const [titleError, setTitleError] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setUserId(data.session?.user.id ?? "");

      // UX-04: your most used personal categories first.
      const { data: recent } = await supabase
        .from("Expense")
        .select("category")
        .is("groupId", null)
        .order("expenseDate", { ascending: false })
        .limit(60);
      if (!alive) return;
      const use: Record<string, number> = {};
      for (const row of recent ?? []) {
        const key = categoryKey(String(row.category ?? ""));
        use[key] = (use[key] ?? 0) + 1;
      }
      setCategoryUse(use);
      const favorite = [...CATEGORY_KEYS].sort((a, b) => (use[b] ?? 0) - (use[a] ?? 0))[0];
      if (!editId && use[favorite]) setCategory(favorite);

      if (editId) {
        try {
          const found = await getPersonal(supabase, editId);
          if (!alive) return;
          if (!found) {
            setLoadError("That expense doesn't exist anymore.");
          } else {
            setExisting(found);
            setAmount(found.amount.toFixed(2));
            setCurrency(found.currency);
            setTitle(found.title);
            const when = new Date(found.date);
            setDay(`${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`);
            setCategory(categoryKey(found.category));
            setNote(found.note ?? "");
          }
        } catch (reason) {
          if (alive) setLoadError(reason instanceof Error ? reason.message : "Couldn't open that expense.");
        } finally {
          if (alive) setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [editId]);

  const symbol = CURRENCIES.find((item) => item.code === currency)?.symbol ?? "₱";
  const cents = toCents(amount);
  const hasReceipt = Boolean(receiptFile) || (keepReceipt && Boolean(existing?.receiptUrl));
  const formValid = cents > 0 && title.trim().length > 0 && note.length <= PERSONAL_NOTE_MAX;
  const back = () => router.push("/history?type=personal");

  async function save() {
    if (!title.trim()) setTitleError("Enter what it was for.");
    if (!formValid || saving || !userId) return;
    setSaving(true);
    setSaveError("");
    const supabase = createClient();
    try {
      let receiptUrl = keepReceipt ? existing?.receiptUrl ?? null : null;
      if (receiptFile) receiptUrl = await uploadPersonalReceipt(supabase, userId, receiptFile);
      const id = await savePersonal(
        supabase,
        userId,
        { title, amount: cents / 100, currency, category, day, note, receiptUrl },
        existing?.id,
      );
      // Replaced or removed receipt: delete the old file.
      if (existing?.receiptUrl && existing.receiptUrl !== receiptUrl) await removePersonalReceipt(supabase, existing.receiptUrl);
      notifyDataChanged();
      router.push(`/history?type=personal&saved=${encodeURIComponent(id)}`);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "Couldn't save the expense. Try again.");
      setSaving(false);
    }
  }

  /** Errors are thrown so the dialog shows them and stays open. */
  async function remove() {
    if (!existing) return;
    setDeleting(true);
    try {
      await deletePersonal(createClient(), existing);
    } catch (reason) {
      setDeleting(false);
      throw reason;
    }
    notifyDataChanged();
    router.push("/history?type=personal&deleted=1");
  }

  return (
    <main className="ae-page">
      <section className="ae-sheet">
        <div className="ae-handle" aria-hidden="true" />

        <header className="ae-header">
          <button type="button" className="ae-cancel" onClick={back}>
            Cancel
          </button>
          <h1>{editId ? "Edit Expense" : "Personal Expense"}</h1>
          <span aria-hidden="true" />
        </header>

        {loading ? (
          <p className="ae-state">Loading…</p>
        ) : loadError ? (
          <p className="ae-state" role="alert">
            {loadError}
          </p>
        ) : (
          <form
            className="pe-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            noValidate
          >
            <div className="ae-amount-block">
              <label htmlFor="pe-amount">Amount</label>
              <div className="ae-amount-input">
                <span aria-hidden="true">{symbol}</span>
                <input
                  id="pe-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => setAmount(cleanDecimalInput(event.target.value))}
                  style={{ width: `${Math.max((amount || "0.00").length, 1) + 0.6}ch` }}
                />
              </div>
            </div>

            <label className="ae-visually-hidden" htmlFor="pe-title">
              What was it for?
            </label>
            <input
              id="pe-title"
              className="ae-title-input"
              maxLength={100}
              placeholder="What was it for?"
              value={title}
              aria-invalid={Boolean(titleError)}
              aria-describedby={titleError ? "pe-title-error" : undefined}
              onChange={(event) => {
                setTitle(event.target.value);
                if (titleError) setTitleError("");
              }}
              onBlur={() => setTitleError(title.trim() || !amount ? "" : "Enter what it was for.")}
            />
            {titleError && (
              <p id="pe-title-error" className="ae-receipt-error pe-field-error" role="alert">
                {titleError}
              </p>
            )}

            <div className="ae-info-box">
              <div className="ae-info-row">
                <span>Type</span>
                <strong className="ae-group-name pe-private">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                  Personal · only you
                </strong>
              </div>

              <div className="ae-info-row">
                <span id="pe-currency-label">Currency</span>
                <Select
                  id="pe-currency"
                  label="Currency"
                  value={currency}
                  onChange={setCurrency}
                  options={CURRENCIES.map((item) => ({ value: item.code, label: `${item.symbol} ${item.code}`, hint: item.label }))}
                />
              </div>

              <div className="ae-info-row">
                <span>Date</span>
                <DatePicker label="Date" value={day} onChange={setDay} max={today()} />
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
                  ) : keepReceipt && existing?.receiptUrl ? (
                    <>
                      <button
                        type="button"
                        className="pe-receipt-view"
                        onClick={async () => {
                          try {
                            const link = await receiptLink(existing.receiptUrl);
                            if (link) window.open(link, "_blank", "noopener");
                          } catch (reason) {
                            setReceiptError(reason instanceof Error ? reason.message : "Couldn't open the receipt.");
                          }
                        }}
                      >
                        View
                      </button>
                      <button type="button" onClick={() => setKeepReceipt(false)}>
                        Remove
                      </button>
                    </>
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
                    {hasReceipt ? "Replace" : "Attach photo"}
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
              {[...CATEGORY_KEYS]
                .sort((a, b) => (categoryUse[b] ?? 0) - (categoryUse[a] ?? 0))
                .map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={category === key ? "active" : ""}
                    onClick={() => setCategory(key)}
                    aria-pressed={category === key}
                  >
                    <CategoryIcon name={key} size={18} />
                    {CATEGORY_META[key].label}
                  </button>
                ))}
            </div>

            <div className="ae-section-label">
              <h2>
                <label htmlFor="pe-note">Note</label>
              </h2>
              <span>Optional</span>
            </div>
            <textarea
              id="pe-note"
              className="pe-note"
              rows={3}
              maxLength={PERSONAL_NOTE_MAX}
              placeholder="Anything to remember about it"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <small className="pe-note-count">
              {note.length}/{PERSONAL_NOTE_MAX}
            </small>

            <div className="ae-footer">
              <p>{!cents || !title.trim() ? "Enter an amount and a title to continue" : "Only you can see this expense"}</p>
              <button type="submit" disabled={!formValid || saving || deleting}>
                {saving ? "Saving..." : editId ? "Save Changes" : "Save Expense"}
              </button>
              {editId && existing && (
                <button type="button" className="pe-delete" onClick={() => setConfirmDelete(true)} disabled={saving || deleting}>
                  Delete Expense
                </button>
              )}
              {saveError && (
                <p role="alert" className="pe-save-error">
                  {saveError}
                </p>
              )}
            </div>
          </form>
        )}
      </section>

      {confirmDelete && existing && (
        <ConfirmDialog
          title={`Delete "${existing.title}"?`}
          confirmLabel="Delete Expense"
          destructive
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        >
          <p>This personal expense{existing.receiptUrl ? " and its receipt" : ""} will be removed. This can&apos;t be undone.</p>
        </ConfirmDialog>
      )}
    </main>
  );
}
