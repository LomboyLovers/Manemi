"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import AppNav from "@/components/AppNav";
import PageHeader from "@/components/PageHeader";
import CategoryIcon from "@/components/CategoryIcon";
import Pagination from "@/components/Pagination";
import { CATEGORY_META, CURRENCIES, categoryKey, money } from "@/lib/manemi/format";
import { loadGroupsDataCached, type CurrentUser, type GroupSummary } from "@/lib/manemi/groups";
import { useDataVersion } from "@/lib/manemi/events";
import { useDebounced } from "@/lib/manemi/useDebounced";
import { listPersonal, personalInRange, PERSONAL_PAGE_SIZE, type PersonalExpense } from "@/lib/manemi/personal";
import "./personal.css";

// Pattern 1 (List / Index): your personal expenses. No group needed.

const monthStartDay = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
};

export default function PersonalPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [items, setItems] = useState<PersonalExpense[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const query = useDebounced(search.trim(), 300);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState<Map<string, { cents: number; count: number }>>(new Map());
  const [notice, setNotice] = useState("");
  const dataVersion = useDataVersion();

  // "Expense saved." / "Expense deleted." after coming back from the form.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("saved")) setNotice("Expense saved.");
    else if (params.has("deleted")) setNotice("Expense deleted.");
    if (params.has("saved") || params.has("deleted")) window.history.replaceState(null, "", "/personal");
  }, []);

  useEffect(() => {
    let alive = true;
    loadGroupsDataCached(createClient())
      .then((result) => {
        if (!alive || !result) return;
        setUser(result.user);
        setGroups(result.groups);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [dataVersion]);

  useEffect(() => setPage(1), [query]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    listPersonal(createClient(), { page, search: query })
      .then((result) => {
        if (!alive) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((reason: unknown) => alive && setError(reason instanceof Error ? reason.message : "Couldn't load your personal expenses."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [page, query, dataVersion]);

  // This month's totals, one per currency.
  useEffect(() => {
    let alive = true;
    personalInRange(createClient(), monthStartDay())
      .then((list) => {
        if (!alive) return;
        const map = new Map<string, { cents: number; count: number }>();
        for (const item of list) {
          const entry = map.get(item.currency) ?? { cents: 0, count: 0 };
          entry.cents += Math.round(item.amount * 100);
          entry.count += 1;
          map.set(item.currency, entry);
        }
        setMonth(map);
      })
      .catch(() => alive && setMonth(new Map()));
    return () => {
      alive = false;
    };
  }, [dataVersion]);

  const peso = month.get("PHP") ?? { cents: 0, count: 0 };
  const others = CURRENCIES.filter((item) => item.code !== "PHP" && month.has(item.code)).map((item) => ({
    code: item.code,
    ...month.get(item.code)!,
  }));
  const monthName = new Date().toLocaleDateString("en-PH", { month: "long" });

  return (
    <main className="mn-app-page mn-personal">
      <div className="mn-personal-content">
        <PageHeader user={user} />

        <header className="mn-personal-heading">
          <div>
            <h1>Personal expenses</h1>
            <p>Your own costs, without a group. Only you can see them.</p>
          </div>
          <Link href="/personal/add" className="mn-personal-add">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Personal Expense
          </Link>
        </header>

        {notice && (
          <p className="mn-personal-notice" role="status">
            {notice}
          </p>
        )}

        <section className="mn-personal-summary" aria-label={`Spent in ${monthName}`}>
          <div>
            <span>Spent in {monthName}</span>
            <strong>{money(peso.cents / 100, "PHP")}</strong>
            <small>
              {peso.count} {peso.count === 1 ? "expense" : "expenses"} · counts toward your Home spending
            </small>
          </div>
          {others.length > 0 && (
            <ul className="md-currency-totals mn-personal-currencies" aria-label="Other currencies this month">
              {others.map((item) => (
                <li key={item.code}>
                  <span className="md-currency-code">{item.code}</span>
                  <span className="md-currency-text">
                    <strong>{money(item.cents / 100, item.code)}</strong>
                    <small>
                      {item.count} {item.count === 1 ? "expense" : "expenses"}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mn-personal-search">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m16 16 5 5" />
          </svg>
          <label htmlFor="personal-search" className="mn-visually-hidden">
            Search personal expenses
          </label>
          <input
            id="personal-search"
            type="search"
            placeholder="Search personal expenses"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <section className="mn-personal-list" aria-busy={loading} aria-label="Personal expenses">
          {error ? (
            <p className="mn-personal-empty" role="alert">
              {error}
            </p>
          ) : !loading && items.length === 0 ? (
            query ? (
              <div className="mn-personal-empty">
                <h2>No personal expenses match &ldquo;{query}&rdquo;</h2>
                <p>Try a different word, or clear the search.</p>
                <button type="button" className="mn-personal-secondary" onClick={() => setSearch("")}>
                  Clear search
                </button>
              </div>
            ) : (
              <div className="mn-personal-empty">
                <h2>No personal expenses yet</h2>
                <p>Add costs that are just yours, like lunch or a subscription. They count toward your spending on Home.</p>
                <Link href="/personal/add" className="mn-personal-add">
                  Add Personal Expense
                </Link>
              </div>
            )
          ) : (
            <ul>
              {items.map((item) => {
                const key = categoryKey(item.category);
                return (
                  <li key={item.id}>
                    <Link href={`/personal/add?edit=${encodeURIComponent(item.id)}`} aria-label={`Edit ${item.title}`}>
                      <span className="mn-personal-icon" aria-hidden="true">
                        <CategoryIcon name={key} size={22} />
                      </span>
                      <span className="mn-personal-text">
                        <strong>{item.title}</strong>
                        <small>
                          {CATEGORY_META[key].label} ·{" "}
                          {new Date(item.date).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
                          {item.receiptUrl ? " · Receipt" : ""}
                        </small>
                        {item.note && <em>{item.note}</em>}
                      </span>
                      <span className="mn-personal-amount">{money(item.amount, item.currency)}</span>
                      <svg className="mn-personal-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {total > PERSONAL_PAGE_SIZE && (
          <Pagination page={page} total={total} pageSize={PERSONAL_PAGE_SIZE} onChange={setPage} noun="expenses" busy={loading} />
        )}
      </div>
      <AppNav active="personal" groups={groups} />
    </main>
  );
}
