// invite-members: invite FRIENDS to a group (friends-only, owner/admin only).
//
// Body: { groupId: uuid, userIds: uuid[] }  (1–50 friend user ids)
// The rules live in the database function invite_friends_to_group, which runs
// as the signed-in caller, so they can't be skipped from here. This function
// then emails each newly invited friend.
//
// Response: { results: [{ userId, status: "invited" | "already_member" | "not_friend" }] }

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

// ===== Helpers =====
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const CODES: Record<string, number> = { FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID: 400 };
function rpcError(err: { message: string }) {
  const m = err.message.match(/^(FORBIDDEN|NOT_FOUND|CONFLICT|INVALID):\s*([\s\S]*)$/);
  if (m) return json({ error: m[2] }, CODES[m[1]]);
  console.error(err);
  return json({ error: "Internal server error" }, 500);
}

// ===== Gmail (HTTPS API, sends from the app's Gmail account) =====
let tokenCache: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GMAIL_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${await res.text()}`);
  const j = await res.json();
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return tokenCache.token;
}

const b64 = (s: string) => {
  let bin = "";
  new TextEncoder().encode(s).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
};
const b64url = (s: string) => b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const wrap76 = (s: string) => s.match(/.{1,76}/g)?.join("\r\n") ?? "";
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

async function sendMail(opts: { to: string; subject: string; html: string }) {
  const raw = [
    `From: Manemi <${Deno.env.get("GMAIL_SENDER")!}>`,
    `To: ${opts.to}`,
    `Subject: =?UTF-8?B?${b64(opts.subject)}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(opts.html)),
  ].join("\r\n");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: b64url(raw) }),
  });
  if (!res.ok) throw new Error(`Gmail send failed (${res.status}): ${await res.text()}`);
}

// ===== Validation =====
const schema = z.object({
  groupId: z.string().uuid("groupId must be a valid id"),
  userIds: z.array(z.string().uuid("Invalid friend id"))
    .min(1, "Choose at least one friend")
    .max(50, "You can invite up to 50 friends at a time"),
});

// ===== Handler =====
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return json({ error: "Unauthorized" }, 401);
  const { data: auth, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !auth.user) return json({ error: "Unauthorized" }, 401);

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, 400);
  }
  const { groupId } = parsed.data;
  const userIds = [...new Set(parsed.data.userIds)];

  try {
    // Run the rules AS the caller (auth.uid() = caller), not as the service role.
    const asCaller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: rows, error } = await asCaller.rpc("invite_friends_to_group", {
      p_group_id: groupId,
      p_user_ids: userIds,
    });
    if (error) return rpcError(error);

    const results = ((rows ?? []) as Array<{ invitee_id: string; outcome: string }>).map((row) => ({
      userId: row.invitee_id,
      status: row.outcome,
    }));
    const invitedIds = results.filter((r) => r.status === "invited").map((r) => r.userId);

    // Email newly invited friends. The invitations already exist, so a mail
    // failure doesn't undo anything; the friend still sees it in the app.
    let emailed = 0;
    if (invitedIds.length) {
      const [{ data: group }, { data: me }, { data: friends }] = await Promise.all([
        admin.from("Group").select("name").eq("groupId", groupId).maybeSingle(),
        admin.from("User").select("name").eq("userId", auth.user.id).maybeSingle(),
        admin.from("User").select("userId, email, name").in("userId", invitedIds),
      ]);
      const inviter = me?.name ?? "A friend";
      const groupName = group?.name ?? "a group";
      const appUrl = Deno.env.get("APP_URL");
      const link = appUrl ? `${appUrl}/groups` : null;

      const outcomes = await Promise.allSettled(
        (friends ?? []).map((friend) =>
          sendMail({
            to: String(friend.email),
            subject: `${inviter} invited you to ${groupName} on Manemi`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:16px">
                <h2>${esc(inviter)} invited you to "${esc(groupName)}"</h2>
                <p>Open Manemi and tap the bell to accept or decline.</p>
                ${link ? `<p><a href="${esc(link)}">Open Manemi</a></p>` : ""}
              </div>`,
          })
        ),
      );
      outcomes.forEach((o) => {
        if (o.status === "fulfilled") emailed += 1;
        else console.error("invite email failed:", o.reason);
      });
    }

    return json({ results, emailed });
  } catch (e) {
    console.error(e);
    return json({ error: "Internal server error" }, 500);
  }
});
