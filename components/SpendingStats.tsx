"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { reportExpenses, type ReportRow } from "@/lib/manemi/search";
import { personalAsReportRows, personalInRange } from "@/lib/manemi/personal";
import { peso } from "@/lib/manemi/format";
import { useDataVersion } from "@/lib/manemi/events";
import {
  dailyComparison,
  earliestNeeded,
  niceScale,
  smoothPath,
  type SpendingPeriod,
} from "@/lib/manemi/spending";
import "./spending-stats.css";

const toIsoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const CHART_HEIGHT = 220;
// Room for the ₱ labels on the left and the day labels below.
const PAD = { top: 16, right: 10, bottom: 30, left: 44 };
/** Month view: label and grid line every week (1, 8, 15, 22, 29). */
const MONTH_MARKS = [0, 7, 14, 21, 28];

const compact = new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 });
const axisPeso = (cents: number) => (cents === 0 ? "₱0" : `₱${compact.format(cents / 100)}`);

type Source = "combined" | "groups" | "personal";
const SOURCES: Array<{ value: Source; label: string }> = [
  { value: "combined", label: "Combined" },
  { value: "groups", label: "Groups" },
  { value: "personal", label: "Personal" },
];

/**
 * Home: what you've spent this week / month, day by day, with last week /
 * month as a gray line behind it (toggle). Styled as a smooth area chart.
 */
export default function SpendingStats({ userId }: { userId: string }) {
  const [period, setPeriod] = useState<SpendingPeriod>("week");
  const [compare, setCompare] = useState(true);
  const [source, setSource] = useState<Source>("combined");
  const [groupRows, setGroupRows] = useState<ReportRow[] | null>(null);
  const [personalRows, setPersonalRows] = useState<ReportRow[]>([]);
  const [error, setError] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const chartRef = useRef<HTMLDivElement>(null);
  const dataVersion = useDataVersion();
  const id = useId().replace(/:/g, "");

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
      .then(([fromGroups, personal]) => {
        if (!alive) return;
        setPersonalRows(personalAsReportRows(personal));
        setGroupRows(fromGroups);
      })
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

  // Loaded once; the toggle only changes which of the two lists is drawn.
  const rows = useMemo(
    () =>
      groupRows === null
        ? null
        : source === "groups"
          ? groupRows
          : source === "personal"
            ? personalRows
            : [...groupRows, ...personalRows],
    [groupRows, personalRows, source],
  );
  const data = useMemo(() => dailyComparison(rows ?? [], period, new Date()), [rows, period]);
  const sourceName = source === "groups" ? "group" : source === "personal" ? "personal" : "";
  const { slots, today } = data;
  const unit = period === "week" ? "week" : "month";
  const hasAny = data.currentTotal > 0 || data.previousTotal > 0;

  // Geometry. The scale covers both lines so toggling Compare never rescales.
  const scale = niceScale(Math.max(...slots.map((slot) => Math.max(slot.current ?? 0, slot.previous ?? 0))));
  const plotWidth = Math.max(width - PAD.left - PAD.right, 1);
  const plotHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const baseline = PAD.top + plotHeight;
  const x = (index: number) => PAD.left + (plotWidth * index) / Math.max(slots.length - 1, 1);
  const y = (cents: number) => baseline - (cents / scale.max) * plotHeight;

  const line = (values: Array<number | null>) =>
    values.flatMap((value, index) => (value === null ? [] : [{ x: x(index), y: y(value) }]));
  const currentPoints = line(slots.map((slot) => slot.current));
  const previousPoints = line(slots.map((slot) => slot.previous));
  const area = (points: Array<{ x: number; y: number }>) =>
    points.length > 1
      ? `${smoothPath(points)} L${points[points.length - 1].x},${baseline} L${points[0].x},${baseline} Z`
      : "";
  const marks = period === "week" ? slots.map((_, index) => index) : MONTH_MARKS.filter((index) => index < slots.length);
  const yTicks = [scale.max / 2, scale.max];

  function slotFromPointer(clientX: number) {
    const box = chartRef.current?.getBoundingClientRect();
    if (!box) return;
    const ratio = (clientX - box.left - PAD.left) / plotWidth;
    setActive(Math.min(slots.length - 1, Math.max(0, Math.round(ratio * (slots.length - 1)))));
  }

  // "So far" comparison: this period up to today vs the previous one up to the same day.
  const diff = data.currentTotal - data.previousToDate;
  const percent = data.previousToDate > 0 ? Math.round((diff / data.previousToDate) * 100) : null;
  const tone = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const changeText =
    diff === 0
      ? `Same as this time last ${unit}`
      : `${peso(Math.abs(diff) / 100)} ${diff > 0 ? "more" : "less"} than this time last ${unit}${
          percent !== null ? ` (${percent > 0 ? "+" : ""}${percent}%)` : ""
        }`;

  const shown = active === null ? null : slots[active];

  return (
    <section className="mn-spend" aria-labelledby={`${id}-title`}>
      <div className="mn-spend-head">
        <h2 id={`${id}-title`}>Your spending</h2>
        <div className="mn-spend-toggle" role="group" aria-label="Show">
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

      <div className="mn-spend-toggle mn-spend-source" role="group" aria-label="Spending to include">
        {SOURCES.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={source === item.value}
            className={source === item.value ? "active" : ""}
            onClick={() => {
              setSource(item.value);
              setActive(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mn-spend-error" role="alert">
          {error}
        </p>
      ) : (
        <>
          <div className="mn-spend-summary" aria-live="polite" aria-busy={rows === null}>
            <div>
              <span className="mn-spend-label">This {unit} so far</span>
              <strong className="mn-spend-value">{rows === null ? "—" : peso(data.currentTotal / 100)}</strong>
              {rows !== null && (
                <span className={`mn-spend-change is-${tone}`}>
                  <span aria-hidden="true">{tone === "up" ? "▲" : tone === "down" ? "▼" : "•"}</span> {changeText}
                </span>
              )}
            </div>
            <dl className="mn-spend-facts">
              <div>
                <dt>Last {unit}</dt>
                <dd>{rows === null ? "—" : peso(data.previousTotal / 100)}</dd>
              </div>
              <div>
                <dt>Daily average</dt>
                <dd>{rows === null ? "—" : peso(Math.round(data.currentTotal / data.daysSoFar) / 100)}</dd>
              </div>
            </dl>
          </div>

          <div className="mn-spend-legend">
            <span className="mn-spend-key is-current">
              <span className="mn-spend-swatch" aria-hidden="true" /> This {unit}
            </span>
            <button
              type="button"
              className="mn-spend-compare"
              aria-pressed={compare}
              title={compare ? `Hide last ${unit}` : `Compare with last ${unit}`}
              onClick={() => setCompare((value) => !value)}
            >
              <span className="mn-spend-swatch is-previous" aria-hidden="true" />
              Last {unit}
              <span className="mn-visually-hidden"> (compare)</span>
              <span className="mn-spend-switch" aria-hidden="true" />
            </button>
          </div>

          <div
            ref={chartRef}
            className="mn-spend-chart"
            tabIndex={hasAny ? 0 : -1}
            role="img"
            aria-label={`Your ${sourceName} spending each day this ${unit}${compare ? ` and last ${unit}` : ""}. Use the arrow keys to read each day.`}
            onPointerMove={(event) => slotFromPointer(event.clientX)}
            onPointerDown={(event) => slotFromPointer(event.clientX)}
            onPointerLeave={() => setActive(null)}
            onBlur={() => setActive(null)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const step = event.key === "ArrowLeft" ? -1 : 1;
                setActive((value) => Math.min(slots.length - 1, Math.max(0, (value ?? today) + step)));
              } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                setActive(event.key === "Home" ? 0 : slots.length - 1);
              }
            }}
          >
            {width > 0 && (
              <svg width={width} height={CHART_HEIGHT} aria-hidden="true" focusable="false">
                <defs>
                  <linearGradient id={`${id}-stroke`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#8b3dff" />
                    <stop offset="100%" stopColor="#ff5fa2" />
                  </linearGradient>
                  <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a04dff" stopOpacity="0.38" />
                    <stop offset="100%" stopColor="#a04dff" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* Vertical grid lines and day labels */}
                {marks.map((index) => (
                  <g key={index}>
                    <line className="mn-spend-vgrid" x1={x(index)} x2={x(index)} y1={PAD.top} y2={baseline} />
                    <text
                      className={`mn-spend-axis ${index === (active ?? today) ? "is-active" : ""}`}
                      x={x(index)}
                      y={baseline + 20}
                      textAnchor={index === 0 ? "start" : index === slots.length - 1 ? "end" : "middle"}
                    >
                      {slots[index].label}
                    </text>
                  </g>
                ))}
                {/* ₱ labels (no horizontal lines, like the reference) */}
                {yTicks.map((tick) => (
                  <text key={tick} className="mn-spend-axis" x={PAD.left - 10} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                    {axisPeso(tick)}
                  </text>
                ))}
                <text className="mn-spend-axis" x={PAD.left - 10} y={baseline} textAnchor="end" dominantBaseline="middle">
                  ₱0
                </text>
                <line className="mn-spend-baseline" x1={PAD.left} x2={width - PAD.right} y1={baseline} y2={baseline} />

                <g key={period} className="mn-spend-series">
                  {/* Last week / month: gray, behind */}
                  <g className={`mn-spend-previous ${compare ? "" : "is-hidden"}`}>
                    <path className="mn-spend-previous-fill" d={area(previousPoints)} />
                    <path className="mn-spend-previous-line" d={smoothPath(previousPoints)} />
                  </g>
                  {/* This week / month */}
                  <path d={area(currentPoints)} fill={`url(#${id}-fill)`} />
                  <path className="mn-spend-line" d={smoothPath(currentPoints)} stroke={`url(#${id}-stroke)`} />
                  {currentPoints.length > 0 && active === null && (
                    <circle className="mn-spend-today" cx={x(today)} cy={y(slots[today]?.current ?? 0)} r={4.5} />
                  )}
                </g>

                {active !== null && shown && (
                  <g>
                    <line className="mn-spend-crosshair" x1={x(active)} x2={x(active)} y1={PAD.top} y2={baseline} />
                    {compare && shown.previous !== null && (
                      <circle className="mn-spend-dot is-previous" cx={x(active)} cy={y(shown.previous)} r={4} />
                    )}
                    {shown.current !== null && <circle className="mn-spend-dot" cx={x(active)} cy={y(shown.current)} r={5} />}
                  </g>
                )}
              </svg>
            )}
            {width > 0 && rows !== null && hasAny && shown && (
              <div
                className="mn-spend-tooltip"
                style={{
                  left: Math.min(Math.max(x(active ?? 0), 84), width - 84),
                  top: PAD.top,
                }}
                aria-hidden="true"
              >
                <span className="mn-spend-tip-row">
                  <i className="mn-spend-swatch" />
                  {shown.currentLabel ?? "—"}
                  <strong>{shown.current === null ? (shown.currentLabel ? "Not yet" : "—") : peso(shown.current / 100)}</strong>
                </span>
                {compare && (
                  <span className="mn-spend-tip-row is-previous">
                    <i className="mn-spend-swatch is-previous" />
                    {shown.previousLabel ?? "—"}
                    <strong>{shown.previous === null ? "—" : peso(shown.previous / 100)}</strong>
                  </span>
                )}
              </div>
            )}
            {rows !== null && !hasAny && (
              <p className="mn-spend-empty">
                {source === "personal"
                  ? `No personal expenses this ${unit} or last ${unit} yet.`
                  : source === "groups"
                    ? `No group spending this ${unit} or last ${unit} yet. Your share of new expenses will show here.`
                    : `No spending this ${unit} or last ${unit} yet. Your share of new expenses will show here.`}
              </p>
            )}
          </div>

          {/* The same numbers as a table, for screen readers. Tables ignore
              width: 1px, so the hiding goes on a wrapper. */}
          <div className="mn-visually-hidden">
          <table>
            <caption>Your {sourceName} spending each day, this {unit} and last {unit}</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">This {unit}</th>
                <th scope="col">Last {unit}</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot, index) => (
                <tr key={index}>
                  <th scope="row">{slot.label}</th>
                  <td>{slot.current === null ? "—" : peso(slot.current / 100)}</td>
                  <td>{slot.previous === null ? "—" : peso(slot.previous / 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="mn-spend-note">
            {source === "groups"
              ? "Your share of group expenses, in pesos."
              : source === "personal"
                ? "Your personal expenses, in pesos."
                : "Your share of group expenses plus your personal expenses, in pesos."}{" "}
            <Link href="/history?type=personal">Personal expenses</Link>
          </p>
        </>
      )}
    </section>
  );
}
