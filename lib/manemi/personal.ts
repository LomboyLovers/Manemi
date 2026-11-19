// Personal expenses: your own costs, with no group and no splitting.
// They are "Expense" rows with groupId = null, paid by you; owner-only RLS
// means nobody else can see them, and group queries never include them.
import type { createClient } from "@/lib/supabase/client";
import type { ReportRow } from "./search";

type Supabase = ReturnType<typeof createClient>;

export type PersonalExpense = {
  id: string;
  title: string;
  amount: number;
  currency: string;
  /** Category key: food, transport, ... */
  category: string;
  /** ISO timestamp. */
  date: string;
  note: string | null;
  receiptUrl: string | null;
};

export type PersonalInput = {
  title: string;
  amount: number;
  currency: string;
  category: string;
  /** YYYY-MM-DD (saved at noon local time so it never slips a day). */
  day: string;
  note: string;
  receiptUrl: string | null;
};

const COLUMNS = `"expenseId", title, "totalAmount", currency, category, "expenseDate", note, "receiptUrl"`;
export const PERSONAL_PAGE_SIZE = 10;
export const PERSONAL_NOTE_MAX = 500;

function toExpense(row: Record<string, unknown>): PersonalExpense {
  return {
    id: String(row.expenseId),
    title: String(row.title ?? ""),
    amount: Number(row.totalAmount) || 0,
    currency: String(row.currency ?? "PHP"),
    category: String(row.category ?? "other"),
    date: String(row.expenseDate),
    note: (row.note as string | null) ?? null,
    receiptUrl: (row.receiptUrl as string | null) ?? null,
  };
}

/** A friendlier message when the table isn't there yet (migration not applied). */
function failure(action: string, message: string): Error {
  // Before the personal-expenses migration: no "note" column, and groupId can't be empty.
  if (/note|groupId.*null|null value in column|schema cache/i.test(message)) {
    return new Error("Personal expenses aren't set up on the server yet.");
  }
  return new Error(`Couldn't ${action}: ${message}`);
}

/** One page of your personal expenses, newest first, optionally searched by title. */
export async function listPersonal(
  supabase: Supabase,
  options: { page: number; search?: string },
): Promise<{ items: PersonalExpense[]; total: number }> {
  const from = (options.page - 1) * PERSONAL_PAGE_SIZE;
  let query = supabase
    .from("Expense")
    .select(COLUMNS, { count: "exact" })
    .is("groupId", null)
    .order("expenseDate", { ascending: false })
    .order("expenseId", { ascending: false })
    .range(from, from + PERSONAL_PAGE_SIZE - 1);
  const term = options.search?.trim();
  if (term) query = query.ilike("title", `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const { data, error, count } = await query;
  if (error) throw failure("load your personal expenses", error.message);
  return { items: ((data ?? []) as Array<Record<string, unknown>>).map(toExpense), total: count ?? 0 };
}

/** Your personal expenses in a date range (both ISO days, inclusive), for totals and charts. */
export async function personalInRange(supabase: Supabase, fromDay?: string, toDay?: string): Promise<PersonalExpense[]> {
  let query = supabase.from("Expense").select(COLUMNS).is("groupId", null).order("expenseDate", { ascending: false }).limit(2000);
  if (fromDay) query = query.gte("expenseDate", new Date(`${fromDay}T00:00:00`).toISOString());
  if (toDay) {
    const end = new Date(`${toDay}T00:00:00`);
    end.setDate(end.getDate() + 1);
    query = query.lt("expenseDate", end.toISOString());
  }
  const { data, error } = await query;
  if (error) throw failure("load your personal expenses", error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map(toExpense);
}

export async function getPersonal(supabase: Supabase, id: string): Promise<PersonalExpense | null> {
  const { data, error } = await supabase.from("Expense").select(COLUMNS).eq("expenseId", id).is("groupId", null).maybeSingle();
  if (error) throw failure("open that expense", error.message);
  return data ? toExpense(data as Record<string, unknown>) : null;
}

/** Creates (no id) or updates (id) one of your personal expenses; returns its id. */
export async function savePersonal(supabase: Supabase, userId: string, input: PersonalInput, id?: string): Promise<string> {
  const row = {
    groupId: null,
    paidBy_UserId: userId,
    title: input.title.trim(),
    totalAmount: input.amount,
    currency: input.currency,
    category: input.category,
    expenseDate: new Date(`${input.day}T12:00:00`).toISOString(),
    note: input.note.trim() || null,
    receiptUrl: input.receiptUrl,
  };
  const result = id
    ? await supabase.from("Expense").update(row).eq("expenseId", id).is("groupId", null).select("expenseId").single()
    : await supabase.from("Expense").insert(row).select("expenseId").single();
  if (result.error) throw failure("save the expense", result.error.message);
  return String((result.data as Record<string, unknown>).expenseId);
}

export async function deletePersonal(supabase: Supabase, expense: PersonalExpense): Promise<void> {
  const { error } = await supabase.from("Expense").delete().eq("expenseId", expense.id).is("groupId", null);
  if (error) throw failure("delete the expense", error.message);
  await removePersonalReceipt(supabase, expense.receiptUrl);
}

/** Uploads a receipt photo to receipts/personal/<you>/...; returns the URL to save. */
export async function uploadPersonalReceipt(supabase: Supabase, userId: string, file: File): Promise<string> {
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `personal/${userId}/${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from("receipts").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`Couldn't upload the receipt: ${error.message}`);
  return supabase.storage.from("receipts").getPublicUrl(path).data.publicUrl;
}

/** Deletes a personal receipt file (only ever one in your own personal folder). */
export async function removePersonalReceipt(supabase: Supabase, url: string | null | undefined): Promise<void> {
  const path = url?.match(/\/receipts\/(personal\/.+)$/)?.[1];
  if (path) await supabase.storage.from("receipts").remove([decodeURIComponent(path)]);
}

/** Personal expenses as report rows (all yours; "Personal" in place of a group). */
export function personalAsReportRows(items: PersonalExpense[]): ReportRow[] {
  return items.map((item) => ({
    id: item.id,
    groupId: "personal",
    groupName: "Personal",
    title: item.title,
    amount: item.amount,
    currency: item.currency,
    category: item.category,
    date: item.date,
    payerId: "me",
    payerName: "You",
    yourShare: item.amount,
  }));
}
