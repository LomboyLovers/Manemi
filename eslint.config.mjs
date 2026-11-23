import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Edge Functions run on Deno (npm: imports, Deno global), not in the Next.js app.
    "supabase/functions/**",
  ]),
  {
    rules: {
      // This newer React rule flags the standard "load data when the page opens" pattern
      // (setLoading(true) at the top of an effect). It is a performance hint, not a bug, so it
      // stays visible as a warning instead of failing the lint run.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
