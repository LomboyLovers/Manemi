"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import HomeSkeleton from "@/components/HomeSkeleton";
import PageHeader from "@/components/PageHeader";
import AppNav from "@/components/AppNav";
import Icon from "@/components/Icon";
import { useDataVersion } from "@/lib/manemi/events";
import {
  loadGroupsDataCached,
  totalsFor,
  type CurrentUser,
  type GroupSummary,
} from "@/lib/manemi/groups";
import { greeting, isZero, peso } from "@/lib/manemi/format";
import CategoryIcon from "@/components/CategoryIcon";
import { searchGroupIds, searchHistory } from "@/lib/manemi/search";
import { useDebounced } from "@/lib/manemi/useDebounced";
import type { HistoryExpense } from "@/lib/manemi/groups";

/** Home shows this many recent groups; "See all" opens the Groups page. */
const RECENT_LIMIT = 6;

export default function Dashboard() {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const query = useDebounced(search.trim(), 300);
  const [matchIds, setMatchIds] = useState<Set<string> | null>(null);
  const [matchExpenses, setMatchExpenses] = useState<HistoryExpense[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const dataVersion = useDataVersion();

  // Search runs in the database, 300ms after typing stops.
  useEffect(() => {
    if (!query || !user) {
      setMatchIds(null);
      setMatchExpenses([]);
      setSearchError("");
      return;
    }
    let active = true;
    setSearching(true);
    const supabase = createClient();
    Promise.all([
      searchGroupIds(supabase, query),
      searchHistory(
        supabase,
        user.id,
        { kind: "expenses", groupId: "all", query, onlyMine: false, sort: "newest" },
        1,
        5,
      ),
    ])
      .then(([ids, expenses]) => {
        if (!active) return;
        setMatchIds(ids);
        setMatchExpenses(expenses.items);
        setSearchError("");
      })
      .catch((reason: unknown) => {
        if (active) setSearchError(reason instanceof Error ? reason.message : "Search failed. Try again.");
      })
      .finally(() => {
        if (active) setSearching(false);
      });
    return () => {
      active = false;
    };
  }, [query, user, dataVersion]);

  useEffect(() => {
    let active = true;
    loadGroupsDataCached(createClient())
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
  }, [dataVersion]);

  const filteredGroups = useMemo(() => {
    const recent = groups.filter((group) => !group.isArchived);
    return matchIds ? recent.filter((group) => matchIds.has(group.id)) : recent.slice(0, RECENT_LIMIT);
  }, [groups, matchIds]);
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

        {searchError && (
          <p className="dashboard-empty" role="alert">
            {searchError}
          </p>
        )}

        {loadError && (
          <p className="dashboard-empty" role="alert">
            {loadError}
          </p>
        )}


        {!loading && groups.length === 0 && !loadError && (
          <section className="mn-home-empty" aria-labelledby="home-empty-title">
            <div className="mn-home-empty-icon" aria-hidden="true">
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A1.5 1.5 0 0 0 4 5.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 5.5" />
                <circle cx="16" cy="14" r="1" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <h2 id="home-empty-title">No groups yet</h2>
            <p>Create a group and invite your friends to start tracking shared expenses.</p>
            <div className="mn-home-empty-actions">
              <Link href="/groups?new=group" className="mn-home-empty-primary">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Create Group
              </Link>
              <Link href="/friends" className="mn-home-empty-secondary">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="9" cy="8" r="4" />
                  <path d="M2 21c0-4 3.5-6 7-6s7 2 7 6M19 8v6M16 11h6" />
                </svg>
                Add Friends
              </Link>
            </div>
            <small>Invited by a friend? Accept it from the bell at the top.</small>
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
                <h2>{matchIds ? "Matching groups" : "Recent groups"}</h2>
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
                            <Icon name="users" size={22} />
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

            {matchIds && (
              <section className="dashboard-section mn-home-matches" aria-labelledby="home-match-expenses" aria-busy={searching}>
                <div className="dashboard-section-header">
                  <h2 id="home-match-expenses">Matching expenses</h2>
                  <Link className="dashboard-see-all" href="/history">
                    Open History
                  </Link>
                </div>
                {matchExpenses.length ? (
                  <ul className="mn-home-match-list">
                    {matchExpenses.map((item) => (
                      <li key={item.id}>
                        <Link href={`/groups/${item.groupId}?expense=${encodeURIComponent(item.id)}`}>
                          <span className="mn-home-match-icon" aria-hidden="true">
                            <CategoryIcon name={item.category} size={20} />
                          </span>
                          <span className="mn-home-match-text">
                            <strong>{item.title}</strong>
                            <small>
                              {item.groupName} · Paid by {item.payerName === "You" ? "you" : item.payerName}
                            </small>
                          </span>
                          <strong className="mn-home-match-amount">{peso(item.amount)}</strong>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="dashboard-empty">No matching expenses.</p>
                )}
              </section>
            )}
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
