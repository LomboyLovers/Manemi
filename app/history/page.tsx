"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import AppNav from "@/components/AppNav";
import AddExpensePicker from "@/components/AddExpensePicker";
import {
  loadGroupsData,
  type GroupSummary,
  type HistoryExpense,
} from "@/lib/manemi/groups";
import { CATEGORY_META, initialOf, peso } from "@/lib/manemi/format";
import "./history.css";

// Pattern 10 (Inbox / Activity Feed), variant A: a standalone, newest-first
// feed of expenses and payments across every group.

type Kind = "all" | "expenses" | "payments";
type Sort = "newest" | "oldest" | "largest";

const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const startOfWeek = (date: Date) => {
  const day = (date.getDay() + 6) % 7; // Monday
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - day).getTime();
};

function shortDate(date: Date, withYear: boolean) {
  return date
    .toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
    })
    .toUpperCase();
}

/** Today, Yesterday, then one section per week labelled by its date span. */
function groupByDate(items: HistoryExpense[], now = new Date()) {
  const today = startOfDay(now);
  const sections: Array<{ key: string; label: string; items: HistoryExpense[] }> = [];
  const byKey = new Map<string, HistoryExpense[]>();

  for (const item of items) {
    const date = new Date(item.date);
    const day = startOfDay(date);
    const key =
      day === today ? "today" : day === today - DAY ? "yesterday" : `week-${startOfWeek(date)}`;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      sections.push({ key, label: "", items: byKey.get(key)! });
    }
    byKey.get(key)!.push(item);
  }

  for (const section of sections) {
    if (section.key === "today") section.label = "TODAY";
    else if (section.key === "yesterday") section.label = "YESTERDAY";
    else {
      const times = section.items.map((item) => new Date(item.date).getTime());
      const first = new Date(Math.min(...times));
      const last = new Date(Math.max(...times));
      const withYear = first.getFullYear() !== now.getFullYear();
      section.label =
        startOfDay(first) === startOfDay(last)
          ? shortDate(first, withYear)
          : `${shortDate(first, withYear)} – ${shortDate(last, withYear)}`;
    }
  }
  return sections;
}

function involvement(item: HistoryExpense, myId: string) {
  if (item.payerId === myId) {
    const lent = item.amount - item.yourShare;
    return lent > 0.004
      ? { tone: "positive", text: `You lent ${peso(lent)}` }
      : { tone: "muted", text: "Only you" };
  }
  if (item.yourShare > 0) return { tone: "negative", text: `You owe ${peso(item.yourShare)}` };
  return { tone: "muted", text: "Not involved" };
}

export default function HistoryPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [expenses, setExpenses] = useState<HistoryExpense[]>([]);

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [groupId, setGroupId] = useState("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [onlyMine, setOnlyMine] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    loadGroupsData(createClient())
      .then((result) => {
        if (!active || !result) return;
        setUserId(result.user.id);
        setUserName(result.user.name);
        setGroups(result.groups);
        setExpenses(result.expenses);
        if (result.warnings.length)
          setError(`Some activity could not be loaded: ${result.warnings.join("; ")}`);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load history.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  // Options popover: close on outside click or Escape.
  useEffect(() => {
    if (!showOptions) return;
    const onPointer = (event: PointerEvent) => {
      if (!optionsRef.current?.contains(event.target as Node)) setShowOptions(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowOptions(false);
        optionsButtonRef.current?.focus(); // return focus to the trigger
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [showOptions]);

  const filtered = useMemo(() => {
    // Payments (settle-ups) aren't stored yet, so only expenses can match.
    if (kind === "payments") return [];
    const query = search.trim().toLowerCase();
    const list = expenses.filter(
      (item) =>
        (groupId === "all" || item.groupId === groupId) &&
        (!onlyMine || item.involvesYou) &&
        (!query ||
          item.title.toLowerCase().includes(query) ||
          item.groupName.toLowerCase().includes(query) ||
          item.payerName.toLowerCase().includes(query)),
    );
    if (sort === "oldest") return [...list].reverse();
    if (sort === "largest") return [...list].sort((a, b) => b.amount - a.amount);
    return list;
  }, [expenses, kind, groupId, onlyMine, search, sort]);

  // Sections follow the list order, so "oldest first" needs no extra work.
  const sections = useMemo(
    () =>
      sort === "largest"
        ? [{ key: "largest", label: "LARGEST FIRST", items: filtered }]
        : groupByDate(filtered),
    [filtered, sort],
  );

  const filtersActive =
    Boolean(search.trim()) || kind !== "all" || groupId !== "all" || onlyMine || sort !== "newest";
  const clearFilters = () => {
    setSearch("");
    setKind("all");
    setGroupId("all");
    setOnlyMine(false);
    setSort("newest");
  };
  const closeAdd = useCallback(() => setShowAdd(false), []);

  const groupOptions = groups.filter((group) =>
    expenses.some((item) => item.groupId === group.id),
  );

  return (
    <main className="mn-app-page mn-history">
      <div className="mn-history-content">
        <header className="mn-history-top">
          <div className="mn-history-avatar" aria-label={userName ? `Signed in as ${userName}` : "Account"}>
            {initialOf(userName || "?")}
          </div>
          <div className="mn-history-options" ref={optionsRef}>
            <button
              type="button"
              ref={optionsButtonRef}
              className={`mn-icon-button ${filtersActive && (onlyMine || sort !== "newest") ? "is-on" : ""}`}
              aria-label="Sort and filter options"
              aria-expanded={showOptions}
              aria-haspopup="dialog"
              title="Sort and filter"
              onClick={() => setShowOptions((open) => !open)}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 6h16M7 12h10M10 18h4" />
              </svg>
            </button>
            {showOptions && (
              <div className="mn-history-popover" role="dialog" aria-label="Sort and filter options">
                <fieldset>
                  <legend>Sort by</legend>
                  {(
                    [
                      ["newest", "Newest first"],
                      ["oldest", "Oldest first"],
                      ["largest", "Largest amount"],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="mn-radio">
                      <input
                        type="radio"
                        name="history-sort"
                        checked={sort === value}
                        onChange={() => setSort(value)}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <label className="mn-check">
                  <input
                    type="checkbox"
                    checked={onlyMine}
                    onChange={(event) => setOnlyMine(event.target.checked)}
                  />
                  Only expenses I&apos;m part of
                </label>
              </div>
            )}
          </div>
        </header>

        <div className="mn-history-heading">
          <h1>History</h1>
          <p>Every expense and payment across your groups.</p>
        </div>

        <div className="mn-history-search">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m16 16 5 5" />
          </svg>
          <label htmlFor="history-search" className="mn-visually-hidden">
            Search history
          </label>
          <input
            id="history-search"
            type="search"
            placeholder="Search history"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button type="button" className="mn-search-clear" aria-label="Clear search" onClick={() => setSearch("")}>
              ×
            </button>
          )}
        </div>

        <div className="mn-history-filters" role="toolbar" aria-label="Filter history">
          {(
            [
              ["all", "All"],
              ["expenses", "Expenses"],
              ["payments", "Payments"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`mn-chip ${kind === value ? "is-selected" : ""}`}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
          <label className={`mn-chip mn-chip-select ${groupId !== "all" ? "is-selected" : ""}`}>
            <span className="mn-visually-hidden">Group</span>
            <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              <option value="all">All groups</option>
              {groupOptions.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </label>
        </div>

        {error && (
          <div className="mn-history-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setReloadKey((key) => key + 1)}>
              Try again
            </button>
          </div>
        )}

        {loading ? (
          <section className="mn-history-section" aria-busy="true" aria-label="Loading history">
            <div className="mn-history-label mn-skeleton-line" />
            <div className="mn-history-list">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="mn-history-row is-skeleton" aria-hidden="true">
                  <span className="mn-history-icon" />
                  <span className="mn-skeleton-text" />
                </div>
              ))}
            </div>
          </section>
        ) : expenses.length === 0 ? (
          <section className="mn-history-empty" aria-labelledby="history-empty-title">
            <div className="mn-history-empty-icon" aria-hidden="true">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </div>
            <h2 id="history-empty-title">No history yet</h2>
            <p>Expenses and payments from all your groups will show up here.</p>
            <button type="button" className="mn-button-primary" onClick={() => setShowAdd(true)}>
              <span aria-hidden="true">+</span> Add Expense
            </button>
          </section>
        ) : filtered.length === 0 ? (
          <section className="mn-history-empty is-filtered" aria-labelledby="history-filtered-title">
            <h2 id="history-filtered-title">
              {kind === "payments" ? "No payments yet" : "No activity matches your filters"}
            </h2>
            <p>
              {kind === "payments"
                ? "Payments you record when settling up will appear here."
                : "Try a broader search, or reset the filters to see everything."}
            </p>
            <div className="mn-history-empty-actions">
              <button type="button" className="mn-button-primary" onClick={clearFilters}>
                Clear all filters
              </button>
              <button type="button" className="mn-button-secondary" onClick={() => setShowAdd(true)}>
                Add Expense
              </button>
            </div>
          </section>
        ) : (
          sections.map((section) => (
            <section key={section.key} className="mn-history-section" aria-labelledby={`h-${section.key}`}>
              <h2 id={`h-${section.key}`} className="mn-history-label">
                {section.label}
              </h2>
              <ul className="mn-history-list">
                {section.items.map((item) => {
                  const meta = CATEGORY_META[item.category];
                  const who = involvement(item, userId);
                  return (
                    <li key={item.id}>
                      <Link
                        href={`/groups/${item.groupId}?expense=${encodeURIComponent(item.id)}`}
                        className="mn-history-row"
                      >
                        <span className="mn-history-icon" aria-hidden="true">
                          {meta.icon}
                        </span>
                        <span className="mn-history-text">
                          <strong>{item.title}</strong>
                          <span>
                            {item.groupName} · Paid by {item.payerName === "You" ? "you" : item.payerName}
                          </span>
                          <small className={`is-${who.tone}`}>{who.text}</small>
                        </span>
                        <span className="mn-history-amount">
                          <strong>{peso(item.amount)}</strong>
                          <span
                            className="mn-tag"
                            style={{
                              color: meta.color,
                              background: `color-mix(in srgb, ${meta.color} 16%, transparent)`,
                            }}
                          >
                            {meta.label}
                          </span>
                        </span>
                        <span className="mn-history-chevron" aria-hidden="true">
                          ›
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      <AppNav active="history" onAdd={() => setShowAdd(true)} />

      {showAdd && <AddExpensePicker groups={groups} onClose={closeAdd} />}
    </main>
  );
}
