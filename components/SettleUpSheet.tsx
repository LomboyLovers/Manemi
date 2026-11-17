"use client";

import { createPortal } from "react-dom";
import { useState } from "react";
import { peso } from "@/lib/manemi/format";
import SettleUpForm from "./SettleUpForm";
import { useModalFocus } from "./useModalFocus";
import "./popups.css";
import "./settle-up.css";

export type GroupDebt = { userId: string; name: string; cents: number };

type Props = {
  groupId: string;
  groupName: string;
  /** People you owe in this group (cents > 0), largest first. */
  debts: GroupDebt[];
  /** Skip the list and open the form for this person. */
  initialReceiverId?: string;
  onClose: () => void;
  onRecorded: (message: string) => void;
};

/** Settle Debts for one group: pick who you're paying, then record it. */
export default function SettleUpSheet({ groupId, groupName, debts, initialReceiverId, onClose, onRecorded }: Props) {
  const [receiverId, setReceiverId] = useState<string | null>(
    initialReceiverId ?? (debts.length === 1 ? debts[0].userId : null),
  );
  const ref = useModalFocus<HTMLElement>(onClose);
  const target = debts.find((debt) => debt.userId === receiverId) ?? null;
  const canGoBack = Boolean(target) && debts.length > 1;

  // Portal: page containers use CSS containment, which would trap a fixed overlay.
  return createPortal(
    <div className="mn-popup-backdrop mn-popup-sheet-backdrop" onClick={onClose}>
      <section
        ref={ref}
        className="mn-popup-sheet mn-settle-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settle-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mn-popup-handle" aria-hidden="true" />
        <header className="mn-popup-sheet-header">
          {canGoBack ? (
            <button type="button" className="mn-popup-done mn-settle-back" onClick={() => setReceiverId(null)}>
              ‹ Back
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
          <h2 id="settle-title">Settle Debts</h2>
          <button type="button" className="mn-popup-done" onClick={onClose}>
            Close
          </button>
        </header>

        {target ? (
          <SettleUpForm
            key={target.userId}
            groupId={groupId}
            groupName={groupName}
            receiverId={target.userId}
            receiverName={target.name}
            owedCents={target.cents}
            onDone={onRecorded}
            onCancel={debts.length > 1 ? () => setReceiverId(null) : onClose}
          />
        ) : debts.length === 0 ? (
          <div className="mn-settle-empty">
            <strong>You don&apos;t owe anyone here</strong>
            <p>You&apos;re square with everyone in {groupName}.</p>
            <button type="button" className="mn-settle-cancel" onClick={onClose} data-autofocus>
              Close
            </button>
          </div>
        ) : (
          <>
            <p className="mn-settle-intro">Who did you pay back?</p>
            <ul className="mn-settle-list">
              {debts.map((debt) => (
                <li key={debt.userId}>
                  <button type="button" onClick={() => setReceiverId(debt.userId)}>
                    <span className="mn-settle-avatar" aria-hidden="true">
                      {debt.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="mn-settle-list-name">You owe {debt.name}</span>
                    <strong>{peso(debt.cents / 100)}</strong>
                    <span aria-hidden="true" className="mn-settle-chevron">
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
    ,
    document.body,
  );
}
