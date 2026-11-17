"use client";

import { createPortal } from "react-dom";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cleanError } from "@/lib/manemi/friends";
import { useModalFocus } from "./useModalFocus";
import "./popups.css";

type Props = {
  groupId: string;
  groupName: string;
  onClose: () => void;
  /** Called after the server removed the membership. */
  onLeft: () => void;
};

/**
 * Named destructive confirmation for leaving a group. Cancel has focus by
 * default; the server (`leave_group`) refuses owners and anyone with an open
 * balance in the group, and its message is shown as-is.
 */
export default function LeaveGroupDialog({ groupId, groupName, onClose, onLeft }: Props) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    if (!leaving) onClose();
  };
  const ref = useModalFocus<HTMLElement>(close);

  async function leave() {
    setLeaving(true);
    setError("");
    const { error: rpcError } = await createClient().rpc("leave_group", { p_group_id: groupId });
    if (rpcError) {
      setError(cleanError(rpcError, "Couldn't leave the group. Try again."));
      setLeaving(false);
      return;
    }
    onLeft();
  }

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
        <h2 id="leave-title">Leave “{groupName}”?</h2>
        <p id="leave-body">
          You&apos;ll stop seeing this group and its expenses. Past expenses stay in the group for
          everyone else. To come back, an owner or admin has to invite you again.
        </p>
        {error && (
          <p className="mn-popup-error" role="alert">
            {error}
          </p>
        )}
        <div className="mn-confirm-actions">
          <button type="button" className="mn-confirm-cancel" onClick={close} disabled={leaving} data-autofocus>
            Cancel
          </button>
          <button type="button" className="mn-confirm-destructive" onClick={leave} disabled={leaving}>
            {leaving ? "Leaving…" : "Leave group"}
          </button>
        </div>
      </section>
    </div>
    ,
    document.body,
  );
}
