import { z } from "npm:zod@3.23.8";
import { admin, handle, json, validationError } from "../_shared/http.ts";
import { esc, layout, money, notify } from "../_shared/notify.ts";

// Records who did what in the group timeline (never blocks the action itself)
async function logActivity(groupId: string, actorId: string, entityId: string, details: Record<string, unknown>) {
  const { error } = await admin.rpc("log_group_activity", {
    p_group_id: groupId,
    p_actor: actorId,
    p_action: "settlement_recorded",
    p_entity_type: "settlement",
    p_entity_id: entityId,
    p_details: details,
  });
  if (error) console.error("activity log failed:", error);
}

const isMoney = (n: number) => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

const schema = z.object({
  groupId: z.string().uuid("groupId must be a valid id"),
  receiverId: z.string().uuid("receiverId must be a valid user id"),
  amount: z.number({ invalid_type_error: "Amount must be a number" })
    .positive("Amount must be greater than zero")
    .max(99999999.99, "Amount is too large")
    .refine(isMoney, "Amount can have at most 2 decimal places"),
  paymentMethod: z.string().trim().min(1).optional(), // checked against the database enum, defaults to cash
  date: z.string().datetime({ offset: true }).optional(),
});

const METHOD: Record<string, string> = { cash: "Cash", gcash: "GCash", bank_transfer: "Bank transfer" };

handle("POST", async (caller, body) => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
  const b = parsed.data;

  if (b.receiverId === caller.id) return validationError({ receiverId: ["You cannot pay yourself"] });
  if (b.date && new Date(b.date).getTime() > Date.now() + 5 * 60_000) {
    return validationError({ date: ["Date cannot be in the future"] });
  }

  // Both payer and receiver must belong to the group; the payer is always the caller.
  const { data: members, error: memberErr } = await admin
    .from("Group_Member").select("userId").eq("groupId", b.groupId).in("userId", [caller.id, b.receiverId]);
  if (memberErr) throw memberErr;
  if (!members || members.length !== 2) {
    return json({ error: "Both you and the recipient must be members of this group" }, 403);
  }

  const { data, error } = await admin
    .from("Settlement")
    .insert({
      groupId: b.groupId,
      payerId: caller.id,
      receiverId: b.receiverId,
      amount: b.amount,
      status: "completed",
      paymentMethod: b.paymentMethod,
      settledAt: b.date ?? new Date().toISOString(),
    })
    .select()
    .single();
  if (error) {
    if (error.code === "22P02") return validationError({ paymentMethod: ["Invalid payment method"] });
    throw error;
  }
  await logActivity(b.groupId, caller.id, data.settlementId, {
    amount: data.amount,
    payerId: data.payerId,
    receiverId: data.receiverId,
    paymentMethod: data.paymentMethod,
  });

  // SET-03: recalculate the balances right after the payment is saved
  const { data: balances, error: balErr } = await admin.rpc("get_group_balances", {
    p_caller: caller.id,
    p_group_id: b.groupId,
  });
  if (balErr) console.error("balance recalculation failed:", balErr);

  // NOTIF-02: tell the person who was paid.
  const [{ data: group }, { data: payer }] = await Promise.all([
    admin.from("Group").select("name").eq("groupId", b.groupId).maybeSingle(),
    admin.from("User").select("name").eq("userId", caller.id).maybeSingle(),
  ]);
  notify(admin, [b.receiverId], "notifySettlement", () => ({
    subject: `${payer?.name ?? "Someone"} recorded a payment to you`,
    html: layout(
      `${esc(payer?.name ?? "Someone")} paid you ${money(Number(data.amount))}`,
      `<p>Group: <b>${esc(group?.name ?? "")}</b><br>Method: ${esc(METHOD[String(data.paymentMethod)] ?? "Cash")}</p>
       <p>If this doesn't look right, open the group and check the payment.</p>`,
    ),
  }));

  return json({ ...data, balances: balErr ? null : balances }, 201);
});
