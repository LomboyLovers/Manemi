"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "./popups.css";

type Prefs = { notifyExpense: boolean; notifySettlement: boolean; notifyGroupJoin: boolean };

const ROWS: Array<{ key: keyof Prefs; title: string; detail: string }> = [
  { key: "notifyExpense", title: "New expenses", detail: "When someone adds an expense you're part of" },
  { key: "notifySettlement", title: "Payments to you", detail: "When someone records paying you back" },
  { key: "notifyGroupJoin", title: "Joining a group", detail: "A confirmation when you join a group" },
];

/** NOTIF-04: email notification switches, saved on your profile. */
export default function NotificationSettings({ userId }: { userId: string }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    let active = true;
    createClient()
      .from("User")
      .select("notifyExpense, notifySettlement, notifyGroupJoin")
      .eq("userId", userId)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError || !data) {
          setError("Couldn't load your email settings. Try again later.");
          return;
        }
        setPrefs(data as Prefs);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  async function toggle(key: keyof Prefs) {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next); // optimistic
    setSaved("");
    setError("");
    const { error: saveError } = await createClient().from("User").update({ [key]: next[key] }).eq("userId", userId);
    if (saveError) {
      setPrefs(prefs);
      setError("Couldn't save that change. Try again.");
      return;
    }
    setSaved(`${ROWS.find((row) => row.key === key)?.title} emails ${next[key] ? "on" : "off"}.`);
  }

  if (!prefs) {
    return error ? (
      <p className="mn-popup-error" role="alert">
        {error}
      </p>
    ) : (
      <p className="mn-notif-state" aria-busy="true">
        Loading…
      </p>
    );
  }

  return (
    <div className="mn-notif">
      <ul className="mn-account-list mn-notif-list">
        {ROWS.map((row) => (
          <li key={row.key}>
            <span className="mn-notif-text" id={`notif-${row.key}`}>
              <strong>{row.title}</strong>
              <small>{row.detail}</small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs[row.key]}
              aria-labelledby={`notif-${row.key}`}
              className={`mn-switch ${prefs[row.key] ? "is-on" : ""}`}
              onClick={() => void toggle(row.key)}
            >
              <span aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="mn-popup-error" role="alert">
          {error}
        </p>
      )}
      <p className="mn-notif-state" role="status">
        {saved}
      </p>
    </div>
  );
}
