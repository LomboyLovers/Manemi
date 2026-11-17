"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  inviteFriends,
  listFriends,
  pendingInviteeIds,
  type FriendRow,
} from "@/lib/manemi/friends";
import { initialOf } from "@/lib/manemi/format";
import { useModalFocus } from "./useModalFocus";
import "./popups.css";
import "./friends.css";

type Props = {
  groupId: string;
  groupName: string;
  /** Current members, shown as "In group" and not selectable. */
  memberIds: string[];
  onClose: () => void;
};

/**
 * Owner/admin picks friends to invite (checkboxes). Only accepted friends are
 * listed; the database rejects anyone else anyway.
 */
export default function InviteFriendsSheet({ groupId, groupName, memberIds, onClose }: Props) {
  const router = useRouter();
  const ref = useModalFocus<HTMLElement>(onClose);
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    Promise.all([listFriends(supabase), pendingInviteeIds(supabase, groupId)])
      .then(([rows, invited]) => {
        if (!active) return;
        setFriends(rows.filter((row) => row.direction === "friend"));
        setPending(invited);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Couldn't load your friends.");
      });
    return () => {
      active = false;
    };
  }, [groupId]);

  const members = useMemo(() => new Set(memberIds), [memberIds]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (friends ?? []).filter(
      (friend) =>
        !query ||
        friend.name.toLowerCase().includes(query) ||
        friend.userCode.toLowerCase().includes(query),
    );
  }, [friends, search]);

  function toggle(userId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function send() {
    if (!selected.size || sending) return;
    setSending(true);
    setError("");
    setNotice("");
    try {
      const results = await inviteFriends(createClient(), groupId, [...selected]);
      const invited = results.filter((result) => result.status === "invited").map((result) => result.userId);
      const nameOf = (id: string) => friends?.find((friend) => friend.userId === id)?.name ?? "a friend";
      setPending((current) => new Set([...current, ...invited]));
      setSelected(new Set());
      setNotice(
        invited.length
          ? `Invited ${invited.map(nameOf).join(", ")}. They'll see it under the bell.`
          : "Nobody new was invited.",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't send the invitations.");
    } finally {
      setSending(false);
    }
  }

  const count = selected.size;

  return (
    <div className="mn-popup-backdrop mn-popup-sheet-backdrop" onClick={() => !sending && onClose()}>
      <section
        ref={ref}
        className="mn-popup-sheet mn-invite-friends"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-friends-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mn-popup-handle" aria-hidden="true" />
        <header className="mn-popup-sheet-header">
          <button type="button" className="mn-popup-done mn-popup-cancel" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <h2 id="invite-friends-title">Invite Friends</h2>
          <span aria-hidden="true" />
        </header>

        <p className="mn-friends-sub">
          Choose friends to invite to <b>{groupName}</b>. They accept the invitation in the app.
        </p>

        {friends === null && !error ? (
          <p className="mn-friends-state" aria-busy="true">Loading your friends…</p>
        ) : friends && friends.length === 0 ? (
          <div className="mn-friends-empty">
            <strong>No friends yet</strong>
            <p>Only friends can be invited to groups. Add friends by their user code or email first.</p>
            <button type="button" className="mn-friends-primary" onClick={() => router.push("/friends")}>
              Add Friends
            </button>
          </div>
        ) : (
          <>
            {(friends?.length ?? 0) > 6 && (
              <div className="mn-friends-search">
                <label htmlFor="invite-friends-search" className="mn-visually-hidden">
                  Search friends
                </label>
                <input
                  id="invite-friends-search"
                  type="search"
                  placeholder="Search friends"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            )}
            <ul className="mn-friends-list mn-friends-pick" aria-label="Friends">
              {visible.map((friend) => {
                const inGroup = members.has(friend.userId);
                const invited = pending.has(friend.userId);
                return (
                  <li key={friend.userId}>
                    <label className={`mn-friend-row ${inGroup ? "is-disabled" : ""}`}>
                      <input
                        type="checkbox"
                        checked={selected.has(friend.userId)}
                        disabled={inGroup || sending}
                        onChange={() => toggle(friend.userId)}
                      />
                      <span className="mn-friend-avatar" aria-hidden="true">
                        {initialOf(friend.name)}
                      </span>
                      <span className="mn-friend-text">
                        <strong>{friend.name}</strong>
                        <small>@{friend.userCode}</small>
                      </span>
                      {inGroup ? (
                        <span className="mn-friend-tag">In group</span>
                      ) : invited ? (
                        <span className="mn-friend-tag is-accent">Invited</span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
              {visible.length === 0 && (
                <li className="mn-friends-state">No friends match “{search}”.</li>
              )}
            </ul>
          </>
        )}

        {error && (
          <p className="mn-friends-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="mn-friends-notice" role="status">
            {notice}
          </p>
        )}

        {friends && friends.length > 0 && (
          <button
            type="button"
            className="mn-friends-primary mn-friends-submit"
            disabled={!count || sending}
            onClick={() => void send()}
          >
            {sending
              ? "Sending Invitations…"
              : count
                ? `Invite ${count} ${count === 1 ? "Friend" : "Friends"}`
                : "Choose Friends to Invite"}
          </button>
        )}
      </section>
    </div>
  );
}
