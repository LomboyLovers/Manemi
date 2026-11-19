import { z } from "npm:zod@3.23.8";
import { admin, handle, json, rpcError, saveCurrency, validationError } from "../_shared/http.ts";
import { baseSchema, buildSplits } from "../_shared/expense.ts";

const schema = baseSchema.extend({ expenseId: z.string().uuid("expenseId must be a valid id") });

// PUT replaces the whole expense: send the full body, not just changed fields
handle("PUT", async (caller, body) => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);
  const b = parsed.data;

  const built = buildSplits(b);
  if ("error" in built) return validationError({ participants: [built.error] });

  // Only the payer or a group admin/owner may edit; splits are replaced in one transaction
  const { data, error } = await admin.rpc("update_expense_with_splits", {
    p_caller: caller.id,
    p_expense_id: b.expenseId,
    p_paid_by: b.paidBy ?? null,
    p_title: b.title,
    p_total: b.totalAmount,
    p_date: b.expenseDate ?? null,
    p_category: b.category ?? null,
    p_receipt_url: b.receiptUrl ?? null,
    p_splits: built.splits,
  });
  if (error) return rpcError(error);
  await saveCurrency(b.expenseId, b.currency);

  const { data: balances, error: balErr } = await admin.rpc("get_group_balances", {
    p_caller: caller.id,
    p_group_id: data.expense.groupId,
  });
  if (balErr) console.error("balance recalculation failed:", balErr);

  return json({ message: "Expense updated successfully", ...data, balances: balErr ? null : balances }, 200);
});
