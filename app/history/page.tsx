"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import AppNav from "@/components/AppNav";
import QuickActions from "@/components/QuickActions";
import PageHeader from "@/components/PageHeader";
import {
  loadGroupsDataCached,
  type CurrentUser,
  type GroupSummary,
  type HistoryExpense,
} from "@/lib/manemi/groups";
import { CATEGORY_META, money, peso } from "@/lib/manemi/format";
import DatePicker from "@/components/DatePicker";
import { ACTIVITY_META, type ActivityItem } from "@/lib/manemi/activity";
import { HISTORY_EVERYTHING, HISTORY_PERSONAL, PAGE_SIZE, reportExpenses, searchActivity, searchHistory } from "@/lib/manemi/search";
import { personalInRange } from "@/lib/manemi/personal";
import { useDebounced } from "@/lib/manemi/useDebounced";
import Pagination from "@/components/Pagination";
import CategoryIcon, { type GlyphName } from "@/components/CategoryIcon";
import Select from "@/components/Select";

const ACTION_GLYPH: Record<ActivityItem["action"], GlyphName> = {
  expense_created: "added",
  expense_updated: "edited",
  expense_deleted: "deleted",
  settlement_recorded: "payment",
  settlement_updated: "edited",
  settlement_cancelled: "cancelled",
};
import { useDataVersion } from "@/lib/manemi/events";
import "./history.css";

// Pattern 10 (Inbox / Activity Feed), variant A: a standalone, newest-first
// feed of expenses and payments across every group, plus the audit log
// (who added, edited, deleted, paid or cancelled what).

type Kind = "all" | "expenses" | "payments" | "activity";
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
function groupByDate<T extends { date: string }>(items: T[], now = new Date()) {
  const today = startOfDay(now);
  const sections: Array<{ key: string; label: string; items: T[] }> = [];
  const byKey = new Map<string, T[]>();

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
  if (item.kind === "payment") {
    if (item.payerId === myId) return { tone: "negative", text: `You paid ${peso(item.amount)}` };
    if (item.receiverId === myId) return { tone: "positive", text: `You received ${peso(item.amount)}` };
    return { tone: "muted", text: "Not involved" };
  }
  if (item.payerId === myId) {
    const lent = item.amount - item.yourShare;
    return lent > 0.004
      ? { tone: "positive", text: `You lent ${money(lent, item.currency)}` }
      : { tone: "muted", text: "Only you" };
  }
  if (item.yourShare > 0) return { tone: "negative", text: `You owe ${money(item.yourShare, item.currency)}` };
  return { tone: "muted", text: "Not involved" };
}

export default function HistoryPage() {
  // Page shell (user + group list for the filter) comes from the shared cache;
  // the list itself is searched and paginated in the database, 10 at a time.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [groups, setGroups] = useState<GroupSummary[]>([]);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [kindPick, setKind] = useState<Kind>("all");
  // Type (groups / personal / both) is separate from which group.
  const [scope, setScope] = useState<"groups" | "personal" | "all">("all");
  const [notice, setNotice] = useState("");
  // This month's spending (your share, pesos): groups and personal.
  const [month, setMonth] = useState<{ groups: number; personal: number } | null>(null);
  const [groupId, setGroupId] = useState("all");
  // Personal expenses have no payments, audit log or members: it is always the expense list.
  const kind: Kind = scope === "personal" ? "expenses" : kindPick;
  const groupFilter = scope === "personal" ? HISTORY_PERSONAL : scope === "all" ? HISTORY_EVERYTHING : groupId;
  const [sort, setSort] = useState<Sort>("newest");
  const [onlyMine, setOnlyMine] = useState(false);
  // HIST-02: category, member and date range
  const [category, setCategory] = useState("all");
  const [memberId, setMemberId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [page, setPage] = useState(1);
  const [showOptions, setShowOptions] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const dataVersion = useDataVersion();

  const [items, setItems] = useState<HistoryExpense[]>([]);
  const [logItems, setLogItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  // Whether there's anything at all (for the first-use empty state).
  const [everything, setEverything] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setError("");
    loadGroupsDataCached(createClient())
      .then((result) => {
        if (!active || !result) return;
        setUserId(result.user.id);
        setUser(result.user);
        setGroups(result.groups);
        // Everyone in your groups, for the member filter.
        const ids = [...new Set(result.groups.flatMap((group) => group.memberIds))];
        if (ids.length)
          void createClient()
            .from("User")
            .select("userId, name")
            .in("userId", ids)
            .then(({ data }) => {
              if (!active || !data) return;
              setPeople(
                (data as Array<{ userId: string; name: string | null }>)
                  .map((row) => ({
                    id: row.userId,
                    name: row.userId === result.user.id ? "You" : String(row.name ?? "").trim() || "Member",
                  }))
                  .sort((a, b) => (a.name === "You" ? -1 : b.name === "You" ? 1 : a.name.localeCompare(b.name))),
              );
            });
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
  }, [reloadKey, dataVersion]);

  // New filters start again at page 1.
  useEffect(() => {
    setPage(1);
  }, [kind, scope, groupId, debouncedSearch, onlyMine, sort, category, memberId, dateFrom, dateTo]);

  const isLog = kind === "activity";

  // Coming from the old Personal page or the form: "?type=personal", "?saved", "?deleted".
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("type") === "personal") setScope("personal");
    if (params.has("saved")) setNotice("Expense saved.");
    else if (params.has("deleted")) setNotice("Expense deleted.");
    if (params.size) window.history.replaceState(null, "", "/history");
  }, []);

  // Month totals for the summary card (loaded once per data change).
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const now = new Date();
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const supabase = createClient();
    Promise.all([
      reportExpenses(supabase, userId, { groupId: "all", from }),
      personalInRange(supabase, from).catch(() => []),
    ])
      .then(([fromGroups, personal]) => {
        if (!alive) return;
        const sum = (list: Array<{ currency: string; yourShare: number }>) =>
          list.reduce((total, row) => (row.currency === "PHP" ? total + Math.round(row.yourShare * 100) : total), 0) / 100;
        setMonth({
          groups: sum(fromGroups),
          personal: sum(personal.map((item) => ({ currency: item.currency, yourShare: item.amount }))),
        });
      })
      .catch(() => alive && setMonth(null));
    return () => {
      alive = false;
    };
  }, [userId, dataVersion]);

  // One database query per page / filter change (search is debounced).
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setListLoading(true);
    setListError("");
    const supabase = createClient();
    const filters = { groupId: groupFilter, query: debouncedSearch, onlyMine, sort, category, memberId: scope === "personal" ? "all" : memberId, from: dateFrom, to: dateTo };
    const request = isLog
      ? searchActivity(supabase, userId, filters, page)
      : searchHistory(supabase, userId, { ...filters, kind: kind as "all" | "expenses" | "payments" }, page);
    request
      .then((result) => {
        if (!active) return;
        if (isLog) setLogItems(result.items as ActivityItem[]);
        else setItems(result.items as HistoryExpense[]);
        setTotal(result.total);
        const unfiltered =
          !debouncedSearch.trim() && scope === "all" && !onlyMine && kind === "all" &&
          category === "all" && memberId === "all" && !dateFrom && !dateTo;
        if (unfiltered) setEverything(result.total);
        // Deleted rows can leave us past the last page.
        if (!result.items.length && page > 1) setPage(Math.max(1, Math.ceil(result.total / PAGE_SIZE)));
      })
      .catch((reason: unknown) => {
        if (active) setListError(reason instanceof Error ? reason.message : "Couldn't load history.");
      })
      .finally(() => {
        if (active) setListLoading(false);
      });
    return () => {
      active = false; // a newer request replaced this one
    };
  }, [userId, isLog, kind, groupFilter, debouncedSearch, onlyMine, sort, category, memberId, dateFrom, dateTo, page, reloadKey, dataVersion]);

  const changePage = (next: number) => {
    setPage(next);
    document.querySelector(".mn-history-filters")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  // Options popover: close on outside click or Escape.
  useEffect(() => {
    if (!showOptions) return;
    const onPointer = (event: PointerEvent) => {
      if (!optionsRef.current?.contains(event.target as Node)) setShowOptions(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
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

  // Sections follow the order the database returned.
  const logSections = useMemo(
    () =>
      sort === "largest"
        ? [{ key: "largest", label: "LARGEST FIRST", items: logItems }]
        : groupByDate(logItems),
    [logItems, sort],
  );
  const sections = useMemo(
    () =>
      sort === "largest"
        ? [{ key: "largest", label: "LARGEST FIRST", items }]
        : groupByDate(items),
    [items, sort],
  );

  const filtersActive =
    Boolean(search.trim()) || kind !== "all" || scope !== "all" || onlyMine || sort !== "newest" ||
    category !== "all" || memberId !== "all" || Boolean(dateFrom || dateTo);
  const clearFilters = () => {
    setSearch("");
    setKind("all");
    setScope("all");
    setGroupId("all");
    setOnlyMine(false);
    setSort("newest");
    setCategory("all");
    setMemberId("all");
    setDateFrom("");
    setDateTo("");
  };
  const closeAdd = useCallback(() => setShowAdd(false), []);

  const groupOptions = groups;
  const noFilters =
    !debouncedSearch.trim() && scope === "all" && !onlyMine && category === "all" &&
    memberId === "all" && !dateFrom && !dateTo;

  return (
    <main className="mn-app-page mn-history">
      <div className="mn-history-content">
        <PageHeader user={user} showBell={false}>
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
                  {isLog ? "Only activity involving me" : "Only expenses I'm part of"}
                </label>
                {!isLog && (
                  <fieldset className="mn-history-dates">
                    <legend>Date range</legend>
                    <div>
                      <span>From</span>
                      {dateFrom ? (
                        <DatePicker label="From" value={dateFrom} onChange={setDateFrom} max={dateTo || undefined} />
                      ) : (
                        <button type="button" className="mn-date-add" onClick={() => setDateFrom(dateTo || new Date().toISOString().slice(0, 8) + "01")}>
                          Any time
                        </button>
                      )}
                    </div>
                    <div>
                      <span>To</span>
                      {dateTo ? (
                        <DatePicker label="To" value={dateTo} onChange={setDateTo} />
                      ) : (
                        <button type="button" className="mn-date-add" onClick={() => setDateTo(new Date().toISOString().slice(0, 10))}>
                          Today
                        </button>
                      )}
                    </div>
                    {(dateFrom || dateTo) && (
                      <button type="button" className="mn-date-clear" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                        Clear dates
                      </button>
                    )}
                  </fieldset>
                )}
              </div>
            )}
          </div>
        </PageHeader>

        <div className="mn-history-heading">
          <h1>History</h1>
          <p>
            {isLog
              ? "Audit log: who added, edited, deleted or paid what, in every group."
              : "Every expense and payment, in your groups and your own."}
          </p>
        </div>

        {notice && (
          <p className="mn-history-notice" role="status">
            {notice}
          </p>
        )}

        {!isLog && month && (
          <section className="mn-history-summary" aria-label="Spent this month">
            <div>
              <span>Spent in {new Date().toLocaleDateString("en-PH", { month: "long" })}</span>
              <strong>{peso(month.groups + month.personal)}</strong>
            </div>
            <dl>
              <div>
                <dt>Groups</dt>
                <dd>{peso(month.groups)}</dd>
              </div>
              <div>
                <dt>Personal</dt>
                <dd>{peso(month.personal)}</dd>
              </div>
            </dl>
          </section>
        )}

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

        <div className="mn-history-type">
    <Select
      variant="chip"
      align="start"
      label="Type"
      prefix="Type"
      value={scope}
      active={scope !== "all"}
      onChange={(value) => setScope(value as "groups" | "personal" | "all")}
      options={[
        { value: "all", label: "Groups + personal" },
        { value: "groups", label: "Groups" },
        { value: "personal", label: "Personal" },
      ]}
    />
        </div>

        <div className="mn-history-filters" role="toolbar" aria-label="Filter history">
          {scope !== "personal" && (
            [
              ["all", "All"],
              ["expenses", "Expenses"],
              ["payments", "Payments"],
              ["activity", "Audit log"],
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
          {scope === "groups" && (
            <Select
              variant="chip"
              align="start"
              label="Group"
              value={groupId}
              active={groupId !== "all"}
              onChange={setGroupId}
              options={[
                { value: "all", label: "All groups" },
                ...groupOptions.map((group) => ({ value: group.id, label: group.name })),
              ]}
            />
          )}
          {!isLog && kind !== "payments" && (
            <Select
              variant="chip"
              align="start"
              label="Category"
              value={category}
              active={category !== "all"}
              onChange={setCategory}
              options={[
                { value: "all", label: "All categories" },
                ...Object.entries(CATEGORY_META).map(([key, meta]) => ({ value: key, label: meta.label })),
              ]}
            />
          )}
          {!isLog && scope !== "personal" && people.length > 1 && (
            <Select
              variant="chip"
              align="start"
              label="Member"
              value={memberId}
              active={memberId !== "all"}
              onChange={setMemberId}
              options={[{ value: "all", label: "Everyone" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
            />
          )}
          {!isLog && (dateFrom || dateTo) && (
            <button type="button" className="mn-chip is-selected" onClick={() => setShowOptions(true)}>
              {dateFrom ? new Date(`${dateFrom}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : "Start"}
              {" – "}
              {dateTo ? new Date(`${dateTo}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : "Today"}
            </button>
          )}
        </div>

        {error && (
          <div className="mn-history-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setReloadKey((key) => key + 1)}>
              Try again
            </button>
          </div>
        )}

        {!loading && listError && (
          <div className="mn-history-error" role="alert">
            <span>{listError}</span>
            <button type="button" onClick={() => setReloadKey((key) => key + 1)}>
              Try again
            </button>
          </div>
        )}

        {loading || (listLoading && (isLog ? !logItems.length : !items.length)) ? (
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
        ) : isLog ? (
          logItems.length === 0 ? (
            <section className="mn-history-empty is-filtered" aria-labelledby="log-empty-title">
              <h2 id="log-empty-title">
                {noFilters ? "No activity yet" : "No activity matches your filters"}
              </h2>
              <p>
                {noFilters
                  ? "When anyone adds, edits or deletes an expense, or records a payment, it's logged here."
                  : "Try a broader search, or reset the filters to see everything."}
              </p>
              <div className="mn-history-empty-actions">
                {!noFilters && (
                  <button type="button" className="mn-button-primary" onClick={() => { clearFilters(); setKind("activity"); }}>
                    Clear all filters
                  </button>
                )}
                <button type="button" className="mn-button-secondary" onClick={() => setShowAdd(true)}>
                  Add Expense
                </button>
              </div>
            </section>
          ) : (
            <div className={`mn-history-results ${listLoading ? "is-busy" : ""}`} aria-busy={listLoading}>
            {logSections.map((section) => (
              <section key={section.key} className="mn-history-section" aria-labelledby={`l-${section.key}`}>
                <h2 id={`l-${section.key}`} className="mn-history-label">
                  {section.label}
                </h2>
                <ul className="mn-history-list">
                  {section.items.map((item) => {
                    const meta = ACTIVITY_META[item.action];
                    const time = new Date(item.date).toLocaleTimeString("en-PH", {
                      hour: "numeric",
                      minute: "2-digit",
                    });
                    const body = (
                      <>
                        <span className="mn-history-icon" aria-hidden="true">
                          <CategoryIcon name={ACTION_GLYPH[item.action]} color={meta.color} size={24} />
                        </span>
                        <span className="mn-history-text">
                          <strong>{item.title}</strong>
                          <span>
                            {item.groupName} · {new Date(item.date).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}, {time}
                          </span>
                          {item.detail && <small className="is-muted">{item.detail}</small>}
                        </span>
                        <span className="mn-history-amount">
                          {item.amount > 0 && <strong>{peso(item.amount)}</strong>}
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
                      </>
                    );
                    const href =
                      item.action === "expense_deleted"
                        ? null
                        : item.entityType === "expense"
                          ? `/groups/${item.groupId}?expense=${encodeURIComponent(item.entityId)}`
                          : `/groups/${item.groupId}`;
                    return (
                      <li key={item.id}>
                        {href ? (
                          <Link href={href} className="mn-history-row">
                            {body}
                            <span className="mn-history-chevron" aria-hidden="true">
                              ›
                            </span>
                          </Link>
                        ) : (
                          <div className="mn-history-row is-static">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={changePage} busy={listLoading} />
            </div>
          )
        ) : everything === 0 && kind === "all" && noFilters ? (
          <section className="mn-history-empty" aria-labelledby="history-empty-title">
            <div className="mn-history-empty-icon" aria-hidden="true">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </div>
            <h2 id="history-empty-title">No history yet</h2>
            <p>Expenses and payments from your groups, plus your personal expenses, will show up here.</p>
            <button type="button" className="mn-button-primary" onClick={() => setShowAdd(true)}>
              <span aria-hidden="true">+</span> Add Expense
            </button>
          </section>
        ) : items.length === 0 ? (
          <section className="mn-history-empty is-filtered" aria-labelledby="history-filtered-title">
            <h2 id="history-filtered-title">
              {kind === "payments" && !search.trim() && scope === "all" && !onlyMine
                ? "No payments yet"
                : "No activity matches your filters"}
            </h2>
            <p>
              {kind === "payments" && !search.trim() && scope === "all" && !onlyMine
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
          <div className={`mn-history-results ${listLoading ? "is-busy" : ""}`} aria-busy={listLoading}>
          {sections.map((section) => (
            <section key={section.key} className="mn-history-section" aria-labelledby={`h-${section.key}`}>
              <h2 id={`h-${section.key}`} className="mn-history-label">
                {section.label}
              </h2>
              <ul className="mn-history-list">
                {section.items.map((item) => {
                  const isPayment = item.kind === "payment";
                  const meta = isPayment
                    ? { label: "Payment", color: "#3DDC84" }
                    : CATEGORY_META[item.category];
                  const who = involvement(item, userId);
                  const isPersonal = item.groupId === HISTORY_PERSONAL;
                  return (
                    <li key={item.id}>
                      <Link
                        href={
                          isPersonal
                            ? `/personal/add?edit=${encodeURIComponent(item.id)}`
                            : isPayment
                              ? `/groups/${item.groupId}`
                              : `/groups/${item.groupId}?expense=${encodeURIComponent(item.id)}`
                        }
                        className="mn-history-row"
                      >
                        <span className="mn-history-icon" aria-hidden="true">
                          {isPayment ? (
                            <CategoryIcon name="payment" color={meta.color} size={24} />
                          ) : (
                            <CategoryIcon name={item.category} size={24} />
                          )}
                        </span>
                        <span className="mn-history-text">
                          <strong>{item.title}</strong>
                          <span>
                            {isPayment
                              ? `${item.groupName} · Payment${item.paymentMethod ? ` · ${item.paymentMethod === "gcash" ? "GCash" : item.paymentMethod === "bank_transfer" ? "Bank transfer" : "Cash"}` : ""}`
                              : `${item.groupName} · Paid by ${item.payerName === "You" ? "you" : item.payerName}`}
                          </span>
                          <small className={`is-${who.tone}`}>{who.text}</small>
                        </span>
                        <span className="mn-history-amount">
                          <strong>{money(item.amount, item.currency)}</strong>
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
          ))}
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={changePage} busy={listLoading} />
          </div>
        )}
      </div>

      <AppNav active="history" groups={loading ? undefined : groups} />

      {showAdd && <QuickActions groups={groups} initialStep="add-type" onClose={closeAdd} />}
    </main>
  );
}
