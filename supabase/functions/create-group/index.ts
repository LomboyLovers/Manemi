import { z } from "npm:zod@3.23.8";
import { admin, handle, json, rpcError, validationError } from "../_shared/http.ts";

// Must match the check constraint on "Group".category.
const CATEGORIES = ["Travel", "Roommates", "Group Dinners", "Events", "Other"] as const;

const schema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(50),
  category: z.enum(CATEGORIES).optional(),
});

// Creates the group (with its category) and adds the caller as owner in one transaction.
handle("POST", async (caller, body) => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  const { data, error } = await admin.rpc("create_group_with_admin", {
    p_caller: caller.id,
    p_name: parsed.data.name,
    p_category: parsed.data.category ?? "Other",
  });
  if (error) return rpcError(error);
  return json(data, 201);
});
