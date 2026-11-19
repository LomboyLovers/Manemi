"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import "./date-picker.css";

type Props = {
  /** "YYYY-MM-DD" */
  value: string;
  onChange: (value: string) => void;
  /** Visible label; also used for the trigger's accessible name. */
  label: string;
  /** Latest selectable date, "YYYY-MM-DD" (optional). */
  max?: string;
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const pad = (n: number) => String(n).padStart(2, "0");
export const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : new Date();
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last));
};

/**
 * Themed popup calendar (replaces the browser's date picker).
 * Keyboard: arrows move by day/week, PageUp/PageDown by month, Home/End to
 * week start/end, Enter or Space picks, Escape closes.
 */
export default function DatePicker({ value, onChange, label, max }: Props) {
  const [open, setOpen] = useState(false);
  const [focusDate, setFocusDate] = useState(() => fromIso(value));
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Fixed position so scrolling containers (sheets, popups) never clip it.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const selected = fromIso(value);
  const today = toIso(new Date());
  const maxDate = max ? fromIso(max) : null;
  // Compare calendar days, not times ("today" at 3pm is still selectable).
  const isDisabled = (d: Date) => Boolean(max && toIso(d) > max);

  // Six weeks starting on the Sunday before the 1st of the month.
  const days = useMemo(() => {
    const first = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
    const start = addDays(first, -first.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [focusDate]);

  function openPicker() {
    setFocusDate(fromIso(value));
    setOpen(true);
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function pick(d: Date) {
    if (isDisabled(d)) return;
    onChange(toIso(d));
    close();
  }

  // Place the popup under the trigger (or above when there's no room).
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 32);
      const height = 410;
      const below = rect.bottom + 8;
      const top = below + height > window.innerHeight - 8 && rect.top - 8 - height > 8 ? rect.top - 8 - height : below;
      const left = Math.min(Math.max(16, rect.right - width), window.innerWidth - width - 16);
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Keep keyboard focus on the focused day.
  useEffect(() => {
    if (!open) return;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-iso="${toIso(focusDate)}"]`)
      ?.focus({ preventScroll: true });
  }, [open, focusDate, pos]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function onGridKey(event: React.KeyboardEvent) {
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focusDate, -1),
      ArrowRight: () => addDays(focusDate, 1),
      ArrowUp: () => addDays(focusDate, -7),
      ArrowDown: () => addDays(focusDate, 7),
      PageUp: () => addMonths(focusDate, -1),
      PageDown: () => addMonths(focusDate, 1),
      Home: () => addDays(focusDate, -focusDate.getDay()),
      End: () => addDays(focusDate, 6 - focusDate.getDay()),
    };
    if (moves[event.key]) {
      event.preventDefault();
      setFocusDate(moves[event.key]());
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  const display = selected.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const monthTitle = focusDate.toLocaleDateString("en-PH", { month: "long", year: "numeric" });
  const nextMonthStart = new Date(focusDate.getFullYear(), focusDate.getMonth() + 1, 1);

  return (
    <div className="mn-date" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="mn-date-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${display}`}
        onClick={() => (open ? close() : openPicker())}
      >
        <span>{display}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>

      {open && (
        <div
          className="mn-date-popup"
          style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        >
          <div className="mn-date-head">
            <button type="button" className="mn-date-nav" aria-label="Previous month" onClick={() => setFocusDate(addMonths(focusDate, -1))}>
              ‹
            </button>
            <strong id={titleId} aria-live="polite">
              {monthTitle}
            </strong>
            <button
              type="button"
              className="mn-date-nav"
              aria-label="Next month"
              disabled={Boolean(maxDate && nextMonthStart > maxDate)}
              onClick={() => setFocusDate(addMonths(focusDate, 1))}
            >
              ›
            </button>
          </div>

          <div className="mn-date-weekdays" aria-hidden="true">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="mn-date-grid" ref={gridRef} role="grid" aria-labelledby={titleId} onKeyDown={onGridKey}>
            {Array.from({ length: 6 }, (_, week) => (
              <div role="row" key={week} className="mn-date-row">
                {days.slice(week * 7, week * 7 + 7).map((d) => {
                  const iso = toIso(d);
                  const outside = d.getMonth() !== focusDate.getMonth();
                  const isSelected = iso === value;
                  const isFocus = iso === toIso(focusDate);
                  return (
                    <span role="gridcell" key={iso} aria-selected={isSelected}>
                      <button
                        type="button"
                        data-iso={iso}
                        tabIndex={isFocus ? 0 : -1}
                        disabled={isDisabled(d)}
                        className={[
                          "mn-date-day",
                          outside ? "is-outside" : "",
                          isSelected ? "is-selected" : "",
                          iso === today ? "is-today" : "",
                        ].join(" ")}
                        aria-label={d.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                        aria-current={iso === today ? "date" : undefined}
                        onClick={() => pick(d)}
                      >
                        {d.getDate()}
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="mn-date-foot">
            <button type="button" className="mn-date-link" onClick={() => pick(new Date())} disabled={isDisabled(new Date())}>
              Today
            </button>
            <button type="button" className="mn-date-link" onClick={() => pick(addDays(new Date(), -1))}>
              Yesterday
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
