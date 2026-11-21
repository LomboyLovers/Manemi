// "Edited by Maria" labels: the audit log (Group_Activity) already records who
// changed each expense, so the latest `expense_updated` row per expense is the
// last editor. Everyone in the group sees it, including the person who added it.

export type EditRow = { entityId: string; actorId: string | null; createdAt: string; action: string };
export type LastEdit = { actorId: string | null; at: string };

/** Newest `expense_updated` row per expense id. */
export function latestEdits(rows: EditRow[]): Map<string, LastEdit> {
  const result = new Map<string, LastEdit>();
  for (const row of rows) {
    if (row.action !== "expense_updated") continue;
    const id = String(row.entityId);
    const current = result.get(id);
    if (!current || new Date(row.createdAt).getTime() > new Date(current.at).getTime()) {
      result.set(id, { actorId: row.actorId, at: String(row.createdAt) });
    }
  }
  return result;
}

/** "Edited by you", "Edited by Maria", or "Edited" when the editor left or is unknown. */
export function editedLabel(edit: LastEdit | undefined, me: string | null, nameOf: (id: string) => string | null): string {
  if (!edit) return "";
  if (edit.actorId && edit.actorId === me) return "Edited by you";
  const name = edit.actorId ? nameOf(edit.actorId) : null;
  return name ? `Edited by ${name}` : "Edited";
}
