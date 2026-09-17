import Link from "next/link";
import Image from "next/image";

export default function Register() {
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

          <form>
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
            <Link href="/dashboard" className="create-account-button">
              Create Account
            </Link>
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
