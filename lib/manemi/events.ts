"use client";

import { useEffect, useState } from "react";
import { invalidateGroupsData } from "./groups";

const EVENT = "manemi:data-changed";

/** Tell every open page that balances/expenses changed (e.g. a payment was recorded). */
export function notifyDataChanged() {
  invalidateGroupsData();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** A number that goes up each time data changes; add it to a loader's deps. */
export function useDataVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    window.addEventListener(EVENT, bump);
    return () => window.removeEventListener(EVENT, bump);
  }, []);
  return version;
}
