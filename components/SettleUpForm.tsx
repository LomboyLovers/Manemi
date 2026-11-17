"use client";

import { useId, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { peso } from "@/lib/manemi/format";
import { notifyDataChanged } from "@/lib/manemi/events";
import DatePicker, { toIso } from "./DatePicker";
import "./settle-up.css";

export type SettleTarget = {
  groupId: string;
  groupName: string;
  receiverId: string;
  receiverName: string;
  /** What you currently owe them in this group (cents). */
  owedCents: number;
};

type Props = SettleTarget & {
  onDone: (message: string) => void;
  onCancel?: () => void;
};

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "gcash", label: "GCash" },
  { value: "bank_transfer", label: "Bank transfer" },
] as const;

/** Parses "1,250.5" -> 125050 cents; null when it isn't a valid amount. */
function toCents(text: string) {
  const clean = text.replace(/[₱,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

async function functionErrorMessage(error: unknown, fallback: string) {
  const response = (error as { context?: Response })?.context;
  if (response) {
    try {
      const body = await response.clone().json();
      if (body?.error === "Validation failed" && body.details) {
        const first = Object.values(body.details as Record<string, string[]>)[0]?.[0];
        if (first) return first;
      }
      if (body?.error) return String(body.error);
    } catch {
      // fall through
    }
  }
  return fallback;
}

/**
 * Records that you paid someone back (full or partial). Saved through the
 * `record-settlement` Edge Function, which also writes the audit log entry.
 */
export default function SettleUpForm({ groupId, groupName, receiverId, receiverName, owedCents, onDone, onCancel }: Props) {
  const [amount, setAmount] = useState((owedCents / 100).toFixed(2));
  const [amountError, setAmountError] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("cash");
  const [date, setDate] = useState(() => toIso(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const amountId = useId();

  const validate = () => {
    const cents = toCents(amount);
    if (cents === null || cents <= 0) return "Enter an amount, like 250 or 250.50.";
    if (cents > owedCents) return `That's more than you owe ${receiverName} (${peso(owedCents / 100)}).`;
    return "";
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validate();
    setAmountError(problem);
    if (problem || saving) return;
    const cents = toCents(amount)!;
    setSaving(true);
    setError("");
    // Today = right now; another day = midday of that day (never in the future).
    const when = date === toIso(new Date()) ? new Date() : new Date(`${date}T12:00:00`);
    const { data, error: fnError } = await createClient().functions.invoke("record-settlement", {
      body: {
        groupId,
        receiverId,
        amount: cents / 100,
        paymentMethod: method,
        date: when.toISOString(),
      },
    });
    if (fnError || data?.error) {
      setError(
        fnError
          ? await functionErrorMessage(fnError, "Couldn't record the payment. Check your connection and try again.")
          : String(data.error),
      );
      setSaving(false);
      return;
    }
    notifyDataChanged();
    onDone(
      cents === owedCents
        ? `Paid ${receiverName} ${peso(cents / 100)}. You're square with them in ${groupName}.`
        : `Recorded ${peso(cents / 100)} to ${receiverName}. You still owe ${peso((owedCents - cents) / 100)}.`,
    );
  }

  const cents = toCents(amount);
  const isFull = cents === owedCents;

  return (
    <form className="mn-settle" onSubmit={submit} noValidate>
      <div className="mn-settle-who">
        <span className="mn-settle-avatar" aria-hidden="true">
          {receiverName.charAt(0).toUpperCase()}
        </span>
        <div>
          <strong>Pay {receiverName}</strong>
          <span>
            {groupName} · you owe {peso(owedCents / 100)}
          </span>
        </div>
      </div>

      <div className="mn-settle-field">
        <label htmlFor={amountId}>Amount</label>
        <div className={`mn-settle-amount ${amountError ? "has-error" : ""}`}>
          <span aria-hidden="true">₱</span>
          <input
            id={amountId}
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            aria-invalid={Boolean(amountError)}
            aria-describedby={amountError ? `${amountId}-err` : undefined}
            onChange={(event) => {
              setAmount(event.target.value);
              setAmountError("");
            }}
            onFocus={() => setAmountError("")}
            onBlur={() => setAmountError(validate())}
          />
          {!isFull && (
            <button type="button" className="mn-settle-full" onClick={() => setAmount((owedCents / 100).toFixed(2))}>
              Pay full
            </button>
          )}
        </div>
        {amountError && (
          <p id={`${amountId}-err`} className="mn-settle-error">
            {amountError}
          </p>
        )}
      </div>

      <fieldset className="mn-settle-field mn-settle-methods">
        <legend>Paid with</legend>
        <div>
          {METHODS.map((option) => (
            <label key={option.value} className={method === option.value ? "is-selected" : ""}>
              <input
                type="radio"
                name={`${amountId}-method`}
                value={option.value}
                checked={method === option.value}
                onChange={() => setMethod(option.value)}
              />
              {option.label}
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
        {onCancel && (
          <button type="button" className="mn-settle-cancel" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button type="submit" className="mn-settle-submit" disabled={saving}>
          {saving ? "Recording…" : `Record ${cents && cents > 0 ? peso(cents / 100) : "payment"}`}
        </button>
      </div>
      <p className="mn-settle-note">This only records the payment in Manemi — send the money yourself first.</p>
    </form>
  );
}
