"use client";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function Register() {
  const router = useRouter();
  const supabase = createClient();

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    } else {
      setError(
        "Account created. Please check your email to confirm your account before logging in.",
      );
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
    </main>
  );
}
