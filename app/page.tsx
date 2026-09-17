import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <main className="login-page bg-pan-left">
      <button className="help-button">? Need help</button>
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

          <form>
            <div className="form-group">
              <label htmlFor="username">Username</label>

              <input id="username" type="text" name="username" />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>

              <input id="password" type="password" name="password" />

              <button type="button" className="forgot-password">
                Forgot password?
              </button>
            </div>

            <Link href="/dashboard" className="login-button">
              Login
            </Link>
            <Link href="/registration" className="register-button">
              Register
            </Link>
          </form>
        </div>
      </section>
    </main>
  );
}
