"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useLiveUpdates } from "@/lib/manemi/realtime";
import type { GroupSummary } from "@/lib/manemi/groups";
import { createClient } from "@/lib/supabase/client";
import { loadCurrentUser } from "@/lib/manemi/friends";
import { useDataVersion } from "@/lib/manemi/events";
import QuickActions from "./QuickActions";
import AccountSheet from "./AccountSheet";
import Avatar from "./Avatar";
import "./app-nav.css";

export type NavSection = "home" | "groups" | "friends" | "history" | "reports";

const ITEMS: Array<{ id: NavSection; href: string; label: string; icon: string; desktopOnly?: boolean }> = [
  { id: "home", href: "/dashboard", label: "Home", icon: "home" },
  { id: "groups", href: "/groups", label: "Groups", icon: "group" },
  { id: "friends", href: "/friends", label: "Friends", icon: "friends" },
  { id: "history", href: "/history", label: "History", icon: "clock" },
  { id: "reports", href: "/reports", label: "Reports", icon: "reports" },
];

const ReportsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);

/** No PNG exists for Friends: a person-with-plus icon in the same style. */
const FriendsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21c0-4 3.5-6 7-6s7 2 7 6M19 8v6M16 11h6" />
  </svg>
);

type Props = {
  active?: NavSection;
  /** Groups the page already loaded (used by quick actions). */
  groups?: GroupSummary[];
};

/**
 * Main navigation. Desktop (≥768px): left sidebar with brand, links and an
 * Add Expense button. Phones: floating bottom pill plus the round + button.
 * The + opens the quick actions popup and turns into ✕ while it's open.
 * Pages using it add the `mn-app-page` class to their <main>.
 */
export default function AppNav({ active, groups }: Props) {
  // Every app page has the nav, so this keeps every page live (one shared connection).
  useLiveUpdates();
  const [quickOpen, setQuickOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [me, setMe] = useState<Awaited<ReturnType<typeof loadCurrentUser>>>(null);

  const dataVersion = useDataVersion();

  // Reloads after a profile edit (notifyDataChanged), so the photo updates here too.
  useEffect(() => {
    let active = true;
    loadCurrentUser(createClient())
      .then((user) => active && setMe(user))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [dataVersion]);

  return (
    <>
      <nav className="mn-nav" aria-label="Main navigation">
        <Link href="/dashboard" className="mn-nav-brand" aria-label="Manemi home">
          <Image src="/Logo_manemi.svg" alt="" width={32} height={32} />
          <span>Manemi</span>
        </Link>

        <div className="mn-nav-links">
          {ITEMS.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={`mn-nav-link ${active === item.id ? "is-active" : ""} ${item.desktopOnly ? "mn-nav-desktop-only" : ""}`}
              aria-current={active === item.id ? "page" : undefined}
            >
              {item.icon === "friends" ? (
              <FriendsIcon />
            ) : item.icon === "reports" ? (
              <ReportsIcon />
            ) : (
              <Image src={`/icons/${item.icon}.png`} alt="" width={20} height={20} />
            )}
              <span>{item.label}</span>
            </Link>
          ))}
        </div>

        <button
          type="button"
          className={`mn-nav-add ${quickOpen ? "is-open" : ""}`}
          onClick={() => setQuickOpen((open) => !open)}
          aria-label={quickOpen ? "Close quick actions" : "Quick actions"}
          title={quickOpen ? "Close quick actions" : "Quick actions"}
          aria-expanded={quickOpen}
          aria-haspopup="dialog"
        >
          <span aria-hidden="true">{quickOpen ? "×" : "+"}</span>
        </button>

        {/* Profile sits at the bottom-left of the sidebar (desktop). */}
        <button
          type="button"
          className="mn-nav-profile"
          aria-haspopup="dialog"
          aria-label={me ? `Account: ${me.name}` : "Account"}
          onClick={() => setAccountOpen(true)}
          disabled={!me}
        >
          <span className="mn-nav-profile-avatar" aria-hidden="true">
            <Avatar name={me?.name || "?"} url={me?.avatarUrl} />
          </span>
          <span className="mn-nav-profile-text">
            <strong>{me?.name ?? "Loading…"}</strong>
            {me?.handle && <span>@{me.handle}</span>}
          </span>
        </button>
      </nav>

      {quickOpen && <QuickActions groups={groups} onClose={() => setQuickOpen(false)} />}
      {accountOpen && me && (
        <AccountSheet name={me.name} email={me.email} handle={me.handle} avatarUrl={me.avatarUrl ?? null} onClose={() => setAccountOpen(false)} />
      )}
    </>
  );
}
