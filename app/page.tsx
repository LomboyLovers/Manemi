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

      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
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
              <label htmlFor="email">Email</label>

              <input suppressHydrationWarning
                id="email"
                type="email"
                name="email"
                placeholder="Enter your email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
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
