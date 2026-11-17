// Email notifications (NOTIF-01..04). Sent from the app's Gmail account, the
// same way invite-members does. Never blocks or fails the request that
// triggered it: errors are logged and swallowed.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

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
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export async function sendMail(opts: { to: string; subject: string; html: string }) {
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
    headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64url(raw) }),
  });
  if (!res.ok) throw new Error(`Gmail send failed (${res.status}): ${await res.text()}`);
}

export type Pref = "notifyExpense" | "notifySettlement" | "notifyGroupJoin";
type Recipient = { userId: string; email: string; name: string };

/** Users who want this kind of email (missing preference = yes). */
async function recipients(admin: SupabaseClient, userIds: string[], pref: Pref): Promise<Recipient[]> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return [];
  const withPref = await admin.from("User").select(`userId, email, name, ${pref}`).in("userId", ids);
  const rows = withPref.error
    ? (await admin.from("User").select("userId, email, name").in("userId", ids)).data ?? []
    : (withPref.data ?? []).filter((row: Record<string, unknown>) => row[pref] !== false);
  return rows
    .filter((row: Record<string, unknown>) => row.email)
    .map((row: Record<string, unknown>) => ({
      userId: String(row.userId),
      email: String(row.email),
      name: String(row.name ?? ""),
    }));
}

export const money = (amount: number, currency = "PHP") =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amount);

export const layout = (title: string, body: string) => {
  const appUrl = Deno.env.get("APP_URL");
  return `
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:16px;color:#1c1c21">
    <h2 style="margin:0 0 12px">${title}</h2>
    ${body}
    ${appUrl ? `<p><a href="${esc(appUrl)}" style="color:#7a2ff0">Open Manemi</a></p>` : ""}
    <p style="color:#8a8a95;font-size:12px">You can turn these emails off in Manemi: profile → Email notifications.</p>
  </div>`;
};

/** Emails each opted-in user; runs after the response when the runtime allows. */
export function notify(
  admin: SupabaseClient,
  userIds: string[],
  pref: Pref,
  build: (r: Recipient) => { subject: string; html: string },
) {
  const job = (async () => {
    try {
      const list = await recipients(admin, userIds, pref);
      const results = await Promise.allSettled(list.map((r) => sendMail({ to: r.email, ...build(r) })));
      results.forEach((o) => o.status === "rejected" && console.error("notification email failed:", o.reason));
    } catch (e) {
      console.error("notification failed:", e);
    }
  })();
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(job);
  return job;
}
