"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { reportExpenses, type ReportRow } from "@/lib/manemi/search";
import { personalAsReportRows, personalInRange } from "@/lib/manemi/personal";
import { peso } from "@/lib/manemi/format";
import { useDataVersion } from "@/lib/manemi/events";
import {
  earliestNeeded,
  niceScale,
  periodChange,
  smoothPath,
  spendingSeries,
  type SpendingPeriod,
} from "@/lib/manemi/spending";
import "./spending-stats.css";

const toIsoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const CHART_HEIGHT = 228;
// Room for the y-axis title + labels on the left and the x labels + title below.
const PAD = { top: 12, right: 12, bottom: 52, left: 70 };

/** Home: how much you spent this week / month, compared with the one before, plus a trend line. */
export default function SpendingStats({ userId }: { userId: string }) {
  const [period, setPeriod] = useState<SpendingPeriod>("week");
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const chartRef = useRef<HTMLDivElement>(null);
  const dataVersion = useDataVersion();
  const id = useId();

  useEffect(() => {
    let alive = true;
    setError("");
    const supabase = createClient();
    const from = toIsoDay(earliestNeeded(new Date()));
    Promise.all([
      reportExpenses(supabase, userId, { groupId: "all", from }),
      // Personal expenses count in full; if they aren't available, the card still works.
      personalInRange(supabase, from).catch(() => []),
    ])
      .then(([groupRows, personal]) => alive && setRows([...groupRows, ...personalAsReportRows(personal)]))
      .catch((reason: unknown) => alive && setError(reason instanceof Error ? reason.message : "Couldn't load your spending."));
    return () => {
      alive = false;
    };
  }, [userId, dataVersion]);

  // The chart is drawn in pixels so text never stretches.
  useEffect(() => {
    const node = chartRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const points = useMemo(() => spendingSeries(rows ?? [], period, new Date()), [rows, period]);
  const change = periodChange(points);
  const current = points[points.length - 1];
  const previous = points[points.length - 2];
  const unit = period === "week" ? "week" : "month";
  const average = points.reduce((sum, point) => sum + point.cents, 0) / points.length;
  const hasAny = points.some((point) => point.cents > 0);

  // Geometry
  const scale = niceScale(Math.max(...points.map((point) => point.cents)));
  const plotWidth = Math.max(width - PAD.left - PAD.right, 1);
  const plotHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  // Each period gets an equal slot; its point sits in the middle (like the reference: Mon is inset from the axis).
  const slot = plotWidth / Math.max(points.length, 1);
  const x = (index: number) => PAD.left + slot * (index + 0.5);
  const y = (cents: number) => PAD.top + plotHeight - (cents / scale.max) * plotHeight;
  const ticks = [0, 1, 2, 3, 4].map((step) => step * scale.step);
  const path = smoothPath(points.map((point, index) => ({ x: x(index), y: y(point.cents) })));
  const axisBottom = PAD.top + plotHeight;
  const shown = active ?? points.length - 1;

  function pointFromPointer(clientX: number) {
    const box = chartRef.current?.getBoundingClientRect();
    if (!box || points.length < 2) return;
    const relative = clientX - box.left - PAD.left;
    const index = Math.floor(relative / slot);
    setActive(Math.min(points.length - 1, Math.max(0, index)));
  }

  const tone = change.cents > 0 ? "up" : change.cents < 0 ? "down" : "flat";
  const changeText =
    change.cents === 0
      ? `Same as last ${unit}`
      : `${peso(Math.abs(change.cents) / 100)} ${change.cents > 0 ? "more" : "less"} than last ${unit}${
          change.percent !== null ? ` (${change.percent > 0 ? "+" : ""}${change.percent}%)` : ""
        }`;

  return (
    <section className="mn-spend" aria-labelledby={`${id}-title`}>
      <div className="mn-spend-head">
        <h2 id={`${id}-title`}>Your spending</h2>
        <div className="mn-spend-toggle" role="group" aria-label="Compare by">
          {(["week", "month"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={period === value}
              className={period === value ? "active" : ""}
              onClick={() => {
                setPeriod(value);
                setActive(null);
              }}
            >
              {value === "week" ? "Weekly" : "Monthly"}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="mn-spend-error" role="alert">
          {error}
        </p>
      ) : (
        <>
          <div className="mn-spend-summary" aria-live="polite" aria-busy={rows === null}>
            <div>
              <span className="mn-spend-label">This {unit}</span>
              <strong className="mn-spend-value">{rows === null ? "—" : peso((current?.cents ?? 0) / 100)}</strong>
              {rows !== null && (
                <span className={`mn-spend-change is-${tone}`}>
                  <span aria-hidden="true">{tone === "up" ? "▲" : tone === "down" ? "▼" : "•"}</span> {changeText}
                </span>
              )}
            </div>
            <dl className="mn-spend-facts">
              <div>
                <dt>Last {unit}</dt>
                <dd>{rows === null ? "—" : peso((previous?.cents ?? 0) / 100)}</dd>
              </div>
              <div>
                <dt>{points.length}-{unit} average</dt>
                <dd>{rows === null ? "—" : peso(Math.round(average) / 100)}</dd>
              </div>
            </dl>
          </div>

          <div
            ref={chartRef}
            className="mn-spend-chart"
            tabIndex={hasAny ? 0 : -1}
            role="img"
            aria-label={`Your spending per ${unit}, last ${points.length} ${unit}s. Use the arrow keys to read each ${unit}.`}
            onPointerMove={(event) => pointFromPointer(event.clientX)}
            onPointerDown={(event) => pointFromPointer(event.clientX)}
            onPointerLeave={() => setActive(null)}
            onBlur={() => setActive(null)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const step = event.key === "ArrowLeft" ? -1 : 1;
                setActive((value) => Math.min(points.length - 1, Math.max(0, (value ?? points.length - 1) + step)));
              } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                setActive(event.key === "Home" ? 0 : points.length - 1);
              }
            }}
          >
            {width > 0 && (
              <svg width={width} height={CHART_HEIGHT} aria-hidden="true" focusable="false">
                {/* Horizontal gridlines with y tick marks and labels */}
                {ticks.map((tick) => (
                  <g key={tick}>
                    {tick > 0 && <line className="mn-spend-grid" x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} />}
                    <line className="mn-spend-tick" x1={PAD.left - 5} x2={PAD.left} y1={y(tick)} y2={y(tick)} />
                    <text className="mn-spend-axis" x={PAD.left - 9} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                      {tick === 0 ? "₱0" : `₱${new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(tick / 100)}`}
                    </text>
                  </g>
                ))}
                {/* Axes */}
                <line className="mn-spend-axis-line" x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={axisBottom} />
                <line className="mn-spend-axis-line" x1={PAD.left} x2={width - PAD.right} y1={axisBottom} y2={axisBottom} />
                {/* X tick marks and labels */}
                {points.map((point, index) => {
                  const thin = period === "week" && plotWidth < 380 && index % 2 !== (points.length - 1) % 2;
                  return (
                    <g key={point.start.toISOString()}>
                      <line className="mn-spend-tick" x1={x(index)} x2={x(index)} y1={axisBottom} y2={axisBottom + 5} />
                      {!thin && (
                        <text className={`mn-spend-axis ${index === shown ? "is-active" : ""}`} x={x(index)} y={axisBottom + 20} textAnchor="middle">
                          {point.label}
                        </text>
                      )}
                    </g>
                  );
                })}
                {/* Axis titles */}
                <text className="mn-spend-axis-title" x={PAD.left + plotWidth / 2} y={CHART_HEIGHT - 6} textAnchor="middle">
                  {period === "week" ? "Week starting" : "Month"}
                </text>
                <text
                  className="mn-spend-axis-title"
                  x={0}
                  y={0}
                  textAnchor="middle"
                  transform={`translate(14 ${PAD.top + plotHeight / 2}) rotate(-90)`}
                >
                  Your share (₱)
                </text>
                {active !== null && (
                  <line className="mn-spend-crosshair" x1={x(shown)} x2={x(shown)} y1={PAD.top} y2={axisBottom} />
                )}
                <path className="mn-spend-line" d={path} />
                {points.map((point, index) => (
                  <circle
                    key={point.start.toISOString()}
                    className={`mn-spend-point ${index === shown && active !== null ? "is-active" : ""}`}
                    cx={x(index)}
                    cy={y(point.cents)}
                    r={index === shown && active !== null ? 5.5 : 3.5}
                  />
                ))}
              </svg>
            )}
            {width > 0 && rows !== null && hasAny && active !== null && (
              <div
                className="mn-spend-tooltip"
                style={{
                  left: Math.min(Math.max(x(shown), 70), width - 70),
                  top: Math.max(y(points[shown]?.cents ?? 0) - 12, 0),
                }}
                aria-hidden="true"
              >
                <span>{points[shown]?.longLabel}</span>
                <strong>{peso((points[shown]?.cents ?? 0) / 100)}</strong>
              </div>
            )}
            {rows !== null && !hasAny && (
              <p className="mn-spend-empty">No spending in the last {points.length} {unit}s yet. Your share of new expenses will show here.</p>
            )}
          </div>

          {/* The same numbers as a table, for screen readers */}
          <table className="mn-visually-hidden">
            <caption>Your spending per {unit}</caption>
            <thead>
              <tr>
                <th scope="col">{period === "week" ? "Week" : "Month"}</th>
                <th scope="col">Your share</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.start.toISOString()}>
                  <th scope="row">{point.longLabel}</th>
                  <td>{peso(point.cents / 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mn-spend-note">
            Your share of group expenses plus your personal expenses, in pesos.{" "}
            <Link href="/personal">Personal expenses</Link>
          </p>
        </>
      )}
    </section>
  );
}
