"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { peso } from "@/lib/manemi/format";
import { callFunction } from "@/lib/manemi/functions";
import { notifyDataChanged } from "@/lib/manemi/events";
import ConfirmDialog from "./ConfirmDialog";
import DatePicker, { toIso } from "./DatePicker";
import Pagination from "./Pagination";
import { useSheet } from "./useModalFocus";
import "./settle-up.css";
import "./popups.css";

export type PaymentRow = {
  settlementId: string;
  payerId: string;
  receiverId: string;
  amount: number | string;
  paymentMethod?: string | null;
  settledAt?: string | null;
  createdAt?: string | null;
};

type Props = {
  payments: PaymentRow[];
  me: string;
  /** Owners and admins can change anyone's payments; others only their own. */
  canManageAll: boolean;
  nameOf: (id: string) => string;
};

const METHOD: Record<string, string> = { cash: "Cash", gcash: "GCash", bank_transfer: "Bank transfer" };
const PER_PAGE = 10;

/** SET-04/05: recorded payments in the group, with edit and delete. */
export default function PaymentsList({ payments, me, canManageAll, nameOf }: Props) {
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PaymentRow | null>(null);
  const [deleting, setDeleting] = useState<PaymentRow | null>(null);
  const sorted = [...payments].sort((a, b) =>
    String(b.settledAt ?? b.createdAt ?? "").localeCompare(String(a.settledAt ?? a.createdAt ?? "")),
  );
  const pageNow = Math.min(page, Math.max(1, Math.ceil(sorted.length / PER_PAGE)));
  const who = (id: string) => (id === me ? "You" : nameOf(id));

  if (!sorted.length) {
    return <p className="md-balances-empty">No payments recorded yet. Use Settle Debts after you pay someone back.</p>;
  }

  return (
    <>
      <ul className="mn-payments">
        {sorted.slice((pageNow - 1) * PER_PAGE, pageNow * PER_PAGE).map((payment) => {
          const canManage = canManageAll || payment.payerId === me;
          const when = payment.settledAt ?? payment.createdAt;
          return (
            <li key={payment.settlementId}>
              <div className="mn-payment-text">
                <strong>
                  {who(payment.payerId)} paid {payment.receiverId === me ? "you" : nameOf(payment.receiverId)}
                </strong>
                <small>
                  {when ? new Date(when).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : ""}
                  {" · "}
                  {METHOD[String(payment.paymentMethod)] ?? "Cash"}
                </small>
              </div>
              <strong className="mn-payment-amount">{peso(Number(payment.amount) || 0)}</strong>
              {canManage && (
                <span className="mn-payment-actions">
                  <button type="button" onClick={() => setEditing(payment)} aria-label={`Edit payment of ${peso(Number(payment.amount))}`}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    onClick={() => setDeleting(payment)}
                    aria-label={`Delete payment of ${peso(Number(payment.amount))}`}
                  >
                    Delete
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <Pagination page={pageNow} total={sorted.length} pageSize={PER_PAGE} onChange={setPage} noun="payments" />

      {editing && <EditPaymentDialog payment={editing} onClose={() => setEditing(null)} title={`${who(editing.payerId)} → ${editing.receiverId === me ? "you" : nameOf(editing.receiverId)}`} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete the ${peso(Number(deleting.amount))} payment from ${who(deleting.payerId)} to ${deleting.receiverId === me ? "you" : nameOf(deleting.receiverId)}?`}
          confirmLabel="Delete payment"
          destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await callFunction("delete-settlement", { settlementId: deleting.settlementId });
            setDeleting(null);
            notifyDataChanged();
          }}
        >
          <p>The debt it paid comes back. The deletion is kept in the audit log.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function EditPaymentDialog({ payment, title, onClose }: { payment: PaymentRow; title: string; onClose: () => void }) {
  const [amount, setAmount] = useState((Number(payment.amount) || 0).toFixed(2));
  const [method, setMethod] = useState(String(payment.paymentMethod ?? "cash"));
  const [date, setDate] = useState(toIso(new Date(payment.settledAt ?? payment.createdAt ?? new Date())));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const guardedClose = () => {
    if (!saving) onClose();
  };
  const { ref, close } = useSheet<HTMLElement>(guardedClose);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(amount.replace(/[₱,\s]/g, ""));
    if (!Number.isFinite(value) || value <= 0 || !/^\d+(\.\d{0,2})?$/.test(amount.replace(/[₱,\s]/g, ""))) {
      setError("Enter an amount, like 250 or 250.50.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const when = date === toIso(new Date()) ? new Date() : new Date(`${date}T12:00:00`);
      await callFunction(
        "update-settlement",
        { settlementId: payment.settlementId, amount: value, paymentMethod: method, date: when.toISOString() },
        "PUT",
      );
      notifyDataChanged();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save the payment.");
      setSaving(false);
    }
  }

  return createPortal(
    <div className="mn-popup-backdrop mn-popup-sheet-backdrop" onClick={close}>
      <section
        ref={ref}
        className="mn-popup-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-payment-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mn-popup-handle" aria-hidden="true" />
        <header className="mn-popup-sheet-header">
          <span aria-hidden="true" />
          <h2 id="edit-payment-title">Edit payment</h2>
          <button type="button" className="mn-popup-done" onClick={close}>
            Close
          </button>
        </header>
        <form className="mn-settle" onSubmit={save} noValidate>
          <p className="mn-settle-intro">{title}</p>
          <div className="mn-settle-field">
            <label htmlFor="edit-payment-amount">Amount</label>
            <div className="mn-settle-amount">
              <span aria-hidden="true">₱</span>
              <input
                id="edit-payment-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setError("");
                }}
              />
            </div>
          </div>
          <fieldset className="mn-settle-field mn-settle-methods">
            <legend>Paid with</legend>
            <div>
              {Object.entries(METHOD).map(([value, label]) => (
                <label key={value} className={method === value ? "is-selected" : ""}>
                  <input type="radio" name="edit-payment-method" value={value} checked={method === value} onChange={() => setMethod(value)} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mn-settle-field mn-settle-date">
            <span>Date paid</span>
            <DatePicker label="Date paid" value={date} onChange={setDate} max={toIso(new Date())} />
          </div>
          {error && (
            <p className="mn-settle-error" role="alert">
              {error}
            </p>
          )}
          <div className="mn-settle-actions">
            <button type="button" className="mn-settle-cancel" onClick={close} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="mn-settle-submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}
