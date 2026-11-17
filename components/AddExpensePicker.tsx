"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { GroupSummary } from "@/lib/manemi/groups";
import { isZero, peso } from "@/lib/manemi/format";
import "@/app/groups/groups-actions-sheet.css";
import "./add-expense-picker.css";

type Props = {
  groups: GroupSummary[];
  onClose: () => void;
  onCreateGroup?: () => void;
};

/**
 * Bottom sheet opened by the + button: pick which group the expense belongs
 * to, then continue to that group's Add Expense screen. With a single active
 * group it skips straight there.
 */
export default function AddExpensePicker({ groups, onClose, onCreateGroup }: Props) {
  const router = useRouter();
  const active = groups.filter((group) => !group.isArchived);
  const onlyGroupId = active.length === 1 ? active[0].id : null;

  useEffect(() => {
    if (onlyGroupId) router.push(`/groups/${onlyGroupId}/add-expense`);
  }, [onlyGroupId, router]);

  const sheetRef = useRef<HTMLElement>(null);

  // Modal focus: move in on open, trap Tab, Escape closes, restore on close.
  useEffect(() => {
    if (onlyGroupId) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      [...(sheetRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
    focusables()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose, onlyGroupId]);

  if (onlyGroupId) return null;

  return (
    <div className="manemi-actions-overlay" onClick={onClose}>
      <section
        ref={sheetRef}
        className="manemi-actions-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-expense-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="manemi-actions-handle" aria-hidden="true" />
        <header className="manemi-actions-heading">
          <div>
            <h2 id="add-expense-picker-title">Add Expense</h2>
            <p>Which group is this expense for?</p>
          </div>
        </header>

        {active.length ? (
          <div className="manemi-actions-list aep-list">
            {active.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => router.push(`/groups/${group.id}/add-expense`)}
              >
                <span className="aep-emoji" aria-hidden="true">
                  📦
                </span>
                <span className="aep-text">
                  <strong>{group.name}</strong>
                  <small>
                    {group.members} {group.members === 1 ? "member" : "members"}
                    {isZero(group.net)
                      ? " · Settled up"
                      : group.net > 0
                        ? ` · You're owed ${peso(group.net)}`
                        : ` · You owe ${peso(-group.net)}`}
                  </small>
                </span>
                <span className="manemi-action-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="aep-empty">
            <p>You need an active group before adding an expense.</p>
            {onCreateGroup && (
              <button
                type="button"
                className="aep-create"
                onClick={() => {
                  onClose();
                  onCreateGroup();
                }}
              >
                Create Group
              </button>
            )}
          </div>
        )}

        <button type="button" className="manemi-actions-cancel" onClick={onClose}>
          Cancel
        </button>
      </section>
    </div>
  );
}
