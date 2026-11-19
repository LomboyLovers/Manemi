"use client";

import { notifyDataChanged, useDataVersion } from "@/lib/manemi/events";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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
import {
  listActivityNotifications,
  markNotificationsSeen,
  timeAgo,
  type ActivityNotification,
} from "@/lib/manemi/notifications";
import "./friends.css";

/**
 * Backup check while the tab is visible. Changes normally arrive instantly
 * through live updates (lib/manemi/realtime.ts → data-changed event).
 */
const POLL_MS = 5 * 60_000;

type Props = {
  /** Called after something changes (e.g. a friend request was accepted). */
  onChange?: () => void;
};

/**
 * Bell with a badge: group invitations and friend requests to answer, plus
 * activity (new/edited expenses that include you, payments to or from you).
 */
export default function NotificationsBell({ onChange }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<FriendRow[]>([]);
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [activity, setActivity] = useState<ActivityNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const dataVersion = useDataVersion();
  const [error, setError] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const me = session?.user?.id;
    if (!me) return;
    // Each source loads on its own, so one failing never hides the others.
    const [friends, invites, feed] = await Promise.allSettled([
      listFriends(supabase),
      listMyGroupInvitations(supabase),
      listActivityNotifications(supabase, me),
    ]);
    if (friends.status === "fulfilled") setRequests(friends.value.filter((row) => row.direction === "incoming"));
    if (invites.status === "fulfilled") setInvitations(invites.value);
    if (feed.status === "fulfilled") {
      setActivity(feed.value.items);
      setUnread(feed.value.unread);
    }
    const failed = [friends, invites, feed].find((result) => result.status === "rejected");
    setError(
      failed && failed.status === "rejected"
        ? failed.reason instanceof Error
          ? failed.reason.message
          : "Couldn't load notifications."
        : "",
    );
  }, []);

  // Load on mount, whenever data changes (including live updates from other
  // people), when the tab comes back into view, and every 5 minutes as a backup.
  useEffect(() => {
    void load();
  }, [load, dataVersion]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  // On phones the panel spans the screen (16px margins), just below the bell.
  const [panelTop, setPanelTop] = useState(0);
  useEffect(() => {
    if (!open) return;
    const place = () => setPanelTop((buttonRef.current?.getBoundingClientRect().bottom ?? 0) + 10);
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Opening the bell marks activity read (the dots stay until it closes).
    void load().then(async () => {
      try {
        await markNotificationsSeen(createClient());
        setUnread(0);
      } catch {
        // Stays unread; tried again next time the bell opens.
      }
    });
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
      // Closed: clear the "new" dots now that they've been seen.
      setActivity((list) => (list.some((item) => item.unread) ? list.map((item) => ({ ...item, unread: false })) : list));
    };
  }, [open, load]);

  async function answerFriend(row: FriendRow, accept: boolean) {
    setBusy(row.friendshipId);
    try {
      await respondFriendRequest(createClient(), row.friendshipId, accept);
      setRequests((list) => list.filter((item) => item.friendshipId !== row.friendshipId));
      notifyDataChanged();
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
        // NOTIF-03: confirmation email (best effort; never blocks joining).
        void createClient()
          .functions.invoke("notify-group-joined", { body: { groupId: invite.groupId } })
          .catch(() => undefined);
        setOpen(false);
        router.push(`/groups/${invite.groupId}`);
      }
      notifyDataChanged();
      onChange?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't update the invitation.");
      void load();
    } finally {
      setBusy(null);
    }
  }

  const count = requests.length + invitations.length + unread;
  const empty = requests.length + invitations.length + activity.length === 0;

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
        <div
          className="mn-notifications"
          role="dialog"
          aria-label="Notifications"
          style={{ "--mn-bell-top": `${panelTop}px` } as CSSProperties}
        >
          {error && (
            <p className="mn-notifications-empty mn-friends-error" role="alert">
              {error}
            </p>
          )}

          {empty && !error && (
            <p className="mn-notifications-empty">
              No notifications yet. New expenses that include you, payments, friend requests and
              group invitations show up here.
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

          {activity.length > 0 && (
            <section aria-labelledby="bell-activity">
              <h2 id="bell-activity">Activity</h2>
              <ul className="mn-activity-list">
                {activity.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className={`mn-activity-item${item.unread ? " is-unread" : ""}`}
                      onClick={() => setOpen(false)}
                    >
                      <span className="mn-activity-dot" aria-hidden="true" />
                      <span className="mn-activity-body">
                        <span className="mn-activity-text">
                          <b>{item.text.actor}</b> {item.text.verb} <b>{item.text.object}</b>
                        </span>
                        <span className="mn-activity-meta">
                          {item.detail && <>{item.detail} · </>}
                          {item.groupName}
                        </span>
                      </span>
                      <time className="mn-activity-time" dateTime={item.date} title={new Date(item.date).toLocaleString()}>
                        {timeAgo(item.date)}
                      </time>
                      {item.unread && <span className="mn-visually-hidden">(new)</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="mn-notifications-footer-row">
            <Link className="mn-notifications-footer" href="/history" onClick={() => setOpen(false)}>
              All activity
            </Link>
            <Link className="mn-notifications-footer" href="/friends" onClick={() => setOpen(false)}>
              Manage friends
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
