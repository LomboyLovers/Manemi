import { z } from "npm:zod@3.23.8";
import { admin, handle, json, rpcError, saveCurrency, validationError } from "../_shared/http.ts";
import { baseSchema, buildSplits } from "../_shared/expense.ts";
import { esc, layout, money, notify } from "../_shared/notify.ts";

const schema = baseSchema.extend({ groupId: z.string().uuid("groupId must be a valid id") });

handle("POST", async (caller, body) => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
  const b = parsed.data;

  const built = buildSplits(b);
  if ("error" in built) return validationError({ participants: [built.error] });

  const { data, error } = await admin.rpc("create_expense_with_splits", {
    p_caller: caller.id,
    p_group_id: b.groupId,
    p_paid_by: b.paidBy ?? caller.id,
    p_title: b.title,
    p_total: b.totalAmount,
    p_date: b.expenseDate ?? new Date().toISOString(),
    p_category: b.category ?? null,
    p_receipt_url: b.receiptUrl ?? null,
    p_splits: built.splits,
  });
  if (error) return rpcError(error);

  const expenseId: string = data.expense.expenseId;
  await saveCurrency(expenseId, b.currency);

  // BAL-03: the new balances come back with the new expense
  const { data: balances, error: balErr } = await admin.rpc("get_group_balances", {
    p_caller: caller.id,
    p_group_id: b.groupId,
  });
  if (balErr) console.error("balance recalculation failed:", balErr);

  // NOTIF-01: everyone in the split (and the payer) except whoever entered it.
  const [{ data: group }, { data: actor }] = await Promise.all([
    admin.from("Group").select("name").eq("groupId", b.groupId).maybeSingle(),
    admin.from("User").select("name").eq("userId", caller.id).maybeSingle(),
  ]);
  const currency = b.currency ?? "PHP";
  const shareOf = new Map(built.splits.map((s) => [s.userId, s.amount]));
  const involved = [...shareOf.keys(), b.paidBy ?? caller.id].filter((id) => id !== caller.id);
  notify(admin, involved, "notifyExpense", (r) => {
    const share = shareOf.get(r.userId);
    return {
      subject: `New expense in ${group?.name ?? "your group"}: ${b.title}`,
      html: layout(
        `${esc(actor?.name ?? "Someone")} added "${esc(b.title)}"`,
        `<p>Group: <b>${esc(group?.name ?? "")}</b><br>Total: <b>${money(b.totalAmount, currency)}</b>${
          share !== undefined && r.userId !== (b.paidBy ?? caller.id)
            ? `<br>Your share: <b>${money(share, currency)}</b>`
            : ""
        }</p>`,
      ),
    };
  });

  return json({ message: "Expense created successfully", ...data, balances: balErr ? null : balances }, 201);
});
