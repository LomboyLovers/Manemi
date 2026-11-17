"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  listFriends,
  listMyGroupInvitations,
  respondFriendRequest,
  respondGroupInvitation,
  type FriendRow,
  type GroupInvitation,
} from "@/lib/manemi/friends";
import "./friends.css";

type Props = {
  /** Called after something changes (e.g. a friend request was accepted). */
  onChange?: () => void;
};

/** Bell with a badge: group invitations and friend requests to accept or decline. */
export default function NotificationsBell({ onChange }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<FriendRow[]>([]);
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    try {
      const [friends, invites] = await Promise.all([
        listFriends(supabase),
        listMyGroupInvitations(supabase),
      ]);
      setRequests(friends.filter((row) => row.direction === "incoming"));
      setInvitations(invites);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't load notifications.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, load]);

  async function answerFriend(row: FriendRow, accept: boolean) {
    setBusy(row.friendshipId);
    try {
      await respondFriendRequest(createClient(), row.friendshipId, accept);
      setRequests((list) => list.filter((item) => item.friendshipId !== row.friendshipId));
      onChange?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't update the request.");
    } finally {
      setBusy(null);
    }
  }

  async function answerInvite(invite: GroupInvitation, accept: boolean) {
    setBusy(invite.invitationId);
    try {
      await respondGroupInvitation(createClient(), invite.invitationId, accept);
      setInvitations((list) => list.filter((item) => item.invitationId !== invite.invitationId));
      if (accept) {
        setOpen(false);
        router.push(`/groups/${invite.groupId}`);
      }
      onChange?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't update the invitation.");
      void load();
    } finally {
      setBusy(null);
    }
  }

  const count = requests.length + invitations.length;

  return (
    <div className="mn-header-bell" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="mn-header-circle"
        aria-label={count ? `Notifications, ${count} new` : "Notifications"}
        title="Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Image src="/icons/bell.png" alt="" width={20} height={20} />
        {count > 0 && (
          <span className="mn-bell-badge" aria-hidden="true">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="mn-notifications" role="dialog" aria-label="Notifications">
          {error && (
            <p className="mn-notifications-empty mn-friends-error" role="alert">
              {error}
            </p>
          )}

          {count === 0 && !error && (
            <p className="mn-notifications-empty">
              No new notifications. Friend requests and group invitations show up here.
            </p>
          )}

          {invitations.length > 0 && (
            <section aria-labelledby="bell-invites">
              <h2 id="bell-invites">Group invitations</h2>
              {invitations.map((invite) => (
                <div className="mn-notification" key={invite.invitationId}>
                  <p>
                    <b>{invite.invitedByName}</b> invited you to <b>{invite.groupName}</b> ·{" "}
                    {invite.memberCount} {invite.memberCount === 1 ? "member" : "members"}
                  </p>
                  <div className="mn-friend-actions">
                    <button
                      type="button"
                      className="mn-friends-primary"
                      disabled={busy === invite.invitationId}
                      onClick={() => void answerInvite(invite, true)}
                    >
                      Join Group
                    </button>
                    <button
                      type="button"
                      className="mn-friends-secondary"
                      disabled={busy === invite.invitationId}
                      onClick={() => void answerInvite(invite, false)}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {requests.length > 0 && (
            <section aria-labelledby="bell-requests">
              <h2 id="bell-requests">Friend requests</h2>
              {requests.map((row) => (
                <div className="mn-notification" key={row.friendshipId}>
                  <p>
                    <b>{row.name}</b> (@{row.userCode}) wants to be friends
                  </p>
                  <div className="mn-friend-actions">
                    <button
                      type="button"
                      className="mn-friends-primary"
                      disabled={busy === row.friendshipId}
                      onClick={() => void answerFriend(row, true)}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="mn-friends-secondary"
                      disabled={busy === row.friendshipId}
                      onClick={() => void answerFriend(row, false)}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          <Link className="mn-notifications-footer" href="/friends" onClick={() => setOpen(false)}>
            Manage friends
          </Link>
        </div>
      )}
    </div>
  );
}
