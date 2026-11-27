"use client";

import { createPortal } from "react-dom";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cleanError } from "@/lib/manemi/friends";
import { peso } from "@/lib/manemi/format";
import { notifyDataChanged } from "@/lib/manemi/events";
import { useSheet } from "./useModalFocus";
import "./popups.css";

/** Signed balance with one person in the group: pesos, positive = they owe you. */
export type LeaveBalance = { userId: string; name: string; amount: number };

type Props = {
  groupId: string;
  groupName: string;
  /** Your balances in this group (from the page's ledger). */
  balances?: LeaveBalance[];
  onClose: () => void;
  /** Called after the server removed the membership. */
  onLeft: () => void;
  /** Opens Settle Debts (shown when you still owe someone). */
  onSettle?: () => void;
};

/**
 * Named destructive confirmation for leaving a group. Cancel has focus by
 * default. The server (`leave_group`) is the source of truth:
 *  - owners can't leave;
 *  - if you owe anyone, you must settle first;
 *  - if people owe you, you must confirm (they're listed here).
 */
export default function LeaveGroupDialog({ groupId, groupName, balances = [], onClose, onLeft, onSettle }: Props) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const guardedClose = () => {
    if (!leaving) onClose();
  };
  const { ref, close } = useSheet<HTMLElement>(guardedClose);

  const owes = balances.filter((item) => item.amount <= -0.005);
  const owedBy = balances.filter((item) => item.amount >= 0.005);
  const mode = owes.length ? "owes" : owedBy.length ? "collectibles" : "plain";

  async function leave() {
    setLeaving(true);
    setError("");
    const { error: rpcError } = await createClient().rpc("leave_group", {
      p_group_id: groupId,
      p_leave_collectibles: mode === "collectibles",
    });
    if (rpcError) {
      setError(cleanError(rpcError, "Couldn't leave the group. Try again."));
      setLeaving(false);
      return;
    }
    notifyDataChanged();
    onLeft();
  }

  const title =
    mode === "owes"
      ? `Settle up before leaving “${groupName}”`
      : mode === "collectibles"
        ? `You still have collectibles in “${groupName}”`
        : `Leave “${groupName}”?`;

  // Portal: page containers use CSS containment, which would trap a fixed overlay.
  return createPortal(
    <div className="mn-popup-backdrop mn-popup-sheet-backdrop" onClick={close}>
      <section
        ref={ref}
        className="mn-popup-sheet mn-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        aria-describedby="leave-body"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mn-popup-handle" aria-hidden="true" />
        <h2 id="leave-title">{title}</h2>

        {mode === "owes" ? (
          <>
            <p id="leave-body">You can leave once you&apos;ve paid back everyone you owe here.</p>
            <BalanceList items={owes} tone="negative" />
          </>
        ) : mode === "collectibles" ? (
          <>
            <p id="leave-body">
              These people still owe you. If you leave, their debts stay on record, but you won&apos;t
              see this group anymore unless an owner or admin invites you back.
            </p>
            <BalanceList items={owedBy} tone="positive" />
          </>
        ) : (
          <p id="leave-body">
            You&apos;ll stop seeing this group and its expenses. Past expenses stay in the group for
            everyone else. To come back, an owner or admin has to invite you again.
          </p>
        )}

        {error && (
          <p className="mn-popup-error" role="alert">
            {error}
          </p>
        )}
        <div className="mn-confirm-actions">
          <button type="button" className="mn-confirm-cancel" onClick={close} disabled={leaving} data-autofocus>
            Cancel
          </button>
          {mode === "owes" ? (
            onSettle ? (
              <button type="button" className="mn-confirm-primary" onClick={onSettle}>
                Settle Debts
              </button>
            ) : null
          ) : (
            <button type="button" className="mn-confirm-destructive" onClick={leave} disabled={leaving}>
              {leaving ? "Leaving…" : mode === "collectibles" ? "Leave anyway" : "Leave group"}
            </button>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function BalanceList({ items, tone }: { items: LeaveBalance[]; tone: "positive" | "negative" }) {
  return (
    <ul className={`mn-leave-list is-${tone}`}>
      {items.map((item) => (
        <li key={item.userId}>
          <span className="mn-leave-avatar" aria-hidden="true">
            {item.name.charAt(0).toUpperCase()}
          </span>
          <span className="mn-leave-name">
            {tone === "positive" ? `${item.name} owes you` : `You owe ${item.name}`}
          </span>
          <strong>{peso(Math.abs(item.amount))}</strong>
        </li>
      ))}
    </ul>
  );
}
