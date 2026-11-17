// Request plumbing shared by the Edge Functions.
import { createClient } from "npm:@supabase/supabase-js@2";

export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, PUT, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const validationError = (details: unknown) => json({ error: "Validation failed", details }, 400);

// SQL functions raise "INVALID: msg", "FORBIDDEN: msg", etc. Map them to HTTP codes.
const CODES: Record<string, number> = { FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID: 400 };
export function rpcError(err: { message: string }) {
  const m = err.message.match(/^(FORBIDDEN|NOT_FOUND|CONFLICT|INVALID):\s*([\s\S]*)$/);
  if (m) return json({ error: m[2] }, CODES[m[1]]);
  console.error(err);
  return json({ error: "Internal server error" }, 500);
}

export type Caller = { id: string; email?: string };

/** CORS, method check and the caller's token; fn gets the verified user. */
export function handle(method: "POST" | "PUT", fn: (caller: Caller, body: unknown) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== method) return json({ error: "Method not allowed" }, 405);
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return json({ error: "Unauthorized" }, 401);
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return json({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => null);
    try {
      return await fn(data.user, body);
    } catch (e) {
      console.error(e);
      return json({ error: "Internal server error" }, 500);
    }
  });
}

/** Sets the expense currency; ignored if the column doesn't exist yet. */
export async function saveCurrency(expenseId: string, currency: string | undefined) {
  if (!currency) return;
  const { error } = await admin.from("Expense").update({ currency }).eq("expenseId", expenseId);
  if (error) console.error("currency not saved:", error.message);
}
