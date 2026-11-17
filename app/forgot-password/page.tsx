"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

// AUTH-04: request a password reset link by email.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [expired] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("expired"),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) {
      setError("Enter the email you signed up with, like name@example.com.");
      return;
    }
    setSending(true);
    setError("");
    const { error: resetError } = await createClient().auth.resetPasswordForEmail(value, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setSending(false);
    // Same answer whether or not the account exists (no account probing).
    if (resetError && !/rate|limit/i.test(resetError.message)) {
      setError("Couldn't send the email right now. Try again in a minute.");
      return;
    }
    if (resetError) {
      setError("Too many requests. Wait a minute, then try again.");
      return;
    }
    setSent(true);
  }

  return (
    <main className="login-page bg-pan-left">
      <section className="login-container">
        <div className="brand">
          <Image src="/Logo_manemi.svg" alt="Manemi Logo" width={105} height={105} priority />
          <p>Reset your password</p>
        </div>

        <div className="login-card">
          <h1>Forgot password</h1>
          {sent ? (
            <div className="mn-auth-done" role="status">
              <p>
                If an account uses <b>{email.trim()}</b>, we&apos;ve sent it a link to set a new password. The
                link works once and expires in an hour.
              </p>
              <Link href="/" className="login-button">
                Back to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              {expired && (
                <p className="login-error" role="alert">
                  That reset link has expired or was already used. Request a new one below.
                </p>
              )}
              <div className="form-group">
                <label htmlFor="reset-email">Email</label>
                <input
                  id="reset-email"
                  type="email"
                  placeholder="Enter your email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setError("");
                  }}
                />
              </div>
              {error && (
                <p role="alert" className="login-error">
                  {error}
                </p>
              )}
              <button type="submit" className="login-button" disabled={sending}>
                {sending ? "Sending…" : "Send Reset Link"}
              </button>
              <Link href="/" className="register-button">
                Back to Login
              </Link>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
