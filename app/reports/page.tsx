"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import AppNav from "@/components/AppNav";
import PageHeader from "@/components/PageHeader";
import Select from "@/components/Select";
import DatePicker, { toIso } from "@/components/DatePicker";
import CategoryIcon from "@/components/CategoryIcon";
import Pagination from "@/components/Pagination";
import { CATEGORY_META, categoryKey, money, peso, type CategoryKey } from "@/lib/manemi/format";
import { loadGroupsDataCached, type CurrentUser, type GroupSummary } from "@/lib/manemi/groups";
import { reportExpenses, type ReportRow } from "@/lib/manemi/search";
import { personalAsReportRows, personalInRange } from "@/lib/manemi/personal";
import { useDataVersion } from "@/lib/manemi/events";
import { expensesToCsv, exportFileName } from "@/lib/manemi/csv";
import "./reports.css";

// Pattern 9 (Analytics / Reporting): filter by group and period, see totals,
// spending by category, the itemized list and balances, export as CSV or PDF.
// SRS DASH-02 (period summary), DASH-03 (by category), DASH-04 (date ranges),
// DASH-05 (CSV export), DASH-06 (PDF export).

type Period = "week" | "month" | "30d" | "year" | "custom";

function rangeFor(period: Period, now = new Date()) {
  const day = (d: Date) => toIso(d);
  if (period === "week") {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    return { from: day(monday), to: day(now) };
  }
  if (period === "month") return { from: day(new Date(now.getFullYear(), now.getMonth(), 1)), to: day(now) };
  if (period === "30d") return { from: day(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)), to: day(now) };
  return { from: day(new Date(now.getFullYear(), 0, 1)), to: day(now) };
}

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "30d", label: "Last 30 days" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom range" },
];

const PER_PAGE = 10;
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });

export default function ReportsPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupId, setGroupId] = useState("all");
  const [period, setPeriod] = useState<Period>("month");
  const [custom, setCustom] = useState(() => rangeFor("month"));
  const [allRows, setAllRows] = useState<ReportRow[]>([]);
  const [category, setCategory] = useState<"all" | CategoryKey>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const dataVersion = useDataVersion();

  const range = period === "custom" ? custom : rangeFor(period);

  useEffect(() => {
    let active = true;
    loadGroupsDataCached(createClient())
      .then((result) => {
        if (!active || !result) return;
        setUser(result.user);
        setGroups(result.groups);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [dataVersion]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setError("");
    const supabase = createClient();
    // "all" = every group plus personal expenses; "personal" = personal only.
    const groupRows =
      groupId === "personal" ? Promise.resolve([]) : reportExpenses(supabase, user.id, { groupId, from: range.from, to: range.to });
    const personalRows =
      groupId === "all" || groupId === "personal"
        ? personalInRange(supabase, range.from, range.to)
            .then(personalAsReportRows)
            .catch((reason: unknown) => {
              if (groupId === "personal") throw reason;
              return [] as ReportRow[];
            })
        : Promise.resolve([] as ReportRow[]);
    Promise.all([groupRows, personalRows])
      .then(([fromGroups, personal]) => [...fromGroups, ...personal].sort((a, b) => (a.date < b.date ? 1 : -1)))
      .then((list) => {
        if (!active) return;
        setAllRows(list);
        setPage(1);
      })
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : "Couldn't load the report."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [user, groupId, range.from, range.to, dataVersion]);

  // Everything below follows the Category filter; the category bars stay on all
  // categories so another one is one click away.
  const rows = useMemo(
    () => (category === "all" ? allRows : allRows.filter((row) => categoryKey(row.category) === category)),
    [allRows, category],
  );

  const categoryReport = useMemo(() => {
    if (category === "all") return null;
    const php = rows.filter((row) => row.currency === "PHP");
    const byGroup = new Map<string, { id: string; name: string; count: number; total: number }>();
    const byMonth = new Map<string, number>();
    for (const row of php) {
      const entry = byGroup.get(row.groupId) ?? { id: row.groupId, name: row.groupName, count: 0, total: 0 };
      entry.count += 1;
      entry.total += row.amount;
      byGroup.set(row.groupId, entry);
      const month = row.date.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + row.amount);
    }
    const months = [...byMonth].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, total]) => ({ month, total }));
    return {
      groups: [...byGroup.values()].sort((a, b) => b.total - a.total),
      months,
      peak: months.reduce((max, item) => Math.max(max, item.total), 0),
    };
  }, [rows, category]);

  // Totals are in pesos; other currencies are listed separately.
  const report = useMemo(() => {
    const php = rows.filter((row) => row.currency === "PHP");
    const phpAll = allRows.filter((row) => row.currency === "PHP");
    const totalAll = phpAll.reduce((sum, row) => sum + row.amount, 0);
    const total = php.reduce((sum, row) => sum + row.amount, 0);
    const yours = php.reduce((sum, row) => sum + row.yourShare, 0);
    const byCategory = new Map<CategoryKey, number>();
    for (const row of phpAll) {
      const key = categoryKey(row.category);
      byCategory.set(key, (byCategory.get(key) ?? 0) + row.amount);
    }
    const categories = [...byCategory]
      .map(([key, amount]) => ({ key, amount, share: totalAll ? amount / totalAll : 0 }))
      .sort((a, b) => b.amount - a.amount);
    const other = new Map<string, number>();
    for (const row of rows) if (row.currency !== "PHP") other.set(row.currency, (other.get(row.currency) ?? 0) + row.amount);
    const largest = php.reduce<ReportRow | null>((max, row) => (!max || row.amount > max.amount ? row : max), null);
    return { total, yours, count: rows.length, phpCount: php.length, categories, other, largest };
  }, [rows, allRows]);

  const balances = groups
    .filter((group) => groupId === "all" || group.id === groupId)
    .filter((group) => group.net !== 0 || groupId !== "all");
  const groupName =
    groupId === "all"
      ? "All groups + personal"
      : groupId === "personal"
        ? "Personal expenses"
        : groups.find((group) => group.id === groupId)?.name ?? "Group";
  const categoryLabel = category === "all" ? "" : CATEGORY_META[category].label;
  const exportScope = categoryLabel ? `${groupName} ${categoryLabel}` : groupName;
  const pageRows = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  /** DASH-05: every expense in the current filters (not just this page). */
  function exportCsv() {
    const csv = expensesToCsv(rows, (key) => CATEGORY_META[categoryKey(key)].label);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName(exportScope, range.from, range.to, "csv");
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** DASH-06: the browser's "Save as PDF" names the file after the page title. */
  function exportPdf() {
    const previous = document.title;
    document.title = exportFileName(exportScope, range.from, range.to, "pdf").replace(/\.pdf$/, "");
    const restore = () => {
      document.title = previous;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }

  return (
    <main className="mn-app-page mn-reports">
      <div className="mn-reports-content">
        <PageHeader user={user} showBell={false}>
          <div className="mn-reports-exports">
            <button
              type="button"
              className="mn-reports-export is-secondary"
              onClick={exportCsv}
              disabled={loading || !rows.length}
              title="Download every expense in this report as a spreadsheet file"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
              </svg>
              CSV
            </button>
            <button
              type="button"
              className="mn-reports-export"
              onClick={exportPdf}
              disabled={loading || !rows.length}
              title="Save this report as a PDF (choose Save as PDF in the print window)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
              </svg>
              PDF
            </button>
          </div>
        </PageHeader>

        <header className="mn-reports-heading">
          <h1>Reports</h1>
          <p>Spending by period, category and group.</p>
          <p className="mn-print-only">
            {groupName}
            {categoryLabel ? ` · ${categoryLabel}` : ""} · {longDate(range.from)} – {longDate(range.to)} · Prepared for {user?.name ?? ""}
          </p>
        </header>

        <div className="mn-reports-filters" role="toolbar" aria-label="Report filters">
          <Select
            variant="chip"
            align="start"
            label="Group"
            value={groupId}
            active={groupId !== "all"}
            onChange={setGroupId}
            options={[
              { value: "all", label: "All groups + personal" },
              { value: "personal", label: "Personal only" },
              ...groups.map((group) => ({ value: group.id, label: group.name })),
            ]}
          />
          <Select
            variant="chip"
            align="start"
            label="Category"
            value={category}
            active={category !== "all"}
            onChange={(value) => {
              setCategory(value as "all" | CategoryKey);
              setPage(1);
            }}
            options={[
              { value: "all", label: "All categories" },
              ...(Object.keys(CATEGORY_META) as CategoryKey[]).map((key) => ({ value: key, label: CATEGORY_META[key].label })),
            ]}
          />
          <Select
            variant="chip"
            align="start"
            label="Period"
            value={period}
            active
            onChange={(value) => setPeriod(value as Period)}
            options={PERIODS}
          />
          {period === "custom" && (
            <span className="mn-reports-range">
              <DatePicker label="From" value={custom.from} max={custom.to} onChange={(from) => setCustom({ ...custom, from })} />
              <span aria-hidden="true">–</span>
              <DatePicker label="To" value={custom.to} max={toIso(new Date())} onChange={(to) => setCustom({ ...custom, to: to < custom.from ? custom.from : to })} />
            </span>
          )}
        </div>

        {error && (
          <p className="mn-reports-error" role="alert">
            {error}
          </p>
        )}

        <section className={`mn-reports-kpis ${loading ? "is-busy" : ""}`} aria-label="Totals" aria-busy={loading}>
          <div>
            <span>Total spent</span>
            <strong>{peso(report.total)}</strong>
            <small>
              {shortDate(range.from)} – {shortDate(range.to)}, {range.to.slice(0, 4)}
            </small>
          </div>
          <div>
            <span>Your share</span>
            <strong>{peso(report.yours)}</strong>
            <small>{report.total ? Math.round((report.yours / report.total) * 100) : 0}% of the total</small>
          </div>
          <div>
            <span>Expenses</span>
            <strong>{report.count}</strong>
            <small>{report.phpCount ? `Avg ${peso(report.total / report.phpCount)}` : "None in this period"}</small>
          </div>
          <div>
            <span>Largest expense</span>
            <strong>{report.largest ? peso(report.largest.amount) : "—"}</strong>
            <small>{report.largest ? report.largest.title : "—"}</small>
          </div>
        </section>
        {report.other.size > 0 && (
          <p className="mn-reports-note">
            Also spent {[...report.other].map(([code, amount]) => money(amount, code)).join(" + ")} in other
            currencies (not included in the peso totals).
          </p>
        )}

        <div className="mn-reports-grid">
          <section className="mn-reports-card" aria-labelledby="by-category">
            <h2 id="by-category">Spending by category</h2>
            {report.categories.length ? (
              <ul className="mn-reports-bars">
                {report.categories.map((item) => {
                  const meta = CATEGORY_META[item.key];
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        className={`mn-reports-bar-row ${category === item.key ? "is-selected" : ""}`}
                        aria-pressed={category === item.key}
                        aria-label={`${meta.label}: ${peso(item.amount)}. ${category === item.key ? "Showing only this category. Tap to show all." : "Tap to report on this category only."}`}
                        onClick={() => {
                          setCategory(category === item.key ? "all" : item.key);
                          setPage(1);
                        }}
                      >
                        <span className="mn-reports-bar-label">
                          <CategoryIcon name={item.key} size={18} />
                          {meta.label}
                        </span>
                        <span className="mn-reports-bar-track" aria-hidden="true">
                          <span style={{ width: `${Math.max(item.share * 100, 2)}%`, background: meta.color }} />
                        </span>
                        <span className="mn-reports-bar-value">
                          <strong>{peso(item.amount)}</strong>
                          <small>{Math.round(item.share * 100)}%</small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mn-reports-empty">No expenses in this period.</p>
            )}
          </section>

          <section className="mn-reports-card" aria-labelledby="balances-title">
            <h2 id="balances-title">Balances right now</h2>
            {groupId === "personal" ? (
              <p className="mn-reports-empty">Personal expenses are yours alone, so they have no balances.</p>
            ) : balances.length ? (
              <ul className="mn-reports-balances">
                {balances.map((group) => (
                  <li key={group.id}>
                    <Link href={`/groups/${group.id}`}>{group.name}</Link>
                    <strong className={group.net > 0 ? "is-positive" : group.net < 0 ? "is-negative" : ""}>
                      {group.net === 0 ? "Settled" : `${group.net > 0 ? "You're owed" : "You owe"} ${peso(Math.abs(group.net))}`}
                    </strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mn-reports-empty">You&apos;re settled up everywhere.</p>
            )}
          </section>
        </div>

        {category !== "all" && categoryReport && (
          <section className="mn-reports-card mn-reports-category" aria-labelledby="category-title">
            <div className="mn-reports-category-head">
              <h2 id="category-title">
                <CategoryIcon name={category} size={20} />
                {categoryLabel} report
              </h2>
              <button type="button" className="mn-reports-clear" onClick={() => setCategory("all")}>
                Show all categories
              </button>
            </div>
            {categoryReport.groups.length ? (
              <div className="mn-reports-category-grid">
                <div>
                  <h3>By group</h3>
                  <ul className="mn-reports-split">
                    {categoryReport.groups.map((item) => (
                      <li key={item.id}>
                        <span>
                          {item.name}
                          <small>
                            {item.count} {item.count === 1 ? "expense" : "expenses"}
                          </small>
                        </span>
                        <strong>{peso(item.total)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>By month</h3>
                  <ul className="mn-reports-split">
                    {categoryReport.months.map((item) => (
                      <li key={item.month}>
                        <span>
                          {new Date(`${item.month}-01T00:00:00`).toLocaleDateString("en-PH", { month: "long", year: "numeric" })}
                          <span className="mn-reports-split-bar" aria-hidden="true">
                            <span
                              style={{
                                width: `${categoryReport.peak ? Math.max((item.total / categoryReport.peak) * 100, 3) : 0}%`,
                                background: CATEGORY_META[category].color,
                              }}
                            />
                          </span>
                        </span>
                        <strong>{peso(item.total)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="mn-reports-empty">No {categoryLabel.toLowerCase()} expenses in this period. Try a longer range.</p>
            )}
          </section>
        )}

        <section className="mn-reports-card" aria-labelledby="itemized-title">
          <h2 id="itemized-title">Itemized expenses</h2>
          {rows.length ? (
            <>
              <div className="mn-reports-table-wrap">
                <table className="mn-reports-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Expense</th>
                      <th scope="col">Group</th>
                      <th scope="col">Category</th>
                      <th scope="col">Paid by</th>
                      <th scope="col" className="is-num">Amount</th>
                      <th scope="col" className="is-num">Your share</th>
                    </tr>
                  </thead>
                  {/* Screen: one page at a time. Print: every row. */}
                  <tbody className="mn-screen-only">
                    {pageRows.map((row) => (
                      <ReportTableRow key={row.id} row={row} />
                    ))}
                  </tbody>
                  <tbody className="mn-print-only">
                    {rows.map((row) => (
                      <ReportTableRow key={row.id} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mn-screen-only">
                <Pagination page={page} total={rows.length} pageSize={PER_PAGE} onChange={setPage} noun="expenses" />
              </div>
            </>
          ) : (
            <p className="mn-reports-empty">{loading ? "Loading…" : "No expenses in this period. Try a longer range."}</p>
          )}
        </section>
      </div>
      <AppNav active="reports" groups={groups} />
    </main>
  );
}

function ReportTableRow({ row }: { row: ReportRow }) {
  // data-label feeds the phone layout, where each row becomes a card.
  return (
    <tr>
      <td data-label="Date">{new Date(row.date).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</td>
      <td data-label="Expense" className="is-title">
        <Link
          href={
            row.groupId === "personal"
              ? `/personal/add?edit=${encodeURIComponent(row.id)}`
              : `/groups/${row.groupId}?expense=${encodeURIComponent(row.id)}`
          }
        >
          {row.title}
        </Link>
      </td>
      <td data-label="Group">{row.groupName}</td>
      <td data-label="Category">{CATEGORY_META[categoryKey(row.category)].label}</td>
      <td data-label="Paid by">{row.payerName}</td>
      <td data-label="Amount" className="is-num">{money(row.amount, row.currency)}</td>
      <td data-label="Your share" className="is-num">{row.yourShare ? money(row.yourShare, row.currency) : "—"}</td>
    </tr>
  );
}
