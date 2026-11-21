import test from "node:test";
import assert from "node:assert/strict";
import { editedLabel, latestEdits } from "./edits.ts";

const rows = [
  { entityId: "e1", actorId: "a", createdAt: "2026-11-01T10:00:00Z", action: "expense_updated" },
  { entityId: "e1", actorId: "b", createdAt: "2026-11-02T10:00:00Z", action: "expense_updated" },
  { entityId: "e1", actorId: "c", createdAt: "2026-11-03T10:00:00Z", action: "expense_created" },
  { entityId: "e2", actorId: null, createdAt: "2026-11-02T10:00:00Z", action: "expense_updated" },
];

test("latest edit wins and creations are ignored", () => {
  const map = latestEdits(rows);
  assert.equal(map.get("e1")?.actorId, "b");
  assert.equal(map.size, 2);
});

test("labels: you, a name, or unknown", () => {
  const map = latestEdits(rows);
  const names = (id: string) => ({ b: "Maria" })[id as "b"] ?? null;
  assert.equal(editedLabel(map.get("e1"), "me", names), "Edited by Maria");
  assert.equal(editedLabel(map.get("e1"), "b", names), "Edited by you");
  assert.equal(editedLabel(map.get("e2"), "me", names), "Edited");
  assert.equal(editedLabel(undefined, "me", names), "");
});
