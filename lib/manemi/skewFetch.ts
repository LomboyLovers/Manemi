/**
 * Supabase signs a fresh token with the auth server's clock, and PostgREST
 * rejects it with 401 / PGRST303 "JWT issued at future" if its own clock is a
 * moment behind. It happens on the first request right after logging in and
 * clears within a second or two, so retry instead of showing a load error.
 */
const FUTURE_JWT = /PGRST303|issued at future/i;
const DELAYS_MS = [600, 1200, 2000];

export function withClockSkewRetry(
  baseFetch: typeof fetch,
  delaysMs: number[] = DELAYS_MS,
): typeof fetch {
  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      const response = await baseFetch(input instanceof Request ? input.clone() : input, init);
      if (response.status !== 401 || attempt >= delaysMs.length) return response;
      const body = await response.clone().text().catch(() => "");
      if (!FUTURE_JWT.test(body)) return response;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  };
}
