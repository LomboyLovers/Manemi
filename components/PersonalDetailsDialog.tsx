"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { deletePersonal, getPersonal, type PersonalExpense } from "@/lib/manemi/personal";
import { notifyDataChanged } from "@/lib/manemi/events";
import { receiptLink } from "@/lib/manemi/functions";
import { CATEGORY_META, categoryKey, money } from "@/lib/manemi/format";
import { useSheet } from "./useModalFocus";
import ConfirmDialog from "./ConfirmDialog";
import "./popups.css";
import "./personal-details.css";

type Props = {
  id: string;
  onClose: () => void;
  /** Called after the expense is deleted (the popup has already closed). */
  onDeleted?: () => void;
};

/** Read-only details of one personal expense; Edit opens the form, Delete asks first. */
export default function PersonalDetailsDialog({ id, onClose, onDeleted }: Props) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Paused while the delete confirmation is on top, so Escape closes only that.
  const { ref, close } = useSheet<HTMLElement>(onClose, !confirmDelete);
  const [expense, setExpense] = useState<PersonalExpense | null>(null);
  const [error, setError] = useState("");
  const [receiptError, setReceiptError] = useState("");

  useEffect(() => {
    let alive = true;
    getPersonal(createClient(), id)
      .then((found) => {
        if (!alive) return;
        if (found) setExpense(found);
        else setError("That expense doesn't exist anymore.");
      })
      .catch((reason) => alive && setError(reason instanceof Error ? reason.message : "Couldn't open that expense."));
    return () => {
      alive = false;
    };
  }, [id]);

  const meta = expense ? CATEGORY_META[categoryKey(expense.category)] : null;
  const when = expense
    ? new Date(expense.date).toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    : "";

  return createPortal(
    <>
      <div className="mn-popup-backdrop mn-popup-sheet-backdrop mn-popup-center" onClick={close}>
        <section
          ref={ref}
          className="mn-popup-sheet mn-pd"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pd-title"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mn-popup-handle" aria-hidden="true" />
          <p className="mn-pd-kind">Personal expense</p>
          {error ? (
            <p className="mn-pd-error" role="alert">
              {error}
            </p>
          ) : !expense ? (
            <div className="mn-pd-loading" aria-label="Loading">
              <span className="manemi-skeleton mn-pd-skel-title" />
              <span className="manemi-skeleton mn-pd-skel-line" />
              <span className="manemi-skeleton mn-pd-skel-line" />
            </div>
          ) : (
            <>
              <h2 id="pd-title">{expense.title}</h2>
              <p className="mn-pd-amount">{money(expense.amount, expense.currency)}</p>
              <dl className="mn-pd-list">
                <div>
                  <dt>Category</dt>
                  <dd>
                    <span className="mn-pd-dot" style={{ background: meta?.color }} aria-hidden="true" />
                    {meta?.label}
                  </dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{when}</dd>
                </div>
                <div>
                  <dt>Paid by</dt>
                  <dd>You · only you</dd>
                </div>
                {expense.note && (
                  <div>
                    <dt>Note</dt>
                    <dd className="mn-pd-note">{expense.note}</dd>
                  </div>
                )}
                {expense.receiptUrl && (
                  <div>
                    <dt>Receipt</dt>
                    <dd>
                      <button
                        type="button"
                        className="mn-pd-link"
                        onClick={async () => {
                          setReceiptError("");
                          try {
                            const link = await receiptLink(expense.receiptUrl);
                            if (link) window.open(link, "_blank", "noopener");
                          } catch (reason) {
                            setReceiptError(reason instanceof Error ? reason.message : "Couldn't open the receipt.");
                          }
                        }}
                      >
                        View receipt
                      </button>
                    </dd>
                  </div>
                )}
              </dl>
              {receiptError && (
                <p className="mn-pd-error" role="alert">
                  {receiptError}
                </p>
              )}
            </>
          )}
          <div className="mn-confirm-actions mn-pd-actions">
            <button type="button" className="mn-confirm-cancel" onClick={close} data-autofocus>
              Close
            </button>
            {expense && (
              <button
                type="button"
                className="mn-confirm-primary"
                onClick={() => router.push(`/personal/add?edit=${encodeURIComponent(expense.id)}`)}
              >
                Edit
              </button>
            )}
          </div>
          {expense && (
            <button type="button" className="mn-pd-delete" onClick={() => setConfirmDelete(true)}>
              Delete expense
            </button>
          )}
        </section>
      </div>

      {confirmDelete && expense && (
        <ConfirmDialog
          title={`Delete "${expense.title}"?`}
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            await deletePersonal(createClient(), expense);
            notifyDataChanged();
            onClose();
            onDeleted?.();
          }}
          onClose={() => setConfirmDelete(false)}
        >
          <p>This personal expense{expense.receiptUrl ? " and its receipt" : ""} will be removed. This can&apos;t be undone.</p>
        </ConfirmDialog>
      )}
    </>,
    document.body,
  );
}
