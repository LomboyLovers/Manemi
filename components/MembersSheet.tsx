"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";
import { useModalFocus } from "./useModalFocus";
import { isZero, peso } from "@/lib/manemi/format";
import "./popups.css";
import "./members-sheet.css";

export type MemberRow = {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  role: "owner" | "admin" | "member";
  userCode?: string | null;
  /** Net balance in this group, pesos: positive = is owed, negative = owes. */
  net: number;
};

type Props = {
  groupName: string;
  members: MemberRow[];
  meId: string | null;
  myRole: "owner" | "admin" | "member";
  archived: boolean;
  /** Removes them (throw an Error to show its message). */
  onRemove: (member: MemberRow) => Promise<void>;
  onClose: () => void;
};

const ROLE_ORDER = { owner: 0, admin: 1, member: 2 } as const;

/**
 * GROUP-03 / GROUP-04: everyone in the group. Members can only look; the owner
 * (and admins, for regular members) can remove someone who is settled up.
 * Removal is confirmed inside the row, so no second popup stacks on this one.
 */
export default function MembersSheet({ groupName, members, meId, myRole, archived, onRemove, onClose }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const close = () => {
    if (!busy) onClose();
  };
  const ref = useModalFocus<HTMLElement>(close);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Cancel gets focus when a confirmation opens (safe default).
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const canManage = !archived && (myRole === "owner" || myRole === "admin");
  const canRemove = (member: MemberRow) =>
    canManage &&
    member.userId !== meId &&
    (myRole === "owner" ? member.role !== "owner" : member.role === "member");

  const sorted = [...members].sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      Number(b.userId === meId) - Number(a.userId === meId) ||
      a.name.localeCompare(b.name),
  );

  async function remove(member: MemberRow) {
    setBusy(true);
    setError("");
    try {
      await onRemove(member);
      setConfirming(null);
      setNotice(`Removed ${member.name} from the group.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't remove them. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="mn-popup-backdrop mn-popup-sheet-backdrop" onClick={close}>
      <section
        ref={ref}
        className="mn-popup-sheet mn-members"
        role="dialog"
        aria-modal="true"
        aria-labelledby="members-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mn-popup-handle" aria-hidden="true" />
        <header className="mn-members-head">
          <div>
            <h2 id="members-title">Members</h2>
            <p>
              {members.length} {members.length === 1 ? "person" : "people"} in {groupName}
            </p>
          </div>
          <button type="button" className="mn-members-close" aria-label="Close members" onClick={close}>
            ×
          </button>
        </header>

        <ul className="mn-members-list">
          {sorted.map((member) => {
            const isMe = member.userId === meId;
            const removable = canRemove(member);
            const settled = isZero(member.net);
            const open = confirming === member.userId;
            return (
              <li key={member.userId} className={`mn-member ${open ? "is-confirming" : ""}`}>
                <div className="mn-member-main">
                  <span className="mn-member-avatar" aria-hidden="true">
                    <Avatar name={member.name} url={member.avatarUrl ?? null} />
                  </span>
                  <span className="mn-member-text">
                    <strong>
                      {member.name}
                      {isMe && <span className="mn-member-you"> (you)</span>}
                      {member.role !== "member" && (
                        <span className={`mn-member-role is-${member.role}`}>
                          {member.role === "owner" ? "Owner" : "Admin"}
                        </span>
                      )}
                    </strong>
                    {member.userCode && <small>@{member.userCode}</small>}
                  </span>
                  {removable && !open &&
                    (settled ? (
                      <button
                        type="button"
                        className="mn-member-remove"
                        aria-label={`Remove ${member.name} from the group`}
                        disabled={busy}
                        onClick={() => {
                          setError("");
                          setNotice("");
                          setConfirming(member.userId);
                        }}
                      >
                        Remove
                      </button>
                    ) : (
                      <span className="mn-member-blocked" title="Only members who are settled up can be removed">
                        {member.net < 0 ? `Owes ${peso(-member.net)}` : `Is owed ${peso(member.net)}`}
                      </span>
                    ))}
                </div>

                {open && (
                  <div className="mn-member-confirm" role="group" aria-label={`Confirm removing ${member.name}`}>
                    <p>
                      <b>
                        Remove {member.name} from “{groupName}”?
                      </b>{" "}
                      They&apos;ll lose access to this group. Their past expenses and payments stay in the history, and
                      you can invite them again later.
                    </p>
                    <div className="mn-member-confirm-actions">
                      <button
                        ref={cancelRef}
                        type="button"
                        className="mn-confirm-cancel"
                        disabled={busy}
                        onClick={() => setConfirming(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="mn-confirm-destructive"
                        disabled={busy}
                        onClick={() => void remove(member)}
                      >
                        {busy ? "Removing…" : `Remove ${member.name}`}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {error && (
          <p className="mn-popup-error" role="alert">
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="mn-members-notice" role="status">
            {notice}
          </p>
        )}
        <p className="mn-members-note">
          {archived
            ? "This group is archived, so its members can't change."
            : canManage
              ? "Only members who are settled up can be removed."
              : "Only the owner or an admin can remove members."}
        </p>
      </section>
    </div>,
    document.body,
  );
}
