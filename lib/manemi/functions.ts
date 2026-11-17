// Calls a Supabase Edge Function and turns its error body into a readable
// message (the functions answer { error, details }).
import { createClient } from "@/lib/supabase/client";

export async function callFunction<T = Record<string, unknown>>(
  name: string,
  body: unknown,
  method: "POST" | "PUT" = "POST",
): Promise<T> {
  const { data, error } = await createClient().functions.invoke(name, { body: body as never, method });
  if (error) {
    let message = error.message || "Something went wrong. Try again.";
    const response = (error as { context?: Response }).context;
    if (response) {
      try {
        const payload = await response.clone().json();
        if (payload?.error === "Validation failed" && payload.details) {
          const first = Object.values(payload.details as Record<string, string[]>).flat()[0];
          message = first || payload.error;
        } else if (payload?.error) {
          message = String(payload.error);
        }
      } catch {
        // keep the generic message
      }
    }
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: unknown }).error) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as T;
}

/** Storage path of a receipt from its saved URL (".../receipts/<group>/<file>"). */
export function receiptPath(url: string | null | undefined) {
  if (!url) return null;
  const match = url.match(/\/receipts\/(.+)$/);
  return match ? decodeURIComponent(match[1].split("?")[0]) : null;
}

/** Short-lived link to a private receipt (only group members can get one). */
export async function receiptLink(url: string | null | undefined) {
  const path = receiptPath(url);
  if (!path) return null;
  const { data, error } = await createClient().storage.from("receipts").createSignedUrl(path, 600);
  if (error) throw new Error("Couldn't open the receipt. You may no longer have access.");
  return data.signedUrl;
}
