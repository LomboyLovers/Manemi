"use client";

import { useCallback } from "react";

/**
 * Segmented control with a highlight that slides between options.
 * Put the returned ref and the `mn-pill` class on the container; its direct
 * children mark the current option with aria-pressed or aria-selected.
 * The pill's colour comes from --pill-bg / --pill-r / --pill-shadow (motion.css).
 */
export function useSlidingPill<T extends HTMLElement>() {
  // React 19 callback ref: the returned function is its cleanup.
  return useCallback((box: T | null) => {
    if (!box) return;
    const place = () => {
      const current = box.querySelector<HTMLElement>(':scope > [aria-pressed="true"], :scope > [aria-selected="true"]');
      if (!current) {
        box.classList.remove("has-pill");
        return;
      }
      box.style.setProperty("--pill-x", `${current.offsetLeft}px`);
      box.style.setProperty("--pill-y", `${current.offsetTop}px`);
      box.style.setProperty("--pill-w", `${current.offsetWidth}px`);
      box.style.setProperty("--pill-h", `${current.offsetHeight}px`);
      box.classList.add("has-pill");
    };
    place();
    // Only animate moves after the first placement, so it doesn't fly in on load.
    const frame = requestAnimationFrame(() => box.classList.add("pill-ready"));
    const watch = new MutationObserver(place);
    watch.observe(box, { subtree: true, attributes: true, attributeFilter: ["aria-pressed", "aria-selected"] });
    const resize = new ResizeObserver(place);
    resize.observe(box);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
      resize.disconnect();
    };
  }, []);
}
