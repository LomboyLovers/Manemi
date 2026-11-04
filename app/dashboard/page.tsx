"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type DashboardGroup = {
  id: string | number;
  name: string;
  icon?: string;
  category?: string;
  members?: number | string;
  owed?: number;
  owe?: number;
  spent?: number;
  isAdmin?: boolean;
};

const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    value,
  );

const numeric = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string")
    return Number(value.replace(/[^\d.-]/g, "")) || 0;
  return 0;
};

function readGroups(): DashboardGroup[] {
  // Temporary browser-based group source. Use the same storage key in /groups,
  // or replace this with your actual database/API once it is connected.
  try {
    const stored = window.localStorage.getItem("manemi-groups");
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is DashboardGroup =>
        !!item &&
        typeof item === "object" &&
        "id" in item &&
        "name" in item &&
        typeof item.name === "string",
    );
  } catch {
    return [];
  }
}

export default function Dashboard() {
  const [groups, setGroups] = useState<DashboardGroup[]>([]);
  const [search, setSearch] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    const refresh = () => setGroups(readGroups());
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const filteredGroups = groups.filter((group) =>
    group.name.toLowerCase().includes(search.toLowerCase()),
  );
  const totalOwed = groups.reduce((sum, group) => sum + numeric(group.owed), 0);
  const totalOwe = groups.reduce((sum, group) => sum + numeric(group.owe), 0);
  const totalSpent = groups.reduce(
    (sum, group) => sum + numeric(group.spent),
    0,
  );
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();

    const { error } = await supabase.auth.signOut();

    if (error) {
      alert(error.message);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main className="manemi-dashboard manemi-dashboard-v2">
      <div className="dashboard-content">
        <header className="dashboard-header">
          <div className="dashboard-avatar">J</div>
          <div className="notification-wrapper">
            <button
              type="button"
              className="notification-button"
              aria-label="Notifications"
              aria-expanded={showMenu}
              onClick={() => setShowMenu(!showMenu)}
            >
              <span aria-hidden="true">♧</span>
              <span className="notification-dot" />
            </button>
            {showMenu && (
              <div className="dashboard-dropdown">
                <p>No new notifications</p>
                <button
                  type="button"
                  className="dashboard-logout"
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </header>

        <section className="dashboard-greeting" id="home">
          <h1>
            Good evening,
            <br />
            Joaquin
          </h1>
          <p>Here&apos;s what&apos;s happening with your money.</p>
        </section>

        <label className="dashboard-search">
          <svg
            width="21"
            height="21"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m16 16 5 5" />
          </svg>
          <input
            type="search"
            placeholder="Search groups or expenses"
            aria-label="Search groups or expenses"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        {groups.length > 0 && (
          <>
            <section
              className="dashboard-balance-card"
              aria-label="Your balance across all groups"
            >
              <h2>YOUR BALANCE · ALL GROUPS</h2>
              <div className="dashboard-balance-grid">
                <div className="dashboard-balance-tile">
                  <p>
                    <span className="balance-positive">↙</span> Owed to you
                  </p>
                  <strong className="balance-positive">
                    {peso(totalOwed)}
                  </strong>
                </div>
                <div className="dashboard-balance-tile">
                  <p>
                    <span className="balance-negative">↗</span> You owe
                  </p>
                  <strong className="balance-negative">{peso(totalOwe)}</strong>
                </div>
              </div>
              <div className="dashboard-balance-footer">
                <span>
                  Spent this month <b>{peso(totalSpent)}</b>
                </span>
                <span>
                  This week <b>{peso(0)}</b>
                </span>
              </div>
            </section>

            <section
              className="dashboard-section dashboard-recent-groups"
              id="groups"
            >
              <div className="dashboard-section-header">
                <h2>Recent groups</h2>
                <Link className="dashboard-see-all" href="/groups">
                  See all
                </Link>
              </div>
              {filteredGroups.length > 0 ? (
                <div className="groups-scroll">
                  {filteredGroups.map((group) => {
                    const owed = numeric(group.owed);
                    const owe = numeric(group.owe);
                    const net = owed - owe;
                    return (
                      <article className="group-card" key={group.id}>
                        <div className="dashboard-group-card-top">
                          <span
                            className="dashboard-group-emoji"
                            aria-hidden="true"
                          >
                            {group.icon ||
                              (group.category === "Travel" ? "✈️" : "👥")}
                          </span>
                          <span
                            className="dashboard-group-more"
                            aria-hidden="true"
                          >
                            •••
                          </span>
                        </div>
                        <h3>{group.name}</h3>
                        <p className="group-members">
                          {group.members ?? 1} members
                          {group.isAdmin ? " · Admin" : ""}
                        </p>
                        <p
                          className={
                            net >= 0
                              ? "dashboard-group-status balance-positive"
                              : "dashboard-group-status balance-negative"
                          }
                        >
                          {net >= 0 ? "↙ You're owed" : "↗ You owe"}
                        </p>
                        <strong
                          className={
                            net >= 0 ? "balance-positive" : "balance-negative"
                          }
                        >
                          {peso(Math.abs(net))}
                        </strong>
                        <p className="dashboard-group-spent">
                          of {peso(numeric(group.spent))} spent
                        </p>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="dashboard-empty">No matching groups found.</p>
              )}
            </section>

            {/* Activity is intentionally hidden until real group activity is available. */}
          </>
        )}
      </div>

      <nav className="dashboard-bottom-nav" aria-label="Dashboard navigation">
        <div className="nav-pill">
          <Link
            href="/dashboard"
            className="nav-item active"
            aria-current="page"
          >
            <Image src="/icons/home.png" alt="" width={20} height={20} />
            <span>Home</span>
          </Link>
          <Link href="/groups" className="nav-item">
            <Image src="/icons/group.png" alt="" width={20} height={20} />
            <span>Groups</span>
          </Link>
          <Link href="/history" className="nav-item">
            <Image src="/icons/clock.png" alt="" width={20} height={20} />
            <span>History</span>
          </Link>
        </div>
        <button
          type="button"
          className="dashboard-add-button"
          aria-label="Add new expense"
          onClick={() => setShowAddModal(true)}
        >
          <Image src="/icons/plus.png" alt="" width={22} height={22} />
        </button>
      </nav>

      {showAddModal && (
        <div
          className="dashboard-modal-overlay"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="dashboard-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-add-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="dashboard-add-title">Add Expense</h2>
            <p>Your expense creation page will go here.</p>
            <button type="button" onClick={() => setShowAddModal(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
