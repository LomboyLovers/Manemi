"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// AUTH-04: set a new password after opening the emailed link (the link signs
// you in for this one purpose via /auth/callback).
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<"checking" | "ok" | "no-session">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setReady(data.user ? "ok" : "no-session"));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) {
      setError(
        /same|different/i.test(updateError.message)
          ? "Choose a password you haven't used before."
          : "Couldn't save your new password. Request a new link and try again.",
      );
      setSaving(false);
      return;
    }
    router.replace("/dashboard");
  }

  return (
    <main className="login-page bg-pan-left">
      <section className="login-container">
        <div className="brand">
          <Image src="/Logo_manemi.svg" alt="Manemi Logo" width={105} height={105} priority />
          <p>Choose a new password</p>
        </div>
        <div className="login-card">
          <h1>New password</h1>
          {ready === "checking" ? (
            <p aria-busy="true">Checking your link…</p>
          ) : ready === "no-session" ? (
            <div className="mn-auth-done">
              <p className="login-error" role="alert">
                This reset link has expired or was already used.
              </p>
              <Link href="/forgot-password" className="login-button">
                Request a New Link
              </Link>
            </div>
          ) : (
            <form suppressHydrationWarning onSubmit={submit} noValidate>
              <div className="form-group">
                <label htmlFor="new-password">New password</label>
                <input suppressHydrationWarning
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError("");
                  }}
                />
              </div>
              <div className="form-group">
                <label htmlFor="confirm-password">Confirm new password</label>
                <input suppressHydrationWarning
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => {
                    setConfirm(event.target.value);
                    setError("");
                  }}
                />
              </div>
              {error && (
                <p role="alert" className="login-error">
                  {error}
                </p>
              )}
              <button type="submit" className="login-button" disabled={saving}>
                {saving ? "Saving…" : "Save New Password"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
