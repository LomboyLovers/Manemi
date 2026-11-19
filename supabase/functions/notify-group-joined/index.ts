// NOTIF-03: the app calls this after you accept a group invitation; it emails
// you a confirmation (if you haven't turned those emails off).
import { z } from "npm:zod@3.23.8";
import { admin, handle, json, validationError } from "../_shared/http.ts";
import { esc, layout, notify } from "../_shared/notify.ts";

const schema = z.object({ groupId: z.string().uuid("groupId must be a valid id") });

handle("POST", async (caller, body) => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  const { data: member } = await admin
    .from("Group_Member").select("role").eq("groupId", parsed.data.groupId).eq("userId", caller.id).maybeSingle();
  if (!member) return json({ error: "You are not a member of this group" }, 403);

  const { data: group } = await admin.from("Group").select("name").eq("groupId", parsed.data.groupId).maybeSingle();
  await notify(admin, [caller.id], "notifyGroupJoin", () => ({
    subject: `You joined ${group?.name ?? "a group"} on Manemi`,
    html: layout(
      `Welcome to "${esc(group?.name ?? "your group")}"`,
      "<p>You're now a member. Expenses you're part of will show up in the group and in your History.</p>",
    ),
  }));
  return json({ sent: true });
});
