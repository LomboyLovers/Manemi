"use client";

import { useEffect, useId, useRef, useState } from "react";
import "./select.css";

export type SelectOption = { value: string; label: string; hint?: string; icon?: React.ReactNode };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Accessible name (also shown above the list on phones). */
  label: string;
  id?: string;
  /** "plain": text + chevron (inside rows). "chip": pill. "field": full-width input box. */
  variant?: "plain" | "chip" | "field";
  /** Highlight the chip (e.g. a filter that's on). */
  active?: boolean;
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end";
};

/**
 * Themed replacement for <select>: a button that opens a listbox.
 * Keyboard: ↑/↓ move, Home/End, Enter/Space pick, Escape closes, typing a
 * letter jumps to the next option starting with it. Focus returns to the
 * button when it closes.
 */
export default function Select({ value, onChange, options, label, id, variant = "plain", active, align = "end" }: Props) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((option) => option.value === value) ?? options[0];
  // Stable dependency for placement (the options array is rebuilt every render).
  const labelsKey = options.map((option) => option.label).join("\u0000");

  function show() {
    setCursor(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  }
  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }
  function pick(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    close();
  }

  // Fixed position under (or above) the trigger so scrolling sheets never clip it.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Wide enough for the longest label (roughly), never narrower than the trigger.
      const longest = Math.max(...options.map((option) => option.label.length + (option.icon ? 4 : 0)));
      const width = Math.min(Math.max(rect.width, 220, longest * 8.5 + 64), 360, window.innerWidth - 32);
      const wanted = Math.min(options.length * 46 + 14, 380);
      const spaceBelow = window.innerHeight - rect.bottom - 16;
      const above = spaceBelow < Math.min(wanted, 200) && rect.top > spaceBelow;
      const maxHeight = Math.min(wanted, above ? rect.top - 16 : spaceBelow);
      const rawLeft = align === "end" ? rect.right - width : rect.left;
      setPos({
        top: above ? rect.top - 8 - maxHeight : rect.bottom + 8,
        left: Math.min(Math.max(16, rawLeft), window.innerWidth - width - 16),
        width,
        maxHeight,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, labelsKey, align]);

  useEffect(() => {
    if (!open || !pos) return;
    listRef.current?.focus({ preventScroll: true });
  }, [open, pos]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, cursor]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function onListKey(event: React.KeyboardEvent) {
    const last = options.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(last, cursor + 1),
      ArrowUp: Math.max(0, cursor - 1),
      Home: 0,
      End: last,
    };
    if (event.key in moves) {
      event.preventDefault();
      setCursor(moves[event.key]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(cursor);
    } else if (event.key === "Escape") {
      event.preventDefault(); // stops an enclosing dialog from closing too
      close();
    } else if (event.key === "Tab") {
      close(false);
    } else if (event.key.length === 1) {
      const letter = event.key.toLowerCase();
      const order = [...options.slice(cursor + 1), ...options.slice(0, cursor + 1)];
      const match = order.find((option) => option.label.toLowerCase().startsWith(letter));
      if (match) setCursor(options.indexOf(match));
    }
  }

  return (
    <div className={`mn-select mn-select-${variant}`} ref={wrapRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`mn-select-trigger ${active ? "is-active" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${current?.label ?? ""}`}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            show();
          }
        }}
      >
        {current?.icon && <span className="mn-select-icon">{current.icon}</span>}
        <span className="mn-select-value">{current?.label}</span>
        <svg className="mn-select-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${listId}-${cursor}`}
          className="mn-select-menu"
          style={
            pos
              ? { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }
              : { visibility: "hidden" }
          }
          onKeyDown={onListKey}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={selected}
                className={`${index === cursor ? "is-cursor" : ""} ${selected ? "is-selected" : ""}`}
                onPointerMove={() => setCursor(index)}
                onClick={() => pick(index)}
              >
                {option.icon && <span className="mn-select-icon">{option.icon}</span>}
                <span className="mn-select-option-text">
                  <span>{option.label}</span>
                  {option.hint && <small>{option.hint}</small>}
                </span>
                {selected && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
