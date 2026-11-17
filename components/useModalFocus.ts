"use client";

import { useEffect, useRef } from "react";

/**
 * Modal focus behaviour shared by popups: focus moves inside on open, Tab is
 * trapped, Escape calls onClose, and focus returns to the trigger on close.
 */
export function useModalFocus<T extends HTMLElement>(onClose: () => void, active = true) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      [
        ...(ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([aria-disabled="true"]), a[href], input, select, textarea',
        ) ?? []),
      ];
    (ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0])?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
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
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose, active]);

  return ref;
}
