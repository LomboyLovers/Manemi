// Friends + group invitations: thin wrappers over the database functions in
// supabase/migrations/20261117064513_friendships.sql and
// 20261117064616_friends_only_group_invitations.sql. The rules (friends only,
// owner/admin only) live in the database; these just call them.

import type { createClient } from "@/lib/supabase/client";

type Supabase = ReturnType<typeof createClient>;

export type FriendDirection = "friend" | "incoming" | "outgoing";

export type FriendRow = {
  friendshipId: string;
  userId: string;
  name: string;
  userCode: string;
  avatarUrl: string | null;
  direction: FriendDirection;
  createdAt: string;
};

export type GroupInvitation = {
  invitationId: string;
  groupId: string;
  groupName: string;
  memberCount: number;
  invitedById: string;
  invitedByName: string;
  createdAt: string;
};

export type InviteOutcome = {
  userId: string;
  status: "invited" | "already_member" | "not_friend";
};

/** "FORBIDDEN: Only the owner…" -> "Only the owner…" */
export function cleanError(error: unknown, fallback: string) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  return message.replace(/^(FORBIDDEN|NOT_FOUND|CONFLICT|INVALID):\s*/, "") || fallback;
}

export async function listFriends(supabase: Supabase): Promise<FriendRow[]> {
  const { data, error } = await supabase.rpc("list_friends");
  if (error) throw new Error(cleanError(error, "Couldn't load your friends."));
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    friendshipId: String(row.friendship_id),
    userId: String(row.user_id),
    name: String(row.name ?? "Manemi user"),
    userCode: String(row.user_code ?? ""),
    avatarUrl: (row.avatar_url as string | null) ?? null,
    direction: row.direction as FriendDirection,
    createdAt: String(row.created_at),
  }));
}

/** By user code (U-00012, @U-00012) or email. Returns the new status. */
export async function sendFriendRequest(supabase: Supabase, identifier: string) {
  const { data, error } = await supabase.rpc("send_friend_request", {
    p_identifier: identifier,
  });
  if (error) throw new Error(cleanError(error, "Couldn't send the request."));
  const result = data as { status: "pending" | "accepted"; user: { name: string } };
  return { status: result.status, name: result.user?.name ?? "them" };
}

export async function respondFriendRequest(
  supabase: Supabase,
  friendshipId: string,
  accept: boolean,
) {
  const { error } = await supabase.rpc("respond_friend_request", {
    p_friendship_id: friendshipId,
    p_accept: accept,
  });
  if (error) throw new Error(cleanError(error, "Couldn't update the request."));
}

/** Cancel a sent request, or unfriend. */
export async function removeFriendship(supabase: Supabase, friendshipId: string) {
  const { error } = await supabase.rpc("remove_friendship", {
    p_friendship_id: friendshipId,
  });
  if (error) throw new Error(cleanError(error, "Couldn't remove this friend."));
}

export async function listMyGroupInvitations(supabase: Supabase): Promise<GroupInvitation[]> {
  const { data, error } = await supabase.rpc("list_my_group_invitations");
  if (error) throw new Error(cleanError(error, "Couldn't load your invitations."));
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    invitationId: String(row.invitation_id),
    groupId: String(row.group_id),
    groupName: String(row.group_name ?? "Group"),
    memberCount: Number(row.member_count) || 0,
    invitedById: String(row.invited_by_id),
    invitedByName: String(row.invited_by_name ?? "A friend"),
    createdAt: String(row.created_at),
  }));
}

export async function respondGroupInvitation(
  supabase: Supabase,
  invitationId: string,
  accept: boolean,
) {
  const { data, error } = await supabase.rpc("respond_group_invitation", {
    p_invitation_id: invitationId,
    p_accept: accept,
  });
  if (error) throw new Error(cleanError(error, "Couldn't update the invitation."));
  return data as { accepted: boolean; groupId: string; groupName?: string };
}

/** Pending invitations for a group (members can read them). userIds only. */
export async function pendingInviteeIds(supabase: Supabase, groupId: string) {
  const { data } = await supabase
    .from("Group_Invitation")
    .select("invitedUserId")
    .eq("groupId", groupId);
  return new Set(
    ((data ?? []) as Array<{ invitedUserId: string | null }>)
      .map((row) => row.invitedUserId)
      .filter((id): id is string => Boolean(id)),
  );
}

/**
 * Invite friends to a group through the invite-members edge function, which
 * runs the database rules as the signed-in user and emails each friend.
 */
export async function inviteFriends(
  supabase: Supabase,
  groupId: string,
  userIds: string[],
): Promise<InviteOutcome[]> {
  const { data, error } = await supabase.functions.invoke<{
    results?: InviteOutcome[];
    error?: string;
  }>("invite-members", { body: { groupId, userIds } });
  if (error || data?.error) {
    let message = data?.error || error?.message || "Couldn't send the invitations.";
    const context = (error as { context?: unknown } | null)?.context;
    if (context instanceof Response) {
      const body = await context.json().catch(() => null);
      if (body?.error) message = body.error;
    }
    throw new Error(message);
  }
  return data?.results ?? [];
}

/** The signed-in user's profile, for pages that don't load group data. */
export async function loadCurrentUser(supabase: Supabase) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("User")
    .select("name, userCode")
    .eq("userId", user.id)
    .maybeSingle();
  return {
    id: user.id,
    name:
      String(data?.name ?? "").trim() ||
      String(user.user_metadata?.full_name ?? "").trim() ||
      user.email?.split("@")[0] ||
      "there",
    email: user.email ?? "",
    handle: String(data?.userCode ?? "").trim(),
  };
}
