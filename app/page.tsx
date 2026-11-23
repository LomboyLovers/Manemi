"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const supabase = createClient();

      // The box accepts an email or a username. A username is looked up to its
      // email first, because Supabase signs in with email only.
      const identifier = email.trim();
      let loginEmail = identifier;
      if (!identifier.includes("@")) {
        const { data: found } = await supabase.rpc("login_email_for", { identifier });
        // Unknown username: send a value that can never match, so the message
        // is the same "Invalid login credentials" as a wrong password.
        loginEmail = typeof found === "string" && found ? found : "unknown@invalid.local";
      }

      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });

      if (loginError) {
        setError(loginError.message);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Unable to log in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page bg-pan-left">
      <button type="button" className="help-button">
        ? Need help
      </button>

      <section className="login-container">
        <div className="brand">
          <Image
            src="/Logo_manemi.svg"
            alt="Manemi Logo"
            width={105}
            height={105}
            priority
          />

          <p>Welcome to Manemi</p>
        </div>

        <div className="login-card">
          <h1>Login</h1>

          <form suppressHydrationWarning onSubmit={handleLogin}>
            <div className="form-group">
              <label htmlFor="email">Email or username</label>

              <input suppressHydrationWarning
                id="email"
                type="text"
                name="email"
                placeholder="Enter your email or username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>

              <input suppressHydrationWarning
                id="password"
                type="password"
                name="password"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />

              <Link href="/forgot-password" className="forgot-password">
                Forgot password?
              </Link>
            </div>

            <button type="submit" className="login-button" disabled={loading}>
              {loading ? "Logging in..." : "Login"}
            </button>

            {error && (
              <p role="alert" className="login-error">
                {error}
              </p>
            )}

            <Link href="/registration" className="register-button">
              Register
            </Link>
          </form>
        </div>
      </section>
    </main>
  );
}
