"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import HomeSkeleton from "@/components/HomeSkeleton";
import PageHeader from "@/components/PageHeader";
import AppNav from "@/components/AppNav";
import {
  loadGroupsData,
  totalsFor,
  type CurrentUser,
  type GroupSummary,
} from "@/lib/manemi/groups";
import { greeting, isZero, peso } from "@/lib/manemi/format";

export default function Dashboard() {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    loadGroupsData(createClient())
      .then((result) => {
        if (!active || !result) return;
        setUser(result.user);
        // Most recently active groups first.
        setGroups(
          [...result.groups].sort((a, b) =>
            (b.lastActivityAt ?? b.createdAt).localeCompare(
              a.lastActivityAt ?? a.createdAt,
            ),
          ),
        );
        if (result.warnings.length)
          setLoadError(`Some details could not be loaded: ${result.warnings.join("; ")}`);
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : "Unable to load your groups.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const recent = groups.filter((group) => !group.isArchived);
    return query
      ? recent.filter((group) => group.name.toLowerCase().includes(query))
      : recent;
  }, [groups, search]);
  const totals = useMemo(() => totalsFor(groups), [groups]);

  return (
    <main className="manemi-dashboard manemi-dashboard-v2 mn-app-page">
      <div className="dashboard-container">
      <div className="dashboard-content">
        {loading ? (
          <HomeSkeleton />
        ) : (
        <>
        <PageHeader user={user} />

        <section className="dashboard-greeting" id="home">
          <h1>
            {greeting()},
            <br />
            {user?.name.split(" ")[0] || "there"}
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

        {loadError && (
          <p className="dashboard-empty" role="alert">
            {loadError}
          </p>
        )}


        {!loading && groups.length === 0 && !loadError && (
          <section className="dashboard-section">
            <p className="dashboard-empty">
              You&apos;re not in any groups yet.{" "}
              <Link href="/groups">Create or join a group</Link> to start
              splitting expenses.
            </p>
          </section>
        )}

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
                    {peso(totals.owedToYou)}
                  </strong>
                </div>
                <div className="dashboard-balance-tile">
                  <p>
                    <span className="balance-negative">↗</span> You owe
                  </p>
                  <strong className="balance-negative">
                    {peso(totals.youOwe)}
                  </strong>
                </div>
              </div>
              <div className="dashboard-balance-footer">
                <span>
                  Spent this month <b>{peso(totals.spentThisMonth)}</b>
                </span>
                <span>
                  This week <b>{peso(totals.spentThisWeek)}</b>
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
                    const net = group.net;
                    const tone = isZero(net)
                      ? "dashboard-group-status"
                      : net > 0
                        ? "dashboard-group-status balance-positive"
                        : "dashboard-group-status balance-negative";
                    return (
                      <Link
                        className="group-card"
                        key={group.id}
                        href={`/groups/${group.id}`}
                        aria-label={`Open ${group.name}`}
                      >
                        <div className="dashboard-group-card-top">
                          <span
                            className="dashboard-group-emoji"
                            aria-hidden="true"
                          >
                            📦
                          </span>
                        </div>
                        <h3>{group.name}</h3>
                        <p className="group-members">
                          {group.members}{" "}
                          {group.members === 1 ? "member" : "members"}
                          {group.isCreator ? " · Admin" : ""}
                        </p>
                        <p className={tone}>
                          {isZero(net)
                            ? "✓ Settled up"
                            : net > 0
                              ? "↙ You're owed"
                              : "↗ You owe"}
                        </p>
                        <strong
                          className={
                            isZero(net)
                              ? undefined
                              : net > 0
                                ? "balance-positive"
                                : "balance-negative"
                          }
                        >
                          {peso(Math.abs(net))}
                        </strong>
                        <p className="dashboard-group-spent">
                          of {peso(group.spent)} spent
                        </p>
                      </Link>
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
        </>
        )}
      </div>
      </div>

      <AppNav active="home" groups={loading ? undefined : groups} />
    </main>
  );
}
