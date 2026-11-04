import Link from "next/link";

export default function Dashboard() {
  return (
    <main className="dashboard-page">
      <h1>Dashboard</h1>

      <p>Welcome to Manemi!</p>

      <Link href="/" className="logout-button">
        Logout
      </Link>
    </main>
  );
}
