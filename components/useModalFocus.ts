"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Modal focus behaviour shared by popups: focus moves inside on open, Tab is
 * trapped, Escape calls onClose, and focus returns to the trigger on close.
 */
export function useModalFocus<T extends HTMLElement>(onClose: () => void, active = true) {
  const ref = useRef<T>(null);
  useFocusTrap(ref, onClose, active);
  return ref;
}

/**
 * useModalFocus plus a slide-down exit: `close` adds `is-leaving` to the sheet
 * and its backdrop (popups.css animates them out) and calls onClose when done.
 * Use `close` for the popup's own Cancel / ✕ / backdrop / Escape. After a
 * successful action, call onClose directly so the page moves on at once.
 */
export function useSheet<T extends HTMLElement>(onClose: () => void, active = true) {
  const ref = useRef<T>(null);
  const leaving = useRef(false);
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  }, [onClose]);

  const close = useCallback(() => {
    if (leaving.current) return;
    const sheet = ref.current;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!sheet || reduce) {
      latest.current();
      return;
    }
    leaving.current = true;
    sheet.classList.add("is-leaving");
    sheet.parentElement?.classList.add("is-leaving");
    // Matches --mn-sheet-out in popups.css.
    window.setTimeout(() => {
      leaving.current = false;
      latest.current();
    }, 200);
  }, []);

  useFocusTrap(ref, close, active);
  return { ref, close };
}

function useFocusTrap<T extends HTMLElement>(ref: RefObject<T | null>, onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      [
        ...(ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([aria-disabled="true"]), a[href], input, select, textarea',
        ) ?? []),
      ];
    // preventScroll: focusing mid-slide would otherwise jump the sheet into place.
    (ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0])?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (event.defaultPrevented) return; // an inner popup (e.g. calendar) handled it
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
      previous?.focus?.({ preventScroll: true });
    };
  }, [ref, onClose, active]);
}
