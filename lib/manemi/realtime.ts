"use client";

// Live updates over one Supabase Realtime connection. The database pushes a
// tiny "row changed" message (row-level security decides who receives it);
// the app then refreshes through the normal notifyDataChanged path, at most
// once per burst. Nothing polls. The connection is closed while the app is
// in the background and reopened (with one catch-up refresh) when it returns.

import { useEffect } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { notifyDataChanged } from "./events";

/** Many changes in a row (e.g. an expense and its splits) → one refresh. */
const DEBOUNCE_MS = 800;
/** Keep the connection through quick app switches; close it after this. */
const HIDDEN_GRACE_MS = 30_000;

// Inserts and updates only: Realtime can't check access on deleted rows, so
// delete events would wake every connected user (they're ignored below).
// Deletes that matter (an expense removed, someone leaving) are also written
// to Group_Activity as inserts.
const WATCHED = [
  "Group_Activity", // expenses, payments, renames, removals
  "Group_Member", // someone joined one of your groups
  "Group_Invitation", // invited / invitation answered
  "Friendship", // friend request sent / accepted
];

let users = 0;
let channel: RealtimeChannel | null = null;
let refreshTimer: number | undefined;
let hiddenTimer: number | undefined;
let releaseTimer: number | undefined;
/** Page changes unmount and remount the nav; keep the connection across them. */
const RELEASE_MS = 5_000;

function scheduleRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(notifyDataChanged, DEBOUNCE_MS);
}

let connecting: Promise<void> | null = null;

function connect() {
  connecting ??= open().finally(() => {
    connecting = null;
  });
  return connecting;
}

async function open() {
  if (channel) return;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session || channel || users === 0) return;
  // Realtime checks row-level security with this token.
  await supabase.realtime.setAuth(session.access_token);
  let next = supabase.channel("manemi-live");
  for (const table of WATCHED) {
    next = next.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
      if (payload.eventType !== "DELETE") scheduleRefresh();
    });
  }
  channel = next;
  next.subscribe();
}

function disconnect() {
  if (!channel) return;
  void createClient().removeChannel(channel);
  channel = null;
}

function onVisibility() {
  window.clearTimeout(hiddenTimer);
  if (document.visibilityState === "hidden") {
    hiddenTimer = window.setTimeout(disconnect, HIDDEN_GRACE_MS);
  } else if (!channel) {
    void connect();
    scheduleRefresh(); // catch up on anything missed while away
  }
}

/** Keep the open page live. Safe to call from several components: one connection is shared. */
export function useLiveUpdates() {
  useEffect(() => {
    users += 1;
    window.clearTimeout(releaseTimer);
    if (users === 1) {
      void connect();
      document.addEventListener("visibilitychange", onVisibility);
    }
    return () => {
      users -= 1;
      if (users > 0) return;
      releaseTimer = window.setTimeout(() => {
        if (users > 0) return;
        document.removeEventListener("visibilitychange", onVisibility);
        window.clearTimeout(hiddenTimer);
        window.clearTimeout(refreshTimer);
        disconnect();
      }, RELEASE_MS);
    };
  }, []);
}
