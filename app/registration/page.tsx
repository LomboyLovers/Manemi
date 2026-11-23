"use client";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useModalFocus } from "@/components/useModalFocus";
import "@/components/popups.css";

/** Shown after sign-up when the email still has to be confirmed. */
function CheckEmailDialog({ email, onLogin }: { email: string; onLogin: () => void }) {
  const ref = useModalFocus<HTMLElement>(onLogin);
  return createPortal(
    <div className="mn-popup-backdrop mn-popup-sheet-backdrop mn-popup-center" onClick={onLogin}>
      <section
        ref={ref}
        className="mn-popup-sheet mn-confirm mn-check-email"
        role="dialog"
        aria-modal="true"
        aria-labelledby="check-email-title"
        aria-describedby="check-email-body"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mn-popup-handle" aria-hidden="true" />
        <svg className="mn-check-email-icon" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="m4 8 8 6 8-6" />
        </svg>
        <h2 id="check-email-title">Check your email</h2>
        <p id="check-email-body">
          We sent a confirmation link to <strong>{email}</strong>. Open it to activate your account, then log in. If you
          don&apos;t see it, check your spam folder.
        </p>
        <div className="mn-confirm-actions">
          <button type="button" className="mn-confirm-primary" onClick={onLogin} data-autofocus>
            Back to Login
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default function Register() {
  const router = useRouter();
  const supabase = createClient();

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleRegister(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(event.currentTarget);

    const fullName = String(formData.get("fullname") || "");
    const username = String(formData.get("username") || "");
    const email = String(formData.get("email") || "");
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          username: username,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    setLoading(false);

    if (data.session) {
      router.push("/dashboard");
      router.refresh();
    } else if (data.user && data.user.identities?.length === 0) {
      // Supabase hides whether an email is taken: it "succeeds" with no identity.
      setError("An account with this email already exists. Try logging in instead.");
    } else {
      setSentTo(email);
    }
  }

  return (
    <main className="register-page bg-pan-left">
      <section className="register-container">
        {/* LOGO */}
        <div className="brand">
          <Image
            src="/Logo_manemi.svg"
            alt="Manemi Logo"
            width={90}
            height={90}
            priority
          />

          <p>Welcome to Manemi</p>
        </div>

        {/* REGISTRATION CARD */}
        <div className="register-card">
          <h1>Register</h1>

          <form onSubmit={handleRegister}>
            {/* FULL NAME */}
            <div className="form-group">
              <label htmlFor="fullname">Full Name</label>

              <input
                id="fullname"
                type="text"
                name="fullname"
                placeholder="Enter your full name"
              />
            </div>

            {/* USERNAME */}
            <div className="form-group">
              <label htmlFor="username">Username</label>

              <input
                id="username"
                type="text"
                name="username"
                placeholder="Create a username"
              />
            </div>

            {/* EMAIL */}
            <div className="form-group">
              <label htmlFor="email">Email</label>

              <input
                id="email"
                type="email"
                name="email"
                placeholder="Enter your email"
              />
            </div>

            {/* PASSWORD */}
            <div className="form-group">
              <label htmlFor="password">Password</label>

              <input
                id="password"
                type="password"
                name="password"
                placeholder="Create a password"
              />
            </div>

            {/* CONFIRM PASSWORD */}
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>

              <input
                id="confirmPassword"
                type="password"
                name="confirmPassword"
                placeholder="Confirm your password"
              />
            </div>

            {/* TEMPORARY REGISTER BUTTON */}
            <button
              type="submit"
              className="create-account-button"
              disabled={loading}
            >
              {loading ? "Creating Account..." : "Create Account"}
            </button>
            {error && <p role="status">{error}</p>}
          </form>

          {/* BACK TO LOGIN */}
          <div className="login-link">
            <span>Already have an account?</span>

            <Link href="/">Login</Link>
          </div>
        </div>
      </section>
      {sentTo && <CheckEmailDialog email={sentTo} onLogin={() => router.push("/")} />}
    </main>
  );
}
