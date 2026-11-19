"use client";

import Avatar from "@/components/Avatar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AppNav from "@/components/AppNav";
import Pagination from "@/components/Pagination";
import { useDebounced } from "@/lib/manemi/useDebounced";
import Icon from "@/components/Icon";
import PageHeader from "@/components/PageHeader";
import { useModalFocus } from "@/components/useModalFocus";
import type { CurrentUser } from "@/lib/manemi/groups";
import {
  listFriends,
  loadCurrentUser,
  searchFriends,
  removeFriendship,
  respondFriendRequest,
  sendFriendRequest,
  type FriendRow,
} from "@/lib/manemi/friends";
import "@/components/friends.css";
import "@/components/skeleton.css";
import "./friends-page.css";

// Pattern 1 (List / Index): manage your friends and requests.

export default function FriendsPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [rows, setRows] = useState<FriendRow[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const query = useDebounced(search.trim(), 300);
  const [friendPage, setFriendPage] = useState(1);
  const [friendItems, setFriendItems] = useState<FriendRow[]>([]);
  const [friendTotal, setFriendTotal] = useState(0);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [friendsVersion, setFriendsVersion] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState<FriendRow | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    try {
      const [me, friends] = await Promise.all([loadCurrentUser(supabase), listFriends(supabase)]);
      setUser(me);
      setRows(friends);
      setLoadError("");
      setFriendsVersion((value) => value + 1); // refresh the searched page too
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Couldn't load your friends.");
      setRows((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const friends = useMemo(() => (rows ?? []).filter((row) => row.direction === "friend"), [rows]);
  const incoming = useMemo(() => (rows ?? []).filter((row) => row.direction === "incoming"), [rows]);
  const outgoing = useMemo(() => (rows ?? []).filter((row) => row.direction === "outgoing"), [rows]);
  // The friends list is searched and paginated in the database (10 a page).
  useEffect(() => {
    setFriendPage(1);
  }, [query]);
  useEffect(() => {
    let active = true;
    setFriendsLoading(true);
    searchFriends(createClient(), query, friendPage)
      .then((result) => {
        if (!active) return;
        setFriendItems(result.items);
        setFriendTotal(result.total);
        if (!result.items.length && friendPage > 1) setFriendPage(Math.max(1, Math.ceil(result.total / 10)));
      })
      .catch((reason: unknown) => {
        if (active) setLoadError(reason instanceof Error ? reason.message : "Couldn't load your friends.");
      })
      .finally(() => {
        if (active) setFriendsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, friendPage, friendsVersion]);
  const visibleFriends = friendItems;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = identifier.trim();
    if (!value || sending) return;
    setSending(true);
    setFormError("");
    setNotice("");
    try {
      const result = await sendFriendRequest(createClient(), value);
      setIdentifier("");
      setNotice(
        result.status === "accepted"
          ? `You and ${result.name} are now friends.`
          : `Request sent to ${result.name}. You'll be friends once they accept.`,
      );
      await load();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Couldn't send the request.");
    } finally {
      setSending(false);
    }
  }

  async function act(row: FriendRow, action: "accept" | "decline" | "remove") {
    setBusy(row.friendshipId);
    setNotice("");
    setLoadError("");
    try {
      const supabase = createClient();
      if (action === "remove") await removeFriendship(supabase, row.friendshipId);
      else await respondFriendRequest(supabase, row.friendshipId, action === "accept");
      setNotice(
        action === "accept"
          ? `You and ${row.name} are now friends.`
          : action === "decline"
            ? `Declined ${row.name}'s request.`
            : row.direction === "outgoing"
              ? `Cancelled your request to ${row.name}.`
              : `Removed ${row.name} from your friends.`,
      );
      await load();
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
      setConfirmRemove(null);
    }
  }

  async function copyCode() {
    if (!user?.handle) return;
    try {
      await navigator.clipboard.writeText(user.handle);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const loading = rows === null;

  return (
    <main className="mn-app-page mn-friends-page">
      <div className="mn-friends-content">
        <PageHeader user={user} onNotificationsChange={() => void load()} />

        <div className="mn-friends-heading">
          <h1>Friends</h1>
          <p>Only friends can be invited to your groups.</p>
        </div>

        <section className="mn-friends-card" aria-labelledby="friends-add-title">
          <div className="mn-my-code">
            <div>
              <span>Your code</span>
              <strong>{user?.handle ? `@${user.handle}` : "—"}</strong>
            </div>
            <button
              type="button"
              className="mn-friends-secondary"
              onClick={() => void copyCode()}
              disabled={!user?.handle}
            >
              {copied ? "Copied" : "Copy Code"}
            </button>
          </div>
          <p className="mn-my-code-hint">Share your code so friends can add you, or add them below.</p>

          <form onSubmit={submit} className="mn-friends-form" noValidate>
            <h2 id="friends-add-title">Add a friend</h2>
            <div className="mn-friends-field">
              <label htmlFor="friend-identifier">User code or email</label>
              <div className="mn-friends-field-row">
                <input
                  ref={inputRef}
                  id="friend-identifier"
                  type="text"
                  inputMode="email"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="U-00012 or name@example.com"
                  value={identifier}
                  aria-invalid={Boolean(formError)}
                  aria-describedby={formError ? "friend-identifier-error" : undefined}
                  onChange={(event) => {
                    setIdentifier(event.target.value);
                    if (formError) setFormError("");
                  }}
                />
                <button type="submit" className="mn-friends-primary" disabled={!identifier.trim() || sending}>
                  {sending ? "Sending…" : "Send Request"}
                </button>
              </div>
              {formError && (
                <p id="friend-identifier-error" className="mn-friends-error" role="alert">
                  <Icon name="alert" size={16} /> {formError}
                </p>
              )}
            </div>
          </form>
          {notice && (
            <p className="mn-friends-notice" role="status">
              {notice}
            </p>
          )}
        </section>

        {loadError && (
          <div className="mn-friends-banner" role="alert">
            <span>{loadError}</span>
            <button type="button" className="mn-friends-secondary" onClick={() => void load()}>
              Try Again
            </button>
          </div>
        )}

        {incoming.length > 0 && (
          <section className="mn-friends-section" aria-labelledby="friends-requests">
            <h2 id="friends-requests" className="mn-friends-label">
              Requests · {incoming.length}
            </h2>
            <ul className="mn-friends-list">
              {incoming.map((row) => (
                <li key={row.friendshipId}>
                  <div className="mn-friend-row">
                    <span className="mn-friend-avatar" aria-hidden="true">
                      <Avatar name={row.name} url={row.avatarUrl} />
                    </span>
                    <span className="mn-friend-text">
                      <strong>{row.name}</strong>
                      <small>@{row.userCode} · wants to be friends</small>
                    </span>
                    <span className="mn-friend-actions">
                      <button
                        type="button"
                        className="mn-friends-primary"
                        disabled={busy === row.friendshipId}
                        onClick={() => void act(row, "accept")}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="mn-friends-secondary"
                        disabled={busy === row.friendshipId}
                        onClick={() => void act(row, "decline")}
                      >
                        Decline
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mn-friends-section" aria-labelledby="friends-list-title">
          <div className="mn-friends-section-head">
            <h2 id="friends-list-title" className="mn-friends-label">
              Friends{loading ? "" : ` · ${friends.length}`}
            </h2>
            {(friends.length > 6 || search) && (
              <div className="mn-friends-search">
                <label htmlFor="friends-search" className="mn-visually-hidden">
                  Search friends
                </label>
                <input
                  id="friends-search"
                  type="search"
                  placeholder="Search friends"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            )}
          </div>

          <ul className="mn-friends-list" aria-busy={loading || friendsLoading}>
            {loading || (friendsLoading && !friendItems.length && friends.length > 0) ? (
              [1, 2, 3].map((item) => (
                <li key={item} aria-hidden="true">
                  <div className="mn-friend-row">
                    <span className="mn-friend-avatar manemi-skeleton" />
                    <span className="mn-friend-text">
                      <span className="manemi-skeleton mn-skel-line" />
                      <span className="manemi-skeleton mn-skel-line is-short" />
                    </span>
                  </div>
                </li>
              ))
            ) : friends.length === 0 ? (
              <li className="mn-friends-empty">
                <strong>No friends yet</strong>
                <p>Add friends by their user code or email so you can invite them to groups.</p>
                <button type="button" className="mn-friends-primary" onClick={() => inputRef.current?.focus()}>
                  Add a Friend
                </button>
              </li>
            ) : visibleFriends.length === 0 && query ? (
              <li className="mn-friends-empty">
                <strong>No friends match “{query}”</strong>
                <p>Try a different name or code.</p>
                <button type="button" className="mn-friends-secondary" onClick={() => setSearch("")}>
                  Clear Search
                </button>
              </li>
            ) : (
              visibleFriends.map((row) => (
                <li key={row.friendshipId}>
                  <div className="mn-friend-row">
                    <span className="mn-friend-avatar" aria-hidden="true">
                      <Avatar name={row.name} url={row.avatarUrl} />
                    </span>
                    <span className="mn-friend-text">
                      <strong>{row.name}</strong>
                      <small>@{row.userCode}</small>
                    </span>
                    <button
                      type="button"
                      className="mn-friends-secondary"
                      disabled={busy === row.friendshipId}
                      onClick={() => setConfirmRemove(row)}
                      aria-label={`Remove ${row.name} from friends`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
          <Pagination
            page={friendPage}
            total={friendTotal}
            pageSize={10}
            onChange={setFriendPage}
            noun="friends"
            busy={friendsLoading}
          />
        </section>

        {outgoing.length > 0 && (
          <section className="mn-friends-section" aria-labelledby="friends-sent">
            <h2 id="friends-sent" className="mn-friends-label">
              Sent · {outgoing.length}
            </h2>
            <ul className="mn-friends-list">
              {outgoing.map((row) => (
                <li key={row.friendshipId}>
                  <div className="mn-friend-row">
                    <span className="mn-friend-avatar" aria-hidden="true">
                      <Avatar name={row.name} url={row.avatarUrl} />
                    </span>
                    <span className="mn-friend-text">
                      <strong>{row.name}</strong>
                      <small>@{row.userCode} · waiting for them to accept</small>
                    </span>
                    <button
                      type="button"
                      className="mn-friends-secondary"
                      disabled={busy === row.friendshipId}
                      onClick={() => void act(row, "remove")}
                    >
                      Cancel Request
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <AppNav active="friends" />

      {confirmRemove && (
        <RemoveFriendDialog
          friend={confirmRemove}
          busy={busy === confirmRemove.friendshipId}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => void act(confirmRemove, "remove")}
        />
      )}
    </main>
  );
}

/** Destructive confirmation: names the person, Cancel is focused first. */
function RemoveFriendDialog({
  friend,
  busy,
  onCancel,
  onConfirm,
}: {
  friend: FriendRow;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useModalFocus<HTMLElement>(onCancel);
  return (
    <div className="mn-popup-backdrop mn-popup-sheet-backdrop" onClick={() => !busy && onCancel()}>
      <section
        ref={ref}
        className="mn-popup-sheet mn-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-friend-title"
        aria-describedby="remove-friend-body"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="remove-friend-title">Remove {friend.name} as a friend?</h2>
        <p id="remove-friend-body">
          You&apos;ll stay together in any groups you already share, but you won&apos;t be able to invite
          each other to new groups until you&apos;re friends again.
        </p>
        <div className="mn-confirm-actions">
          <button type="button" className="mn-friends-secondary" onClick={onCancel} disabled={busy} data-autofocus>
            Cancel
          </button>
          <button type="button" className="mn-friends-danger mn-confirm-danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Removing…" : "Remove Friend"}
          </button>
        </div>
      </section>
    </div>
  );
}
