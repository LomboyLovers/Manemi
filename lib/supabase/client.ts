import { createBrowserClient } from "@supabase/ssr";
import { withClockSkewRetry } from "@/lib/manemi/skewFetch";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: withClockSkewRetry((input, init) => fetch(input, init)) } },
  );
}
