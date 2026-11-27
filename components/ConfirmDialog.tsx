"use client";

import { createPortal } from "react-dom";
import { useState, type ReactNode } from "react";
import { useSheet } from "./useModalFocus";
import "./popups.css";

type Props = {
  /** Names the thing, e.g. `Remove Kurt from “Trip”?` */
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Throw an Error to show its message and keep the dialog open. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

/** Named confirmation (Cancel focused, Escape cancels). */
export default function ConfirmDialog({ title, children, confirmLabel, destructive, onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guardedClose = () => {
    if (!busy) onClose();
  };
  const { ref, close } = useSheet<HTMLElement>(guardedClose);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return createPortal(
    <div className="mn-popup-backdrop mn-popup-sheet-backdrop" onClick={close}>
      <section
        ref={ref}
        className="mn-popup-sheet mn-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mn-popup-handle" aria-hidden="true" />
        <h2 id="confirm-title">{title}</h2>
        {children}
        {error && (
          <p className="mn-popup-error" role="alert">
            {error}
          </p>
        )}
        <div className="mn-confirm-actions">
          <button type="button" className="mn-confirm-cancel" onClick={close} disabled={busy} data-autofocus>
            Cancel
          </button>
          <button
            type="button"
            className={destructive ? "mn-confirm-destructive" : "mn-confirm-primary"}
            onClick={confirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
