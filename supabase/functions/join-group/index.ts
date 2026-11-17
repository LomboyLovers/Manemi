// Retired: groups can no longer be joined with an invite link or code.
// Members are added only by an owner/admin inviting a friend
// (invite-members -> invite_friends_to_group), then accepting it in the app.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(
    JSON.stringify({
      error: "Invite links are no longer supported. Ask a friend who owns or manages the group to invite you.",
    }),
    { status: 410, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
