import { z } from "npm:zod@3.23.8";
import { admin, handle, json, rpcError, validationError } from "../_shared/http.ts";
import { esc, layout, money, notify } from "../_shared/notify.ts";

const schema = z.object({
  groupId: z.string().uuid("groupId must be a valid id"),
  toUserId: z.string().uuid("toUserId must be a valid id"),
  amount: z.number().positive("Amount must be more than zero"),
});

// "Remind" in Request Payment: checks they owe you, saves the reminder (it
// shows in their bell, live) and emails them if payment emails are on.
handle("POST", async (caller, body) => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
  const b = parsed.data;

  const { data, error } = await admin.rpc("send_payment_reminder", {
    p_caller: caller.id,
    p_group_id: b.groupId,
    p_to: b.toUserId,
    p_amount: b.amount,
  });
  if (error) return rpcError(error);

  const from = String(data.fromName ?? "Someone");
  const group = String(data.groupName ?? "your group");
  const amount = money(Number(data.amount));
  notify(admin, [b.toUserId], "notifySettlement", () => ({
    subject: `Payment reminder from ${from}: ${amount}`,
    html: layout(
      `${esc(from)} sent you a payment reminder`,
      `<p>You owe <b>${esc(from)}</b> <b>${amount}</b> in <b>${esc(group)}</b>.</p>
       <p>Open the group in Manemi and tap <b>Settle up</b> to record your payment.</p>`,
    ),
  }));

  return json({ reminderId: data.reminderId, amount: Number(data.amount), toName: data.toName }, 201);
});
